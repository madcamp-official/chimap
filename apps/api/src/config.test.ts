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

  it("모바일 auth를 켜면 Kakao app ID와 32-byte grace 암호화 키를 요구한다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        KAKAO_REST_API_KEY: "rest-key",
        AUTH_MOBILE_ENABLED: "1",
        KAKAO_APP_ID: "123456",
        AUTH_REFRESH_RETRY_ENCRYPTION_KEY: "too-short",
      }),
    ).toThrow(/32바이트/u);

    expect(
      loadConfig({
        NODE_ENV: "test",
        KAKAO_REST_API_KEY: "rest-key",
        AUTH_MOBILE_ENABLED: "1",
        KAKAO_APP_ID: "123456",
        AUTH_REFRESH_RETRY_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      }).mobileAuth,
    ).toMatchObject({
      kakaoAppId: "123456",
      accessTtlMinutes: 15,
      refreshTtlDays: 30,
      graceSeconds: 120,
    });
  });

  it("Apple server exchange credential은 전부 갖춰졌을 때만 활성화한다", () => {
    const base = {
      NODE_ENV: "test",
      KAKAO_REST_API_KEY: "rest-key",
      AUTH_MOBILE_ENABLED: "1",
      KAKAO_APP_ID: "123456",
      AUTH_REFRESH_RETRY_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
      APPLE_CLIENT_ID_IOS: "org.madcamp.chimap",
    };
    expect(() => loadConfig(base)).toThrow(/Apple 로그인/u);

    const privateKey = "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----";
    expect(
      loadConfig({
        ...base,
        APPLE_TEAM_ID: "TEAMID1234",
        APPLE_KEY_ID: "KEYID12345",
        APPLE_PRIVATE_KEY_BASE64: Buffer.from(privateKey).toString("base64"),
      }).mobileAuth?.apple,
    ).toEqual({
      clientId: "org.madcamp.chimap",
      teamId: "TEAMID1234",
      keyId: "KEYID12345",
      privateKey,
    });
  });

  it("추천 경로는 공개 주변 조회보다 넓은 1.2km까지 탐색한다", () => {
    const config = loadConfig({ NODE_ENV: "test" });

    expect(config.transit.maxNearbyStopDistanceMeters).toBe(500);
    expect(config.transit.routeSearchMaxDistanceMeters).toBe(1200);
  });

  it("transit-v2는 feature flag로만 활성화한다", () => {
    expect(loadConfig({ NODE_ENV: "test" }).transit.geometryV2Enabled).toBe(false);
    expect(loadConfig({
      NODE_ENV: "test",
      TRANSIT_GEOMETRY_V2_ENABLED: "1",
    }).transit.geometryV2Enabled).toBe(true);
  });

  it("추천 timeout·선택 geometry·버스 pair v3는 서로 독립적인 feature flag다", () => {
    const defaults = loadConfig({ NODE_ENV: "test" });
    expect(defaults.recommendation).toEqual({
      phasedTimeoutsEnabled: false,
      selectedGeometryEnabled: false,
    });
    expect(defaults.transit.busGeometryPairV3Enabled).toBe(false);

    const enabled = loadConfig({
      NODE_ENV: "test",
      RECOMMENDATION_PHASED_TIMEOUTS_ENABLED: "1",
      RECOMMENDATION_SELECTED_GEOMETRY_ENABLED: "1",
      BUS_GEOMETRY_PAIR_V3_ENABLED: "1",
    });
    expect(enabled.recommendation).toEqual({
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
    });
    expect(enabled.transit.busGeometryPairV3Enabled).toBe(true);
  });

  it("Valhalla 도보 라우터 설정과 허용 범위를 검증한다", () => {
    expect(loadConfig({ NODE_ENV: "test" }).walking).toEqual({
      router: "KAKAO",
      timeoutMs: 3_500,
      retryCount: 1,
      cacheTtlSeconds: 1_800,
      maxSnapDistanceMeters: 100,
      maxDetourRatio: 5,
    });
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        WALKING_ROUTER: "VALHALLA",
      }),
    ).toThrow(/VALHALLA_BASE_URL/u);

    expect(loadConfig({
      NODE_ENV: "test",
      WALKING_ROUTER: "VALHALLA",
      VALHALLA_BASE_URL: "http://10.0.0.8:8002/internal/valhalla",
      TRANSIT_GEOMETRY_V2_ENABLED: "1",
      RECOMMENDATION_SELECTED_GEOMETRY_ENABLED: "1",
      VALHALLA_HTTP_TIMEOUT_MS: "10000",
      VALHALLA_HTTP_RETRY_COUNT: "3",
      VALHALLA_WALK_CACHE_TTL_SECONDS: "1",
      VALHALLA_MAX_SNAP_DISTANCE_METERS: "500",
      VALHALLA_MAX_DETOUR_RATIO: "20",
    }).walking).toEqual({
      router: "VALHALLA",
      valhallaBaseUrl: "http://10.0.0.8:8002/internal/valhalla",
      timeoutMs: 10_000,
      retryCount: 3,
      cacheTtlSeconds: 1,
      maxSnapDistanceMeters: 500,
      maxDetourRatio: 20,
    });

    for (const valhallaBaseUrl of [
      "ftp://10.0.0.8:8002",
      "http://router:secret@10.0.0.8:8002",
      "https://valhalla.internal:8002?token=secret",
      "https://valhalla.internal:8002#route",
    ]) {
      expect(() =>
        loadConfig({
          NODE_ENV: "test",
          WALKING_ROUTER: "VALHALLA",
          VALHALLA_BASE_URL: valhallaBaseUrl,
          TRANSIT_GEOMETRY_V2_ENABLED: "1",
          RECOMMENDATION_SELECTED_GEOMETRY_ENABLED: "1",
        }),
      ).toThrow(/HTTP\(S\)/u);
    }

    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        WALKING_ROUTER: "VALHALLA",
        VALHALLA_BASE_URL: "http://valhalla.internal:8002",
        RECOMMENDATION_SELECTED_GEOMETRY_ENABLED: "1",
      }),
    ).toThrow(/TRANSIT_GEOMETRY_V2_ENABLED=1/u);
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        WALKING_ROUTER: "VALHALLA",
        VALHALLA_BASE_URL: "http://valhalla.internal:8002",
        TRANSIT_GEOMETRY_V2_ENABLED: "1",
      }),
    ).toThrow(/RECOMMENDATION_SELECTED_GEOMETRY_ENABLED=1/u);

    for (const invalid of [
      { VALHALLA_HTTP_TIMEOUT_MS: "499" },
      { VALHALLA_HTTP_TIMEOUT_MS: "10001" },
      { VALHALLA_HTTP_RETRY_COUNT: "-1" },
      { VALHALLA_HTTP_RETRY_COUNT: "4" },
      { VALHALLA_WALK_CACHE_TTL_SECONDS: "0" },
      { VALHALLA_MAX_SNAP_DISTANCE_METERS: "9" },
      { VALHALLA_MAX_SNAP_DISTANCE_METERS: "501" },
      { VALHALLA_MAX_DETOUR_RATIO: "0.9" },
      { VALHALLA_MAX_DETOUR_RATIO: "21" },
    ]) {
      expect(() => loadConfig({ NODE_ENV: "test", ...invalid })).toThrow();
    }
  });

  it("공원 Import token과 추천 조회 범위를 검증한다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PARK_ROUTE_IMPORT_ENABLED: "1",
        PARK_ROUTE_IMPORT_TOKEN: "short",
      }),
    ).toThrow(/32자/u);
    const config = loadConfig({
      NODE_ENV: "test",
      PARK_ROUTE_IMPORT_ENABLED: "1",
      PARK_ROUTE_IMPORT_TOKEN: "p".repeat(32),
      PARK_ROUTE_INTEGRATION_ENABLED: "1",
      PARK_ROUTE_SEARCH_RADIUS_METERS: "1000",
      PARK_ROUTE_MAX_CANDIDATES: "5",
    });
    expect(config.parkRoutes).toMatchObject({
      importEnabled: true,
      integrationEnabled: true,
      searchRadiusMeters: 1000,
      maxCandidates: 5,
    });
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        PARK_ROUTE_SEARCH_RADIUS_METERS: "99",
      }),
    ).toThrow();
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

  it("모바일 최소 버전과 maintenance 안내를 안전하게 구성한다", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      MOBILE_MIN_IOS_VERSION: "1.2.3",
      MOBILE_MIN_ANDROID_VERSION: "1.1.0",
      MOBILE_SUPPORTED_REGIONS: "대전, 세종",
      MOBILE_VEHICLE_POLLING_INTERVAL_SECONDS: "20",
    });
    expect(config.mobileClient).toEqual({
      minimumSupportedVersion: { ios: "1.2.3", android: "1.1.0" },
      maintenance: { enabled: false, message: null },
      supportedRegions: ["대전", "세종"],
      privacyPolicyVersion: "2026-07-26",
      vehiclePollingIntervalSeconds: 20,
      guestEnabled: true,
    });
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        MOBILE_MAINTENANCE_ENABLED: "1",
      }),
    ).toThrow(/maintenance/u);
  });
});
