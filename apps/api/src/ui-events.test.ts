import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

function repositoryForTest(): TransitRepository {
  return {
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
}

function testApp() {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
  });
  const repository = repositoryForTest();
  const transitService = { repository } as unknown as TransitService;
  const metrics = new AppMetrics({ config, repository });
  return createApp({ config, transitService, metrics });
}

describe("POST /api/v1/ui-events", () => {
  it("허용된 enum 이벤트만 집계하고 204로 응답한다", async () => {
    const response = await request(testApp()).post("/api/v1/ui-events").send({
      version: "route-pulse-v1",
      event: "route_selected",
      uiState: "route-selected",
      experienceMode: "compact",
      outcome: "success",
    });

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });

  it("검색어·좌표·식별자가 섞인 이벤트를 거절한다", async () => {
    const response = await request(testApp()).post("/api/v1/ui-events").send({
      version: "route-pulse-v1",
      event: "place_selected",
      uiState: "editing-place",
      experienceMode: "guided",
      query: "대전역",
      location: { lat: 36.3, lng: 127.4 },
      placeId: "private-place",
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
