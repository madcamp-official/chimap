import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

function testApp() {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
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

const place = {
  id: "same-place",
  name: "같은 장소",
  address: "",
  roadAddress: "",
  category: "",
  location: { lng: 127.36, lat: 36.37 },
};

const automaticRequest = {
  origin: place,
  destination: place,
  currentSteps: 5200,
  goalSteps: 8000,
  walkingMetric: {
    stepLengthMeters: 0.69,
    source: "RESEARCH_ESTIMATE",
    modelVersion: "HAN_2026_V1",
  },
};

describe("POST /api/v1/recommendations 계약 전환", () => {
  it("자동 요청에는 deprecation 헤더를 붙이지 않는다", async () => {
    const response = await request(testApp())
      .post("/api/v1/recommendations")
      .send(automaticRequest);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("LOCATIONS_TOO_CLOSE");
    expect(response.headers.deprecation).toBeUndefined();
  });

  it("기존 시간 제약 요청은 허용하고 deprecation 헤더를 붙인다", async () => {
    const response = await request(testApp())
      .post("/api/v1/recommendations")
      .send({
        ...automaticRequest,
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        maxExtraMinutes: 20,
        safetyBufferMinutes: 3,
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("LOCATIONS_TOO_CLOSE");
    expect(response.headers.deprecation).toBe("true");
  });
});
