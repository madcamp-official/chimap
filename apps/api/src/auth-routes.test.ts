import type { AuthUser } from "@chimap/contracts";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import type { AuthServiceLike } from "./auth/auth-service.js";
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

function testApp(auth: AuthServiceLike) {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
    WEB_ORIGIN: "http://localhost:5173",
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
    }),
  } as unknown as TransitRepository;
  return createApp({
    config,
    authService: auth,
    transitService: { repository } as unknown as TransitService,
  });
}

describe("카카오 로그인 HTTP 흐름", () => {
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
