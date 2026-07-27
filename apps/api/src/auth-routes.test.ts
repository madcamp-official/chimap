import type { AuthUser } from "@chimap/contracts";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { AuthServiceLike } from "./auth/auth-service.js";
import {
  MobileAuthError,
  type MobileAuthServiceLike,
} from "./auth/mobile-auth-service.js";
import { loadConfig } from "./config.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

const user: AuthUser = {
  id: "00000000-0000-4000-8000-000000000000",
  provider: "KAKAO",
  displayName: "춘식이",
  profileImageUrl: null,
};

function authService(): AuthServiceLike {
  return {
    enabled: true,
    sessionTtlMilliseconds: 30 * 24 * 60 * 60 * 1000,
    beginWebLogin: () => ({
      authorizeUrl:
        "https://kauth.kakao.com/oauth/authorize?state=expected-state",
      stateCookie: "expected-state.signed",
    }),
    completeWebLogin: vi.fn(async () => ({
      user,
      sessionToken: "chimap-session-token",
    })),
    getSessionUser: vi.fn(async (token) =>
      token === "chimap-session-token" ? user : null,
    ),
    logout: vi.fn(async () => undefined),
  };
}

function mobileAuthService(): MobileAuthServiceLike {
  return {
    enabled: true,
    appleEnabled: false,
    loginWithKakao: vi.fn(async () => ({
      tokenType: "Bearer",
      accessToken: "a".repeat(43),
      accessExpiresAt: "2026-07-26T03:15:00.000Z",
      refreshToken: "r".repeat(43),
      refreshExpiresAt: "2026-08-25T03:00:00.000Z",
      user,
    })),
    loginWithApple: vi.fn(async () => ({
      tokenType: "Bearer",
      accessToken: "a".repeat(43),
      accessExpiresAt: "2026-07-26T03:15:00.000Z",
      refreshToken: "r".repeat(43),
      refreshExpiresAt: "2026-08-25T03:00:00.000Z",
      user: { ...user, provider: "APPLE" as const },
    })),
    refresh: vi.fn(async () => ({
      tokenType: "Bearer",
      accessToken: "b".repeat(43),
      accessExpiresAt: "2026-07-26T03:15:00.000Z",
      refreshToken: "s".repeat(43),
      refreshExpiresAt: "2026-08-25T03:00:00.000Z",
      user,
    })),
    getAccessUser: vi.fn(async (token) =>
      token === "a".repeat(43) ? user : null,
    ),
    logout: vi.fn(async () => undefined),
    deleteAccount: vi.fn(async () => undefined),
  };
}

function testApp(
  auth: AuthServiceLike,
  mobileAuth: MobileAuthServiceLike = mobileAuthService(),
  environment: NodeJS.ProcessEnv = {},
) {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
    WEB_ORIGIN: "http://localhost:5173",
    ...environment,
  });
  const repository = {
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    status: async () => ({
      connected: true,
      postgis: true,
      migrationsCurrent: true,
    }),
    stats: async () => ({
      stops: 0,
      linkedStops: 0,
      routes: 0,
      routeStops: 0,
      subwayStations: 0,
      activeSubwayStations: 0,
      mappedSubwayStations: 0,
    }),
  } as unknown as TransitRepository;
  return createApp({
    config,
    authService: auth,
    mobileAuthService: mobileAuth,
    transitService: { repository } as unknown as TransitService,
  });
}

