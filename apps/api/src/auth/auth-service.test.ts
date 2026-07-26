import type { AuthUser } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import type { AuthStore, KakaoIdentity } from "./auth-repository.js";
import { AuthFlowError, AuthService } from "./auth-service.js";
import type { KakaoAuthClientLike } from "./kakao-client.js";

const authUser: AuthUser = {
  id: "00000000-0000-4000-8000-000000000000",
  provider: "KAKAO",
  displayName: "춘식이",
  profileImageUrl: null,
};

function authConfig() {
  return loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "rest-key",
    KAKAO_OAUTH_CLIENT_SECRET: "client-secret",
    KAKAO_OAUTH_REDIRECT_URI:
      "http://localhost:8080/api/v1/auth/kakao/callback",
    AUTH_SESSION_SECRET: "a-secure-session-secret-with-32-characters",
  });
}

describe("카카오 웹 로그인 서비스", () => {
  it("state를 검증하고 카카오 토큰 대신 해시된 CHIMap 세션만 저장한다", async () => {
    let storedTokenHash: string | undefined;
    const store: AuthStore = {
      upsertOAuthUser: vi.fn(async () => authUser),
      upsertKakaoUser: vi.fn(async (_identity: KakaoIdentity) => authUser),
      createSession: vi.fn(async (input) => {
        storedTokenHash = input.tokenHash;
      }),
      findUserBySession: vi.fn(async () => authUser),
      revokeSession: vi.fn(async () => undefined),
    };
    const client: KakaoAuthClientLike = {
      authorizeUrl: (state) => `https://kauth.kakao.com/oauth/authorize?state=${state}`,
      exchangeAuthorizationCode: vi.fn(async () => "provider-access-token"),
      getIdentity: vi.fn(async () => ({
        providerUserId: "123456789",
        displayName: "춘식이",
        profileImageUrl: null,
      })),
    };
    const service = new AuthService(authConfig(), store, client);
    const started = service.beginWebLogin();
    const state = new URL(started.authorizeUrl).searchParams.get("state");

    const completed = await service.completeWebLogin({
      code: "authorization-code",
      returnedState: state as string,
      stateCookie: started.stateCookie,
    });

    expect(completed.user).toEqual(authUser);
    expect(completed.sessionToken).not.toBe("provider-access-token");
    expect(storedTokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(storedTokenHash).not.toContain(completed.sessionToken);
    expect(store.upsertKakaoUser).toHaveBeenCalledWith({
      providerUserId: "123456789",
      displayName: "춘식이",
      profileImageUrl: null,
    });
  });

  it("쿠키와 일치하지 않는 state를 카카오에 전달하기 전에 거절한다", async () => {
    const store = {
      upsertKakaoUser: vi.fn(),
      createSession: vi.fn(),
      findUserBySession: vi.fn(),
      revokeSession: vi.fn(),
    } as unknown as AuthStore;
    const client = {
      authorizeUrl: (state: string) => `https://example.com?state=${state}`,
      exchangeAuthorizationCode: vi.fn(),
      getIdentity: vi.fn(),
    } as unknown as KakaoAuthClientLike;
    const service = new AuthService(authConfig(), store, client);
    const started = service.beginWebLogin();

    await expect(
      service.completeWebLogin({
        code: "authorization-code",
        returnedState: "attacker-state",
        stateCookie: started.stateCookie,
      }),
    ).rejects.toMatchObject<AuthFlowError>({ code: "AUTH_STATE_INVALID" });
    expect(client.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("설정되지 않은 환경에서는 선택형 로그인만 비활성화한다", async () => {
    const service = new AuthService(
      loadConfig({ NODE_ENV: "test" }),
      {} as AuthStore,
    );

    expect(service.enabled).toBe(false);
    expect(await service.getSessionUser("ignored")).toBeNull();
    expect(() => service.beginWebLogin()).toThrow(/준비하고 있어요/u);
  });
});
