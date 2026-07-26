import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("환경변수 보안 경계", () => {
  it("카카오 로그인 설정은 네 개의 보안 값을 함께 요구한다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        KAKAO_REST_API_KEY: "rest-key",
        KAKAO_OAUTH_CLIENT_SECRET: "oauth-secret",
      }),
    ).toThrow(/모두 설정해야 합니다/u);

    expect(
      loadConfig({
        NODE_ENV: "test",
        KAKAO_REST_API_KEY: "rest-key",
        KAKAO_OAUTH_CLIENT_SECRET: "oauth-secret",
        KAKAO_OAUTH_REDIRECT_URI:
          "http://localhost:8080/api/v1/auth/kakao/callback",
        AUTH_SESSION_SECRET: "a-secure-session-secret-with-32-characters",
      }).kakaoAuth,
    ).toMatchObject({
      clientId: "rest-key",
      redirectUri: "http://localhost:8080/api/v1/auth/kakao/callback",
      sessionTtlDays: 30,
    });
  });

  it("NAVER 서버 Client Secret을 브라우저 공개 변수로 사용할 수 없다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        NAVER_MAP_NCP_KEY_ID: "public-client-id",
        NAVER_MAP_NCP_KEY: "server-client-secret",
        VITE_NAVER_MAP_NCP_KEY_ID: "server-client-secret",
      }),
    ).toThrow(/브라우저 공개 NAVER Key ID/u);
  });

  it("추천 경로는 공개 주변 조회보다 넓은 1.2km까지 탐색한다", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.transit.maxNearbyStopDistanceMeters).toBe(500);
    expect(config.transit.routeSearchMaxDistanceMeters).toBe(1200);
  });

  it("추천 경로 탐색 상한이 기본 반경보다 작으면 거절한다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS: "500",
        TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS: "499",
      }),
    ).toThrow(/기본 주변 정류장 반경보다 작을 수 없습니다/u);
  });
});
