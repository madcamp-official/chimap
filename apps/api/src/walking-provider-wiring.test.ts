import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

function appFor(environment: NodeJS.ProcessEnv) {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
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
  const transitService = { repository } as unknown as TransitService;
  const metrics = new AppMetrics({ config, repository });
  return createApp({ config, transitService, metrics });
}

describe("상세 도보 공급자 wiring", () => {
  it("기본 설정은 기존 Kakao walking provider를 유지한다", () => {
    expect(appFor({}).locals.walkingRouter).toBe("KAKAO");
  });

  it("WALKING_ROUTER=VALHALLA이면 상세 도보 공급자만 Valhalla로 분리한다", () => {
    expect(appFor({
      WALKING_ROUTER: "VALHALLA",
      VALHALLA_BASE_URL: "http://valhalla.internal:8002",
      TRANSIT_GEOMETRY_V2_ENABLED: "1",
      RECOMMENDATION_SELECTED_GEOMETRY_ENABLED: "1",
    }).locals.walkingRouter).toBe("VALHALLA");
  });
});
