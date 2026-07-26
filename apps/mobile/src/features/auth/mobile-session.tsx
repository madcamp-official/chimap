import type {
  MobileAppleLoginRequest,
  MobileTokenPair,
} from "@chimap/contracts";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";

import {
  clearUserLocalState,
  storageKeysForUser,
} from "../../platform/storage/namespace";
import {
  exchangeKakaoToken,
  exchangeAppleToken,
  deleteMobileAccount,
  MobileApiError,
  revokeMobileSession,
  rotateRefreshToken,
} from "./auth-api";
import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "./auth-storage";
import { apiBaseUrl } from "../api/runtime-config";

type SessionState =
  | { status: "booting" }
  | { status: "guest"; message: string | null }
  | { status: "authenticated"; pair: MobileTokenPair };

type MobileSessionContextValue = {
  state: SessionState;
  completeKakaoLogin(kakaoAccessToken: string): Promise<void>;
  completeAppleLogin(
    input: Omit<MobileAppleLoginRequest, "platform">,
  ): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
  registerLocalCleanup(
    userId: string,
    cleanup: () => Promise<void>,
  ): () => void;
};

const MobileSessionContext = createContext<MobileSessionContextValue | null>(null);

export function MobileSessionProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<SessionState>({ status: "booting" });
  const sessionEpoch = useRef(0);
  const localCleanup = useRef<{
    userId: string;
    run: () => Promise<void>;
  } | null>(null);
  const registerLocalCleanup = useCallback(
    (userId: string, cleanup: () => Promise<void>) => {
      const registration = { userId, run: cleanup };
      localCleanup.current = registration;
      return () => {
        if (localCleanup.current === registration) {
          localCleanup.current = null;
        }
      };
    },
    [],
  );
  const clearLocalUserState = useCallback(async (userId: string) => {
    if (localCleanup.current?.userId === userId) {
      await localCleanup.current.run();
    }
    await clearUserLocalState(await storageKeysForUser(userId));
  }, []);

  useEffect(() => {
    let mounted = true;
    const bootstrapEpoch = sessionEpoch.current;
    void (async () => {
      const stored = await readStoredSession();
      if (stored === null) {
        if (mounted) {
          setState({ status: "guest", message: null });
        }
        return;
      }
      // 네트워크를 기다리지 않고 owner namespace와 persisted UI/query를 먼저 연다.
      if (mounted) {
        setState({ status: "authenticated", pair: stored });
      }
      try {
        const pair = await rotateRefreshToken({
          apiBaseUrl: apiBaseUrl(),
          refreshToken: stored.refreshToken,
        });
        if (!mounted || sessionEpoch.current !== bootstrapEpoch) {
          return;
        }
        await writeStoredSession(pair);
        setState({ status: "authenticated", pair });
      } catch (error) {
        if (
          error instanceof MobileApiError &&
          error.code === "AUTH_SESSION_INVALID" &&
          sessionEpoch.current === bootstrapEpoch
        ) {
          if (sessionEpoch.current !== bootstrapEpoch) {
            return;
          }
          await Promise.all([
            clearStoredSession(),
            clearLocalUserState(stored.user.id),
          ]);
          if (mounted) {
            setState({
              status: "guest",
              message: "세션이 만료되었습니다. 게스트로 계속 이용할 수 있습니다.",
            });
          }
        }
        // Offline/timeout이면 저장된 화면은 유지하고 timer가 조용히 재시도한다.
      }
    })().catch(() => {
      if (mounted && sessionEpoch.current === bootstrapEpoch) {
        setState({
          status: "guest",
          message: "세션을 복원하지 못했지만 게스트로 계속 이용할 수 있습니다.",
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, [clearLocalUserState]);

  useEffect(() => {
    if (state.status !== "authenticated") {
      return undefined;
    }
    const current = state.pair;
    const epoch = sessionEpoch.current;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const pair = await rotateRefreshToken({
          apiBaseUrl: apiBaseUrl(),
          refreshToken: current.refreshToken,
        });
        if (cancelled || sessionEpoch.current !== epoch) {
          return;
        }
        await writeStoredSession(pair);
        setState({ status: "authenticated", pair });
      } catch (error) {
        if (cancelled || sessionEpoch.current !== epoch) {
          return;
        }
        if (error instanceof MobileApiError && error.code === "AUTH_SESSION_INVALID") {
          sessionEpoch.current += 1;
          await Promise.all([
            clearStoredSession(),
            clearLocalUserState(current.user.id),
          ]);
          setState({
            status: "guest",
            message: "세션이 만료되었습니다. 게스트로 계속 이용할 수 있습니다.",
          });
          return;
        }
        timeout = setTimeout(() => void refresh(), 30_000);
      }
    };
    const refreshAt = Date.parse(current.accessExpiresAt) - 60_000;
    timeout = setTimeout(
      () => void refresh(),
      Math.max(0, refreshAt - Date.now()),
    );
    return () => {
      cancelled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    };
  }, [clearLocalUserState, state]);

  const completeKakaoLogin = useCallback(async (kakaoAccessToken: string) => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      throw new Error("모바일 플랫폼에서만 로그인할 수 있습니다.");
    }
    const pair = await exchangeKakaoToken({
      apiBaseUrl: apiBaseUrl(),
      kakaoAccessToken,
      platform: Platform.OS,
    });
    sessionEpoch.current += 1;
    await writeStoredSession(pair);
    setState({ status: "authenticated", pair });
  }, []);

  const completeAppleLogin = useCallback(
    async (input: Omit<MobileAppleLoginRequest, "platform">) => {
      if (Platform.OS !== "ios") {
        throw new Error("Apple 로그인은 iOS에서만 사용할 수 있습니다.");
      }
      const pair = await exchangeAppleToken({
        apiBaseUrl: apiBaseUrl(),
        ...input,
      });
      sessionEpoch.current += 1;
      await writeStoredSession(pair);
      setState({ status: "authenticated", pair });
    },
    [],
  );

  const logout = useCallback(async () => {
    sessionEpoch.current += 1;
    if (state.status !== "authenticated") {
      await clearStoredSession();
      setState({ status: "guest", message: null });
      return;
    }
    const { pair } = state;
    try {
      await revokeMobileSession({
        apiBaseUrl: apiBaseUrl(),
        refreshToken: pair.refreshToken,
      });
    } finally {
      await Promise.allSettled([
        clearStoredSession(),
        clearLocalUserState(pair.user.id),
      ]);
      setState({ status: "guest", message: null });
    }
  }, [clearLocalUserState, state]);

  const deleteAccount = useCallback(async () => {
    if (state.status !== "authenticated") {
      return;
    }
    sessionEpoch.current += 1;
    const { pair } = state;
    await deleteMobileAccount({
      apiBaseUrl: apiBaseUrl(),
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
    });
    await Promise.allSettled([
      clearStoredSession(),
      clearLocalUserState(pair.user.id),
    ]);
    setState({ status: "guest", message: "계정과 기기 저장 데이터를 삭제했습니다." });
  }, [clearLocalUserState, state]);

  const value = useMemo(
    () => ({
      state,
      completeKakaoLogin,
      completeAppleLogin,
      logout,
      deleteAccount,
      registerLocalCleanup,
    }),
    [
      completeAppleLogin,
      completeKakaoLogin,
      deleteAccount,
      logout,
      registerLocalCleanup,
      state,
    ],
  );
  return (
    <MobileSessionContext.Provider value={value}>
      {children}
    </MobileSessionContext.Provider>
  );
}

export function useMobileSession(): MobileSessionContextValue {
  const context = useContext(MobileSessionContext);
  if (context === null) {
    throw new Error("MobileSessionProvider가 필요합니다.");
  }
  return context;
}
