import request from "supertest";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import type { TagoRouteProviderObservation } from "./transit/tago-client.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

describe("provider 구조화 로그", () => {
  it("TAGO 요청을 request ID와 안전한 timing 필드로 연결한다", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      KAKAO_REST_API_KEY: "private-kakao-key",
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
    let observeProvider:
      | ((observation: TagoRouteProviderObservation) => void)
      | undefined;
    const transitService = {
      repository,
      setRouteProviderMetricsObserver: (
        observer: (observation: TagoRouteProviderObservation) => void,
      ) => {
        observeProvider = observer;
      },
      getNearbyStops: async () => {
        observeProvider?.({
          provider: "TAGO",
          operation: "NEARBY_STOPS",
          outcome: "HTTP_5XX",
          timeoutOrigin: "NONE",
          durationMilliseconds: 42,
        });
        return { items: [], partial: true };
      },
    } as unknown as TransitService;
    const info = vi.fn();
    const logger = {
      info,
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    const metrics = new AppMetrics({ config, repository });
    const app = createApp({ config, transitService, metrics, logger });

    const response = await request(app)
      .get("/api/v1/transit/bus/stops/nearby")
      .query({ lat: 36.35, lng: 127.37 });

    expect(response.status).toBe(200);
    const providerLog = info.mock.calls
      .map(([entry]) => entry)
      .find((entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "event" in entry &&
        entry.event === "route.provider"
      );
    expect(providerLog).toMatchObject({
      event: "route.provider",
      requestId: response.headers["x-request-id"],
      phase: "HTTP_REQUEST",
      elapsedMilliseconds: expect.any(Number),
      remainingBudgetMilliseconds: null,
      provider: "TAGO",
      operation: "NEARBY_STOPS",
      outcome: "HTTP_5XX",
      providerDurationMilliseconds: 42,
    });
    expect(JSON.stringify(providerLog)).not.toContain("36.35");
    expect(JSON.stringify(providerLog)).not.toContain("127.37");
    expect(JSON.stringify(providerLog)).not.toContain("private-kakao-key");
  });
});