describe("카카오 로그인 HTTP 흐름", () => {
  it("검증된 카카오 모바일 token을 CHIMap opaque pair로 교환한다", async () => {
    const mobileAuth = mobileAuthService();
    const response = await request(testApp(authService(), mobileAuth))
      .post("/api/v1/auth/kakao/mobile")
      .send({
        kakaoAccessToken: "provider-access-token-long-enough",
        platform: "android",
      });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.accessToken).toBe("a".repeat(43));
    expect(mobileAuth.loginWithKakao).toHaveBeenCalledWith({
      kakaoAccessToken: "provider-access-token-long-enough",
      platform: "android",
    });
  });

  it("검증된 Apple identity token을 같은 CHIMap opaque pair 계약으로 교환한다", async () => {
    const mobileAuth = mobileAuthService();
    const response = await request(testApp(authService(), mobileAuth))
      .post("/api/v1/auth/apple/mobile")
      .send({
        identityToken: "identity-token-long-enough",
        authorizationCode: "authorization-code",
        nonce: "nonce-value-long-enough",
        displayName: "Apple 사용자",
        platform: "ios",
      });

    expect(response.status).toBe(200);
    expect(response.body.user.provider).toBe("APPLE");
    expect(mobileAuth.loginWithApple).toHaveBeenCalledWith({
      identityToken: "identity-token-long-enough",
      authorizationCode: "authorization-code",
      nonce: "nonce-value-long-enough",
      displayName: "Apple 사용자",
      platform: "ios",
    });
  });

  it("플랫폼별 최소 버전과 인증 가능 수단을 mobile config로 제공한다", async () => {
    const response = await request(testApp(authService()))
      .get("/api/v1/mobile-config")
      .set("X-Client-Platform", "ios")
      .set("X-App-Version", "0.1.0")
      .set("X-Contract-Version", "v1");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toMatchObject({
      contractVersion: "v1",
      minimumSupportedVersion: { ios: "0.1.0", android: "0.1.0" },
      authentication: {
        guestEnabled: true,
        kakaoEnabled: true,
        appleEnabled: false,
      },
    });
  });

  it("부분 metadata header와 지원 종료된 mobile version을 거절한다", async () => {
    const partial = await request(testApp(authService()))
      .get("/api/v1/health")
      .set("X-Client-Platform", "ios");
    expect(partial.status).toBe(400);

    const outdated = await request(
      testApp(authService(), mobileAuthService(), {
        MOBILE_MIN_IOS_VERSION: "1.0.0",
      }),
    )
      .get("/api/v1/auth/me")
      .set("X-Client-Platform", "ios")
      .set("X-App-Version", "0.9.0")
      .set("X-Contract-Version", "v1")
      .set("Authorization", `Bearer ${"a".repeat(43)}`);
    expect(outdated.status).toBe(426);
    expect(outdated.body.error.code).toBe("CLIENT_UPDATE_REQUIRED");
  });

  it("모바일 access bearer로 현재 사용자를 확인한다", async () => {
    const response = await request(testApp(authService()))
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${"a".repeat(43)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user });
  });

  it("access와 refresh를 검증해 모바일 계정을 삭제한다", async () => {
    const mobileAuth = mobileAuthService();
    const response = await request(testApp(authService(), mobileAuth))
      .post("/api/v1/auth/mobile/account/delete")
      .set("Authorization", `Bearer ${"a".repeat(43)}`)
      .send({ refreshToken: "r".repeat(43), confirmation: "DELETE" });

    expect(response.status).toBe(204);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mobileAuth.deleteAccount).toHaveBeenCalledWith(
      "a".repeat(43),
      "r".repeat(43),
    );
  });

  it("만료 grace token 상태를 구분해 노출하지 않고 같은 401로 응답한다", async () => {
    const mobileAuth = mobileAuthService();
    mobileAuth.refresh = vi.fn(async () => {
      throw new MobileAuthError(
        "AUTH_SESSION_INVALID",
        "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
      );
    });
    const response = await request(testApp(authService(), mobileAuth))
      .post("/api/v1/auth/token/refresh")
      .send({ refreshToken: "r".repeat(43) });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_SESSION_INVALID");
    expect(JSON.stringify(response.body)).not.toContain("reuse");
  });

  it("웹 사용자는 로그인하지 않은 세션으로 계속 이용할 수 있다", async () => {
    const response = await request(testApp(authService())).get(
      "/api/v1/auth/session",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      authenticated: false,
      kakaoLoginAvailable: true,
      user: null,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("서명할 state 쿠키를 만들고 카카오 인가 화면으로 이동한다", async () => {
    const response = await request(testApp(authService())).get(
      "/api/v1/auth/kakao/start",
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("kauth.kakao.com/oauth/authorize");
    expect(response.headers["set-cookie"]?.[0]).toContain(
      "chimap_kakao_state=expected-state.signed",
    );
    expect(response.headers["set-cookie"]?.[0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]?.[0]).toContain("SameSite=Lax");
  });

  it("콜백을 처리해 HttpOnly CHIMap 세션을 발급한다", async () => {
    const auth = authService();
    const response = await request(testApp(auth))
      .get(
        "/api/v1/auth/kakao/callback?code=authorize-code&state=expected-state",
      )
      .set("Cookie", "chimap_kakao_state=expected-state.signed");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(
      "http://localhost:5173/?auth=kakao-success",
    );
    expect(auth.completeWebLogin).toHaveBeenCalledWith({
      code: "authorize-code",
      returnedState: "expected-state",
      stateCookie: "expected-state.signed",
    });
    expect(
      (response.headers["set-cookie"] as string[]).some(
        (cookie) =>
          cookie.includes("chimap_session=chimap-session-token") &&
          cookie.includes("HttpOnly") &&
          cookie.includes("SameSite=Lax"),
      ),
    ).toBe(true);
  });

  it("서비스 세션을 폐기하고 로그인 없이 사용할 수 있게 돌아간다", async () => {
    const auth = authService();
    const response = await request(testApp(auth))
      .post("/api/v1/auth/logout")
      .set("Cookie", "chimap_session=chimap-session-token");

    expect(response.status).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith("chimap-session-token");
    expect(response.headers["set-cookie"]?.[0]).toContain("chimap_session=");
  });
});
