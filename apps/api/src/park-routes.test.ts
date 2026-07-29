import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

const token = "park-import-token-with-at-least-32-characters";

function testApp() {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
    PARK_ROUTE_IMPORT_ENABLED: "1",
    PARK_ROUTE_IMPORT_TOKEN: token,
  });
  const pool = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    query: async () => ({ rows: [], rowCount: 0 }),
  };
  const repository = {
    pool,
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

describe("공원 경로 internal API", () => {
  it("token 누락과 오류를 401로 거절하고 request id를 제공한다", async () => {
    const missing = await request(testApp()).get(
      "/api/v1/internal/park-routes/status",
    );
    expect(missing.status).toBe(401);
    expect(missing.headers["x-request-id"]).toBeTruthy();
    expect(missing.body.error.code).toBe("PARK_IMPORT_UNAUTHORIZED");

    const invalid = await request(testApp())
      .get("/api/v1/internal/park-routes/status")
      .set("Authorization", `Bearer ${"x".repeat(40)}`);
    expect(invalid.status).toBe(401);
  });

  it("인증 후 active dataset이 없는 status를 반환한다", async () => {
    const response = await request(testApp())
      .get("/api/v1/internal/park-routes/status")
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      importEnabled: true,
      integrationEnabled: false,
      activeDataset: null,
    });
  });

  it("인증 후에만 import JSON을 parse하고 잘못된 body를 400으로 거절한다", async () => {
    const unauthorized = await request(testApp())
      .post("/api/v1/internal/park-routes/import")
      .set("Content-Type", "application/json")
      .send("{");
    expect(unauthorized.status).toBe(401);

    const malformed = await request(testApp())
      .post("/api/v1/internal/park-routes/import")
      .set("Authorization", `Bearer ${token}`)
      .set("Content-Type", "application/json")
      .send("{");
    expect(malformed.status).toBe(400);
  });
});
