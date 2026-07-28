import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import { RecommendationService } from "./services/recommendation-service.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

function testApp(geometryV2Enabled = false) {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
    TRANSIT_GEOMETRY_V2_ENABLED: geometryV2Enabled ? "1" : "0",
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("track-v1 헤더가 있는 새 클라이언트만 선로 profile을 요청한다", async () => {
    const createRecommendations = vi
      .spyOn(RecommendationService.prototype, "createRecommendations")
      .mockRejectedValue(new Error("test stop"));
    const validRequest = {
      ...automaticRequest,
      destination: {
        ...place,
        id: "destination",
        name: "도착",
        location: { lng: 127.43, lat: 36.33 },
      },
    };

    await request(testApp())
      .post("/api/v1/recommendations")
      .set("X-Route-Geometry", "track-v1")
      .send(validRequest);

    expect(createRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ geometryProfile: "TRACK_V1" }),
    );
  });

  it("feature flag가 켜진 transit-v2 요청은 통합 geometry profile을 사용한다", async () => {
    const createRecommendations = vi
      .spyOn(RecommendationService.prototype, "createRecommendations")
      .mockRejectedValue(new Error("test stop"));
    await request(testApp(true))
      .post("/api/v1/recommendations")
      .set("X-Route-Geometry", "transit-v2")
      .send({
        ...automaticRequest,
        destination: {
          ...place,
          id: "destination",
          location: { lng: 127.43, lat: 36.33 },
        },
      });

    expect(createRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ geometryProfile: "TRANSIT_V2" }),
    );
  });

  it("feature flag가 꺼진 transit-v2 요청도 기존 지하철 선로는 유지한다", async () => {
    const createRecommendations = vi
      .spyOn(RecommendationService.prototype, "createRecommendations")
      .mockRejectedValue(new Error("test stop"));
    await request(testApp(false))
      .post("/api/v1/recommendations")
      .set("X-Route-Geometry", "transit-v2")
      .send({
        ...automaticRequest,
        destination: {
          ...place,
          id: "destination",
          location: { lng: 127.43, lat: 36.33 },
        },
      });

    expect(createRecommendations).toHaveBeenCalledWith(
      expect.objectContaining({ geometryProfile: "TRACK_V1" }),
    );
  });

  it("헤더가 없거나 알 수 없는 값이면 구버전 geometry를 유지한다", async () => {
    const createRecommendations = vi
      .spyOn(RecommendationService.prototype, "createRecommendations")
      .mockRejectedValue(new Error("test stop"));
    const validRequest = {
      ...automaticRequest,
      destination: {
        ...place,
        id: "destination",
        name: "도착",
        location: { lng: 127.43, lat: 36.33 },
      },
    };

    await request(testApp())
      .post("/api/v1/recommendations")
      .set("X-Route-Geometry", "track-v2")
      .send(validRequest);

    expect(createRecommendations.mock.calls[0]?.[0]).not.toHaveProperty(
      "geometryProfile",
    );
  });
});
