import type { AuthSessionResponse } from "@chimap/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getAuthSession,
  getKakaoLoginUrl,
  logout,
} from "../lib/api.js";

const anonymousSession: AuthSessionResponse = {
  authenticated: false,
  kakaoLoginAvailable: true,
  user: null,
};

function initialAuthMessage(): string | undefined {
  const outcome = new URLSearchParams(window.location.search).get("auth");
  if (outcome === "kakao-success") {
    return "카카오 로그인을 완료했어요.";
  }
  if (outcome === "kakao-cancelled") {
    return "카카오 로그인을 취소했어요. 로그인 없이도 이용할 수 있어요.";
  }
  if (outcome === "kakao-error") {
    return "카카오 로그인을 완료하지 못했어요. 다시 시도해 주세요.";
  }
  return undefined;
}

export function AuthControl() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(initialAuthMessage);
  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: ({ signal }) => getAuthSession(signal),
    retry: false,
    staleTime: 30_000,
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.setQueryData<AuthSessionResponse>(
        ["auth-session"],
        anonymousSession,
      );
      setMessage("CHIMap에서 로그아웃했어요.");
    },
    onError: () => {
      setMessage("로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    },
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("auth")) {
      url.searchParams.delete("auth");
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
  }, []);

  const displayName = useMemo(() => {
    const name = sessionQuery.data?.user?.displayName?.trim();
    return name === undefined || name === "" ? "카카오 사용자" : name;
  }, [sessionQuery.data?.user?.displayName]);

  if (sessionQuery.data?.authenticated === true && sessionQuery.data.user) {
    return (
      <div className="auth-control">
        <div className="auth-user" title="카카오 로그인 사용자">
          {sessionQuery.data.user.profileImageUrl === null ? (
            <span className="auth-avatar" aria-hidden="true">
              {displayName.slice(0, 1)}
            </span>
          ) : (
            <img
              className="auth-avatar"
              src={sessionQuery.data.user.profileImageUrl}
              alt=""
              referrerPolicy="no-referrer"
            />
          )}
          <span>{displayName}</span>
        </div>
        <button
          type="button"
          className="auth-logout-button"
          disabled={logoutMutation.isPending}
          onClick={() => logoutMutation.mutate()}
        >
          <LogOut aria-hidden="true" />
          {logoutMutation.isPending ? "로그아웃 중" : "로그아웃"}
        </button>
        {message === undefined ? null : (
          <span className="auth-message" role="status">
            {message}
          </span>
        )}
      </div>
    );
  }

  const available = sessionQuery.data?.kakaoLoginAvailable === true;
  return (
    <div className="auth-control">
      {available ? (
        <a className="kakao-login-button" href={getKakaoLoginUrl()}>
          <span className="kakao-symbol" aria-hidden="true">
            K
          </span>
          카카오 로그인
        </a>
      ) : (
        <button type="button" className="kakao-login-button" disabled>
          {sessionQuery.isPending ? "로그인 확인 중" : "로그인 준비 중"}
        </button>
      )}
      <small>로그인 없이도 이용할 수 있어요</small>
      {message === undefined ? null : (
        <span className="auth-message" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
