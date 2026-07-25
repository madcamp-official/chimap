import type { PlaceSearchResponse } from "@chimap/contracts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import type { TransitRepository } from "../transit/transit-repository.js";
import { AppMetrics } from "./metrics.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function repositoryForMetrics(): TransitRepository {
  return {
    pool: {
      totalCount: 4,
      idleCount: 3,
      waitingCount: 1,
    },
    status: async () => ({
      connected: true,
      postgis: true,
      migrationsCurrent: true,
    }),
    stats: async () => ({
      stops: 228_119,
      linkedStops: 2_188,
      routes: 127,
      routeStops: 4_469,
    }),
  } as unknown as TransitRepository;
}

describe("운영 metrics", () => {
  it("검색·HTTP·DB 상태를 개인정보 없는 Prometheus 지표로 노출한다", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      METRICS_ENABLED: "1",
      KAKAO_REST_API_KEY: "kakao-key",
      NAVER_MAP_NCP_KEY_ID: "naver-id",
      NAVER_MAP_NCP_KEY: "naver-secret",
      TAGO_BUS_STOP_SERVICE_KEY: "stop-key",
      TAGO_BUS_ROUTE_SERVICE_KEY: "route-key",
      TAGO_BUS_ARRIVAL_SERVICE_KEY: "arrival-key",
      TAGO_BUS_LOCATION_SERVICE_KEY: "location-key",
      APP_COMMIT_SHA: "3e8684e",
    });
    const metrics = new AppMetrics({
      config,
      repository: repositoryForMetrics(),
    });
    const placeResult: PlaceSearchResponse = {
      items: [],
      meta: {
        provider: "NONE",
        strategy: "NONE",
        fallbackUsed: true,
        degraded: false,
      },
    };

    metrics.observeHttp({
      method: "GET",
      path: "/api/v1/places",
      status: 200,
      durationSeconds: 0.25,
    });
    metrics.observePlace("resolve", placeResult);
    const output = await metrics.metrics();

    expect(output).toContain(
      'chimap_http_requests_total{method="GET",route="/api/v1/places",status="200",status_class="2xx",service="chimap-api"} 1',
    );
    expect(output).toContain('scope="resolve"');
    expect(output).toContain('outcome="empty"');
    expect(output).toContain(
      'chimap_database_pool_connections{state="waiting",service="chimap-api"} 1',
    );
    expect(output).toContain(
      'chimap_transit_rows{kind="stops",service="chimap-api"} 228119',
    );
    expect(output).not.toContain("query=");
    expect(output).not.toContain("naver-secret");
  });

  it("최근 교통 동기화 성공 시각과 실패 노선 수를 운영 지표로 노출한다", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chimap-sync-status-"));
    temporaryDirectories.push(directory);
    const statusPath = join(directory, "transit-sync-latest.json");
    await writeFile(
      statusPath,
      JSON.stringify({
        attemptedAt: "2026-07-25T16:30:00.000Z",
        success: false,
        lastSuccessAt: "2026-07-24T16:30:00.000Z",
        areaCount: 2,
        syncedRouteCount: 126,
        failedRouteCount: 1,
      }),
      "utf8",
    );
    const config = loadConfig({
      NODE_ENV: "test",
      TRANSIT_SYNC_STATUS_PATH: statusPath,
    });
    const metrics = new AppMetrics({
      config,
      repository: repositoryForMetrics(),
    });

    const output = await metrics.metrics();

    expect(output).toContain(
      'chimap_transit_sync_last_success_timestamp_seconds{service="chimap-api"} 1784910600',
    );
    expect(output).toContain(
      'chimap_transit_sync_last_attempt_success{service="chimap-api"} 0',
    );
    expect(output).toContain(
      'chimap_transit_sync_failed_routes{service="chimap-api"} 1',
    );
  });
});
