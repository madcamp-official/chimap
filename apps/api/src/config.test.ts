import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

describe("환경변수 보안 경계", () => {
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
