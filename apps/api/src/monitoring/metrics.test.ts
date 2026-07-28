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
      subwayStations: 1_097,
      activeSubwayStations: 1_097,
      mappedSubwayStations: 22,
    }),
    subwayTrackGeometryCoverage: async () => [
      {
        serviceLineId: "SL_TEST",
        segmentCount: 42,
        geometryCount: 42,
      },
    ],
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
    metrics.observeHttp({
      method: "GET",
      path: "/api/v1/transit/subway/stations/223/departures",
      status: 200,
      durationSeconds: 0.4,
    });
    metrics.observeTagoSubway({
      operation: "station_schedule",
      outcome: "success",
      durationSeconds: 0.35,
    });
    metrics.observePlace("resolve", placeResult);
    metrics.observeSubwayTrackGeometry({
      outcome: "fallback",
      reason: "CONTINUITY_GAP",
      source: "UNKNOWN",
      vertexCount: 3,
    });
    metrics.observeSubwayTrackGeometry({
      outcome: "track",
      reason: "NONE",
      source: "OSM",
      vertexCount: 37,
    });
    metrics.observeSubwayTrackResponseBytes(24_000);
    metrics.observeRouteGeometry({
      mode: "BUS",
      outcome: "APPROXIMATE",
      reason: "TIMEOUT",
      source: "FALLBACK",
      cacheState: "MISS",
      durationMilliseconds: 3_500,
      inputVertexCount: 5,
      outputVertexCount: 5,
      successfulSectionCount: 0,
      failedSectionCount: 4,
      routeId: "DJB30300067",
    });
    metrics.observeUiEvent({
      version: "route-pulse-v1",
      event: "recommendation_succeeded",
      uiState: "results",
      experienceMode: "guided",
      outcome: "success",
      durationBucket: "1to3s",
    });
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
    expect(output).toContain(
      'route="/api/v1/transit/subway/stations/:id/departures"',
    );
    expect(output).toContain(
      'chimap_tago_subway_requests_total{operation="station_schedule",outcome="success",service="chimap-api"} 1',
    );
    expect(output).toContain(
      'chimap_tago_subway_unmapped_stations{service="chimap-api"} 1075',
    );
    expect(output).not.toContain("query=");
    expect(output).not.toContain("naver-secret");
    expect(output).toContain(
      'chimap_ui_events_total{event="recommendation_succeeded",ui_state="results",experience_mode="guided",outcome="success",duration_bucket="1to3s",service="chimap-api"} 1',
    );
    expect(output).toContain(
      'chimap_subway_track_geometry_coverage_ratio{service_line_id="SL_TEST",service="chimap-api"} 1',
    );
    expect(output).toContain(
      'chimap_subway_track_geometry_fallback_total{reason="CONTINUITY_GAP",service="chimap-api"} 1',
    );
    expect(output).toContain(
      'chimap_subway_track_geometry_vertices_sum{service="chimap-api",source="OSM"} 37',
    );
    expect(output).toContain(
      'chimap_subway_track_geometry_response_bytes_sum{service="chimap-api"} 24000',
    );
    expect(output).toContain(
      'chimap_route_geometry_requests_total{mode="BUS",outcome="APPROXIMATE",reason="TIMEOUT",source="FALLBACK",service="chimap-api"} 1',
    );
    expect(output).toContain(
      'chimap_route_geometry_cache_total{mode="BUS",outcome="MISS",service="chimap-api"} 1',
    );
    expect(output).not.toContain("DJB30300067");
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
