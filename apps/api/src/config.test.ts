import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("프로세스의 무관한 환경변수는 무시한다", () => {
    expect(
      loadConfig({
        PATH: "/usr/bin",
        HOME: "/tmp/example",
        KAKAO_MODE: "mock",
      }),
    ).toMatchObject({
      kakaoMode: "mock",
      port: 8080,
      webOrigin: "http://localhost:5173",
    });
  });

  it("루트 env의 빈 선택 경로는 미설정으로 처리한다", () => {
    const config = loadConfig({
      KAKAO_MODE: "mock",
      WEB_DIST_PATH: "",
      TRANSIT_DB_PATH: "",
    });
    expect(config.webDistPath).toBeUndefined();
    expect(config).toMatchObject({
      transitDatabasePath: ".data/transit.sqlite",
    });
  });

  it("live 모드는 REST API 키 없이 시작하지 않는다", () => {
    expect(() => loadConfig({ KAKAO_MODE: "live" })).toThrow(
      /KAKAO_REST_API_KEY/u,
    );
  });

  it("유효한 live 설정을 명시적 타입으로 변환한다", () => {
    expect(
      loadConfig({
        NODE_ENV: "production",
        KAKAO_MODE: "live",
        KAKAO_REST_API_KEY: "not-a-real-key",
        PORT: "9090",
        WEB_ORIGIN: "https://chimap.madcamp-kaist.org",
        WEB_DIST_PATH: "/app/web",
        LIVE_API_TEST: "1",
      }),
    ).toMatchObject({
      nodeEnv: "production",
      kakaoMode: "live",
      kakaoRestApiKey: "not-a-real-key",
      port: 9090,
      webOrigin: "https://chimap.madcamp-kaist.org",
      webDistPath: "/app/web",
      liveApiTest: true,
    });
  });

  it("production에서는 mock 대중교통 fixture를 거부한다", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        KAKAO_MODE: "mock",
        USE_MOCK_TRANSIT_DATA: "true",
      }),
    ).toThrow(/production.*mock/u);
  });

  it("서비스별 TAGO 키와 공통 키, TTL 설정을 분리한다", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        KAKAO_MODE: "mock",
        DATA_GO_KR_SERVICE_KEY: "common",
        TAGO_BUS_STOP_SERVICE_KEY: "stop",
        TAGO_ARRIVAL_CACHE_TTL_SECONDS: "33",
      }),
    ).toMatchObject({
      dataGoKrServiceKey: "common",
      tagoServiceKeys: { stop: "stop" },
      tagoCacheTtlSeconds: { arrivals: 33 },
      useMockTransitData: false,
    });
  });
});
