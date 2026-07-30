import type {
  ErrorCode,
  PlaceSearchResponse,
  UiEventPayload,
} from "@chimap/contracts";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { SubwayGeometryObservation } from "../providers/subway-track-geometry.js";
import type { RouteGeometryObservation } from "../providers/route-geometry.js";
import type {
  RecommendationPhaseObservation,
  RecommendationTimeoutOrigin,
} from "../services/recommendation-service.js";
import type { TransitRepository } from "../transit/transit-repository.js";

const backupStatusSchema = z.object({
  completedAt: z.iso.datetime({ offset: true }),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

const transitSyncStatusSchema = z.object({
  attemptedAt: z.iso.datetime({ offset: true }),
  success: z.boolean(),
  lastSuccessAt: z.iso.datetime({ offset: true }).nullable(),
  areaCount: z.number().int().nonnegative(),
  syncedRouteCount: z.number().int().nonnegative(),
  failedRouteCount: z.number().int().nonnegative(),
});

type UpstreamProvider = "TAGO" | "KAKAO_NAVER" | "KAKAO_TAGO" | "UNKNOWN";

export type RouteProviderObservation = {
  provider: "TAGO" | "KAKAO" | "VALHALLA" | "NAVER" | "DATABASE";
  operation:
    | "CITY_CODES"
    | "SUBWAY_STATIONS"
    | "NEARBY_STOPS"
    | "STOP_ROUTES"
    | "ROUTE_SEARCH"
    | "ROUTE_INFO"
    | "ROUTE_STOPS"
    | "ARRIVALS"
    | "ROUTE_ARRIVALS"
    | "VEHICLES"
    | "SUBWAY_SCHEDULE"
    | "ROAD_GEOMETRY"
    | "WALK_GEOMETRY"
    | "PARK_ROUTE"
    | "OTHER";
  outcome:
    | "SUCCESS"
    | "ERROR"
    | "TIMEOUT"
    | "ABORTED"
    | "RATE_LIMIT"
    | "HTTP_4XX"
    | "HTTP_5XX";
  timeoutOrigin: RecommendationTimeoutOrigin;
  durationMilliseconds: number;
  httpStatus?: number;
  providerCode?: -10;
  providerReason?: "QUOTA_EXHAUSTED";
  circuitState?: "TRIPPED" | "OPEN";
};

export type GeometrySkippedObservation = {
  mode: "BUS" | "WALK";
  stage: "INITIAL" | "SELECTED" | "BUS_PAIR";
  reason:
    | "BUDGET_EXHAUSTED_BEFORE_START"
    | "CALL_LIMIT_REACHED"
    | "REQUEST_ABORTED";
};

export type BusGeometryQualityObservation = {
  algorithmVersion: "transit-v2" | "kakao-road-pair-v3" | "unknown";
  source: "KAKAO_ROAD" | "PRECOMPUTED" | "FALLBACK";
  cacheState: "FRESH" | "STALE" | "SHARED" | "MISS" | "NONE";
  outcome: "ACCEPTED" | "REJECTED";
  startSnapDistanceMeters?: number;
  endSnapDistanceMeters?: number;
  detourRatio?: number;
  outAndBack?: boolean;
};

function canonicalRoute(path: string): string {
  const normalized = path.replace(/^\/api\/transit/u, "/api/v1/transit");
  if (
    normalized === "/api/v1/health" ||
    normalized === "/api/v1/readiness" ||
    normalized === "/api/v1/places" ||
    normalized === "/api/v1/places/reverse" ||
    normalized === "/api/v1/recommendations" ||
    normalized === "/api/v1/ui-events"
  ) {
    return normalized;
  }
  if (normalized === "/api/v1/transit/bus/stops/nearby") {
    return normalized;
  }
  if (
    normalized === "/api/v1/transit/subway/stations/search" ||
    normalized === "/api/v1/transit/subway/stations/nearby"
  ) {
    return normalized;
  }
  if (
    /^\/api\/v1\/transit\/subway\/stations\/[^/]+\/departures$/u.test(
      normalized,
    )
  ) {
    return "/api/v1/transit/subway/stations/:id/departures";
  }
  if (/^\/api\/v1\/transit\/bus\/stops\/[^/]+\/routes$/u.test(normalized)) {
    return "/api/v1/transit/bus/stops/:nodeId/routes";
  }
  if (/^\/api\/v1\/transit\/bus\/stops\/[^/]+\/arrivals$/u.test(normalized)) {
    return "/api/v1/transit/bus/stops/:nodeId/arrivals";
  }
  if (/^\/api\/v1\/transit\/bus\/routes\/[^/]+\/stops$/u.test(normalized)) {
    return "/api/v1/transit/bus/routes/:routeId/stops";
  }
  if (/^\/api\/v1\/transit\/bus\/routes\/[^/]+\/vehicles$/u.test(normalized)) {
    return "/api/v1/transit/bus/routes/:routeId/vehicles";
  }
  if (/^\/api\/v1\/transit\/bus\/routes\/[^/]+$/u.test(normalized)) {
    return "/api/v1/transit/bus/routes/:routeId";
  }
  if (normalized === "/api/v1/transit/recommendations") {
    return normalized;
  }
  return "other";
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

function nonnegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function qualityMeasurement(value: number, overflowValue: number): number {
  return value === Number.POSITIVE_INFINITY
    ? overflowValue
    : nonnegativeFinite(value);
}

export class AppMetrics {
  public readonly registry = new Registry();

  readonly #config: AppConfig;
  readonly #repository: TransitRepository;
  readonly #backupStatusPath: string | undefined;
  readonly #transitSyncStatusPath: string | undefined;
  readonly #httpRequests: Counter;
  readonly #httpDuration: Histogram;
  readonly #placeRequests: Counter;
  readonly #placeResults: Histogram;
  readonly #recommendationRequests: Counter;
  readonly #recommendationDuration: Histogram;
  readonly #recommendationCount: Histogram;
  readonly #recommendationDegradedLegs: Histogram;
  readonly #recommendationPhases: Counter;
  readonly #recommendationPhaseDuration: Histogram;
  readonly #routeProviderRequests: Counter;
  readonly #routeProviderDuration: Histogram;
  readonly #uiEvents: Counter;
  readonly #apiErrors: Counter;
  readonly #databaseReady: Gauge;
  readonly #databasePoolConnections: Gauge;
  readonly #transitRows: Gauge;
  readonly #providerConfigured: Gauge;
  readonly #subwayTagoRequests: Counter;
  readonly #subwayTagoDuration: Histogram;
  readonly #subwayUnmappedStations: Gauge;
  readonly #subwayTrackCoverage: Gauge;
  readonly #subwayTrackFallback: Counter;
  readonly #subwayTrackVertices: Histogram;
  readonly #subwayTrackResponseBytes: Histogram;
  readonly #routeGeometryRequests: Counter;
  readonly #routeGeometryCache: Counter;
  readonly #routeGeometryDuration: Histogram;
  readonly #routeGeometryVertices: Histogram;
  readonly #routeGeometrySkipped: Counter;
  readonly #busGeometrySnapDistance: Histogram;
  readonly #busGeometryDetourRatio: Histogram;
  readonly #busGeometryOutAndBack: Counter;
  readonly #busGeometryCache: Counter;
  readonly #backupLastSuccess: Gauge;
  readonly #backupBytes: Gauge;
  readonly #transitSyncLastSuccess: Gauge;
  readonly #transitSyncLastAttemptSuccess: Gauge;
  readonly #transitSyncFailedRoutes: Gauge;

  public constructor(options: {
    config: AppConfig;
    repository: TransitRepository;
  }) {
    this.#config = options.config;
    this.#repository = options.repository;
    this.#backupStatusPath = options.config.metrics.backupStatusPath;
    this.#transitSyncStatusPath =
      options.config.metrics.transitSyncStatusPath;
    this.registry.setDefaultLabels({ service: "chimap-api" });
    collectDefaultMetrics({
      register: this.registry,
      prefix: "chimap_",
    });

    const buildInfo = new Gauge({
      name: "chimap_build_info",
      help: "현재 실행 중인 CHIMap API build 정보",
      labelNames: ["commit"] as const,
      registers: [this.registry],
    });
    buildInfo.set(
      { commit: options.config.metrics.commitSha ?? "unknown" },
      1,
    );

    this.#httpRequests = new Counter({
      name: "chimap_http_requests_total",
      help: "API HTTP 요청 수",
      labelNames: ["method", "route", "status", "status_class"] as const,
      registers: [this.registry],
    });
    this.#httpDuration = new Histogram({
      name: "chimap_http_request_duration_seconds",
      help: "API HTTP 요청 처리시간",
      labelNames: ["method", "route"] as const,
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15, 30],
      registers: [this.registry],
    });
    this.#placeRequests = new Counter({
      name: "chimap_place_search_requests_total",
      help: "장소 검색 결과와 보완 사용 횟수",
      labelNames: [
        "scope",
        "provider",
        "strategy",
        "fallback",
        "outcome",
      ] as const,
      registers: [this.registry],
    });
    this.#placeResults = new Histogram({
      name: "chimap_place_search_result_count",
      help: "장소 검색 한 요청의 결과 수",
      labelNames: ["scope"] as const,
      buckets: [0, 1, 2, 4, 8, 10],
      registers: [this.registry],
    });
    this.#recommendationRequests = new Counter({
      name: "chimap_recommendation_requests_total",
      help: "추천 계산 결과 수",
      labelNames: ["outcome"] as const,
      registers: [this.registry],
    });
    this.#recommendationDuration = new Histogram({
      name: "chimap_recommendation_duration_seconds",
      help: "추천 계산 처리시간",
      labelNames: ["outcome"] as const,
      buckets: [0.5, 1, 2.5, 5, 10, 15, 20, 30],
      registers: [this.registry],
    });
    this.#recommendationCount = new Histogram({
      name: "chimap_recommendation_result_count",
      help: "추천 한 요청의 경로 수",
      buckets: [0, 1, 2, 3],
      registers: [this.registry],
    });
    this.#recommendationDegradedLegs = new Histogram({
      name: "chimap_recommendation_degraded_legs",
      help: "추천 응답에 포함된 근사 geometry leg 수",
      buckets: [0, 1, 2, 4, 8, 16],
      registers: [this.registry],
    });
    this.#recommendationPhases = new Counter({
      name: "chimap_recommendation_phase_total",
      help: "추천 계산 단계별 처리 결과와 timeout 발생 지점",
      labelNames: ["phase", "outcome", "timeout_origin"] as const,
      registers: [this.registry],
    });
    this.#recommendationPhaseDuration = new Histogram({
      name: "chimap_recommendation_phase_duration_seconds",
      help: "추천 계산 단계별 처리시간",
      labelNames: ["phase", "outcome"] as const,
      buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 8, 10, 15, 20],
      registers: [this.registry],
    });
    this.#routeProviderRequests = new Counter({
      name: "chimap_route_provider_requests_total",
      help: "경로 계산 중 외부·내부 provider operation별 처리 결과",
      labelNames: [
        "provider",
        "operation",
        "outcome",
        "timeout_origin",
      ] as const,
      registers: [this.registry],
    });
    this.#routeProviderDuration = new Histogram({
      name: "chimap_route_provider_duration_seconds",
      help: "경로 계산 중 provider operation별 처리시간",
      labelNames: ["provider", "operation", "outcome"] as const,
      buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 7, 10, 15, 20],
      registers: [this.registry],
    });
    this.#uiEvents = new Counter({
      name: "chimap_ui_events_total",
      help: "동의 사용자 UI 흐름의 enum 기반 익명 집계",
      labelNames: [
        "event",
        "ui_state",
        "experience_mode",
        "outcome",
        "duration_bucket",
      ] as const,
      registers: [this.registry],
    });
    this.#apiErrors = new Counter({
      name: "chimap_api_errors_total",
      help: "안전한 API 오류 코드와 외부 공급자 분류",
      labelNames: ["code", "provider"] as const,
      registers: [this.registry],
    });
    this.#databaseReady = new Gauge({
      name: "chimap_database_ready",
      help: "PostgreSQL, PostGIS와 migration 준비 상태",
      registers: [this.registry],
    });
    this.#databasePoolConnections = new Gauge({
      name: "chimap_database_pool_connections",
      help: "PostgreSQL pool connection 상태",
      labelNames: ["state"] as const,
      registers: [this.registry],
    });
    this.#transitRows = new Gauge({
      name: "chimap_transit_rows",
      help: "정적 교통 데이터 row 수",
      labelNames: ["kind"] as const,
      registers: [this.registry],
    });
    this.#providerConfigured = new Gauge({
      name: "chimap_provider_configured",
      help: "외부 공급자 필수 키 설정 상태",
      labelNames: ["provider"] as const,
      registers: [this.registry],
    });
    this.#subwayTagoRequests = new Counter({
      name: "chimap_tago_subway_requests_total",
      help: "TAGO 지하철 operation별 요청 결과",
      labelNames: ["operation", "outcome"] as const,
      registers: [this.registry],
    });
    this.#subwayTagoDuration = new Histogram({
      name: "chimap_tago_subway_request_duration_seconds",
      help: "TAGO 지하철 operation별 요청 처리시간",
      labelNames: ["operation", "outcome"] as const,
      buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15],
      registers: [this.registry],
    });
    this.#subwayUnmappedStations = new Gauge({
      name: "chimap_tago_subway_unmapped_stations",
      help: "활성 지하철역 중 TAGO 역 ID가 매핑되지 않은 수",
      registers: [this.registry],
    });
    this.#subwayTrackCoverage = new Gauge({
      name: "chimap_subway_track_geometry_coverage_ratio",
      help: "route-ready 지하철 노선별 선로 geometry coverage 비율",
      labelNames: ["service_line_id"] as const,
      registers: [this.registry],
    });
    this.#subwayTrackFallback = new Counter({
      name: "chimap_subway_track_geometry_fallback_total",
      help: "지하철 선로 geometry fallback 횟수와 원인",
      labelNames: ["reason"] as const,
      registers: [this.registry],
    });
    this.#subwayTrackVertices = new Histogram({
      name: "chimap_subway_track_geometry_vertices",
      help: "실제 선로 geometry를 사용한 지하철 leg 정점 수",
      labelNames: ["source"] as const,
      buckets: [2, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_000],
      registers: [this.registry],
    });
    this.#subwayTrackResponseBytes = new Histogram({
      name: "chimap_subway_track_geometry_response_bytes",
      help: "track-v1 추천 응답 JSON 크기",
      buckets: [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000],
      registers: [this.registry],
    });
    this.#routeGeometryRequests = new Counter({
      name: "chimap_route_geometry_requests_total",
      help: "버스·도보 형상 상세 사용과 근사 fallback 횟수",
      labelNames: ["mode", "outcome", "reason", "source"] as const,
      registers: [this.registry],
    });
    this.#routeGeometryCache = new Counter({
      name: "chimap_route_geometry_cache_total",
      help: "버스·도보 형상 캐시 상태",
      labelNames: ["mode", "outcome"] as const,
      registers: [this.registry],
    });
    this.#routeGeometryDuration = new Histogram({
      name: "chimap_route_geometry_duration_seconds",
      help: "버스·도보 형상 처리 시간",
      labelNames: ["mode", "source"] as const,
      buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 8],
      registers: [this.registry],
    });
    this.#routeGeometryVertices = new Histogram({
      name: "chimap_route_geometry_vertices",
      help: "버스·도보 leg 형상 정점 수",
      labelNames: ["mode", "quality"] as const,
      buckets: [2, 5, 10, 25, 50, 100, 250, 500, 1_000],
      registers: [this.registry],
    });
    this.#routeGeometrySkipped = new Counter({
      name: "chimap_route_geometry_skipped_total",
      help: "provider 호출 시작 전에 생략된 버스·도보 geometry 수",
      labelNames: ["mode", "stage", "reason"] as const,
      registers: [this.registry],
    });
    this.#busGeometrySnapDistance = new Histogram({
      name: "chimap_bus_geometry_stop_snap_distance_meters",
      help: "버스 stop-pair geometry 끝점과 정류장 사이 거리",
      labelNames: ["endpoint", "source", "outcome"] as const,
      buckets: [1, 3, 5, 8, 10, 15, 20, 30, 50, 100],
      registers: [this.registry],
    });
    this.#busGeometryDetourRatio = new Histogram({
      name: "chimap_bus_geometry_detour_ratio",
      help: "버스 stop-pair geometry 길이와 정류장 직선거리의 비율",
      labelNames: ["source", "outcome"] as const,
      buckets: [1, 1.1, 1.25, 1.5, 2, 2.5, 3, 4, 6, 10],
      registers: [this.registry],
    });
    this.#busGeometryOutAndBack = new Counter({
      name: "chimap_bus_geometry_out_and_back_total",
      help: "버스 stop-pair geometry의 동일 도로 왕복 spike 판정 수",
      labelNames: ["source", "detected"] as const,
      registers: [this.registry],
    });
    this.#busGeometryCache = new Counter({
      name: "chimap_bus_geometry_pair_cache_total",
      help: "버스 stop-pair geometry 캐시 coverage 계산용 상태 수",
      labelNames: ["algorithm_version", "state"] as const,
      registers: [this.registry],
    });
    this.#backupLastSuccess = new Gauge({
      name: "chimap_backup_last_success_timestamp_seconds",
      help: "마지막 PostgreSQL 백업 성공 Unix timestamp",
      registers: [this.registry],
    });
    this.#backupBytes = new Gauge({
      name: "chimap_backup_last_size_bytes",
      help: "마지막 PostgreSQL 백업 파일 크기",
      registers: [this.registry],
    });
    this.#transitSyncLastSuccess = new Gauge({
      name: "chimap_transit_sync_last_success_timestamp_seconds",
      help: "마지막 TAGO 노선 정기 동기화 성공 Unix timestamp",
      registers: [this.registry],
    });
    this.#transitSyncLastAttemptSuccess = new Gauge({
      name: "chimap_transit_sync_last_attempt_success",
      help: "가장 최근 TAGO 노선 정기 동기화 성공 여부",
      registers: [this.registry],
    });
    this.#transitSyncFailedRoutes = new Gauge({
      name: "chimap_transit_sync_failed_routes",
      help: "가장 최근 TAGO 노선 정기 동기화 실패 노선 수",
      registers: [this.registry],
    });
  }

  public observeHttp(input: {
    method: string;
    path: string;
    status: number;
    durationSeconds: number;
  }): void {
    const route = canonicalRoute(input.path);
    const labels = {
      method: input.method,
      route,
      status: String(input.status),
      status_class: statusClass(input.status),
    };
    this.#httpRequests.inc(labels);
    this.#httpDuration.observe(
      { method: input.method, route },
      input.durationSeconds,
    );
  }

  public observePlace(
    scope: "suggest" | "resolve" | "reverse",
    result: PlaceSearchResponse | {
      items: [];
      meta: {
        provider: "NONE";
        strategy: "NONE";
        fallbackUsed: false;
        degraded: true;
      };
    },
  ): void {
    const outcome =
      result.items.length === 0
        ? "empty"
        : result.meta.degraded
          ? "degraded"
          : "success";
    this.#placeRequests.inc({
      scope,
      provider: result.meta.provider,
      strategy: result.meta.strategy,
      fallback: String(result.meta.fallbackUsed),
      outcome,
    });
    this.#placeResults.observe({ scope }, result.items.length);
  }

  public observeReverse(input: {
    provider: "KAKAO" | "NAVER" | "NONE";
    fallbackUsed: boolean;
    degraded: boolean;
    found: boolean;
  }): void {
    this.#placeRequests.inc({
      scope: "reverse",
      provider: input.provider,
      strategy: "REVERSE",
      fallback: String(input.fallbackUsed),
      outcome: input.found ? (input.degraded ? "degraded" : "success") : "empty",
    });
    this.#placeResults.observe({ scope: "reverse" }, input.found ? 1 : 0);
  }

  public observeRecommendation(input: {
    outcome: "success" | "error";
    durationSeconds: number;
    resultCount?: number;
    degradedLegCount?: number;
  }): void {
    this.#recommendationRequests.inc({ outcome: input.outcome });
    this.#recommendationDuration.observe(
      { outcome: input.outcome },
      input.durationSeconds,
    );
    if (input.resultCount !== undefined) {
      this.#recommendationCount.observe(input.resultCount);
    }
    if (input.degradedLegCount !== undefined) {
      this.#recommendationDegradedLegs.observe(input.degradedLegCount);
    }
  }

  public observeRecommendationPhase(
    observation: RecommendationPhaseObservation,
  ): void {
    const labels = {
      phase: observation.phase,
      outcome: observation.outcome,
      timeout_origin: observation.timeoutOrigin,
    };
    this.#recommendationPhases.inc(labels);
    this.#recommendationPhaseDuration.observe(
      { phase: observation.phase, outcome: observation.outcome },
      nonnegativeFinite(observation.durationMilliseconds) / 1_000,
    );
  }

  public observeRouteProvider(
    observation: RouteProviderObservation,
  ): void {
    const labels = {
      provider: observation.provider,
      operation: observation.operation,
      outcome: observation.outcome,
      timeout_origin: observation.timeoutOrigin,
    };
    this.#routeProviderRequests.inc(labels);
    this.#routeProviderDuration.observe(
      {
        provider: observation.provider,
        operation: observation.operation,
        outcome: observation.outcome,
      },
      nonnegativeFinite(observation.durationMilliseconds) / 1_000,
    );
  }

  public observeUiEvent(event: UiEventPayload): void {
    this.#uiEvents.inc({
      event: event.event,
      ui_state: event.uiState,
      experience_mode: event.experienceMode,
      outcome: event.outcome ?? "none",
      duration_bucket: event.durationBucket ?? "none",
    });
  }

  public observeApiError(
    code: ErrorCode,
    provider: UpstreamProvider,
  ): void {
    this.#apiErrors.inc({ code, provider });
  }

  public observeTagoSubway(input: {
    operation: "station_search" | "station_schedule";
    outcome: "success" | "failure";
    durationSeconds: number;
  }): void {
    const labels = {
      operation: input.operation,
      outcome: input.outcome,
    };
    this.#subwayTagoRequests.inc(labels);
    this.#subwayTagoDuration.observe(labels, input.durationSeconds);
  }

  public observeSubwayTrackGeometry(
    observation: SubwayGeometryObservation,
  ): void {
    if (observation.outcome === "fallback") {
      this.#subwayTrackFallback.inc({ reason: observation.reason });
      return;
    }
    this.#subwayTrackVertices.observe(
      { source: observation.source },
      observation.vertexCount,
    );
  }

  public observeSubwayTrackResponseBytes(bytes: number): void {
    this.#subwayTrackResponseBytes.observe(bytes);
  }

  public observeRouteGeometry(observation: RouteGeometryObservation): void {
    const labels = {
      mode: observation.mode,
      outcome: observation.outcome,
      reason: observation.reason,
      source: observation.source,
    };
    this.#routeGeometryRequests.inc(labels);
    this.#routeGeometryCache.inc({
      mode: observation.mode,
      outcome: observation.cacheState,
    });
    this.#routeGeometryDuration.observe(
      { mode: observation.mode, source: observation.source },
      observation.durationMilliseconds / 1_000,
    );
    this.#routeGeometryVertices.observe(
      { mode: observation.mode, quality: observation.outcome },
      observation.outputVertexCount,
    );
  }

  public observeGeometrySkipped(
    observation: GeometrySkippedObservation,
  ): void {
    this.#routeGeometrySkipped.inc({
      mode: observation.mode,
      stage: observation.stage,
      reason: observation.reason,
    });
  }

  public observeBusGeometryQuality(
    observation: BusGeometryQualityObservation,
  ): void {
    const histogramLabels = {
      source: observation.source,
      outcome: observation.outcome,
    };
    if (observation.startSnapDistanceMeters !== undefined) {
      this.#busGeometrySnapDistance.observe(
        { endpoint: "START", ...histogramLabels },
        qualityMeasurement(observation.startSnapDistanceMeters, 101),
      );
    }
    if (observation.endSnapDistanceMeters !== undefined) {
      this.#busGeometrySnapDistance.observe(
        { endpoint: "END", ...histogramLabels },
        qualityMeasurement(observation.endSnapDistanceMeters, 101),
      );
    }
    if (observation.detourRatio !== undefined) {
      this.#busGeometryDetourRatio.observe(
        histogramLabels,
        qualityMeasurement(observation.detourRatio, 11),
      );
    }
    if (observation.outAndBack !== undefined) {
      this.#busGeometryOutAndBack.inc({
        source: observation.source,
        detected: String(observation.outAndBack),
      });
    }
    this.#busGeometryCache.inc({
      algorithm_version: observation.algorithmVersion,
      state: observation.cacheState,
    });
  }

  async #refreshInfrastructure(): Promise<void> {
    const coveragePromise =
      typeof this.#repository.subwayTrackGeometryCoverage === "function"
        ? this.#repository.subwayTrackGeometryCoverage().catch(() => [])
        : Promise.resolve([]);
    const [database, transit, geometryCoverage] = await Promise.all([
      this.#repository.status(),
      this.#repository.stats().catch(() => ({
        stops: 0,
        linkedStops: 0,
        routes: 0,
        routeStops: 0,
        subwayStations: 0,
        activeSubwayStations: 0,
        mappedSubwayStations: 0,
      })),
      coveragePromise,
    ]);
    this.#databaseReady.set(
      database.connected && database.postgis && database.migrationsCurrent
        ? 1
        : 0,
    );
    this.#databasePoolConnections.set(
      { state: "total" },
      this.#repository.pool.totalCount,
    );
    this.#databasePoolConnections.set(
      { state: "idle" },
      this.#repository.pool.idleCount,
    );
    this.#databasePoolConnections.set(
      { state: "waiting" },
      this.#repository.pool.waitingCount,
    );
    for (const [kind, count] of Object.entries(transit)) {
      this.#transitRows.set({ kind }, count);
    }
    this.#subwayUnmappedStations.set(
      Math.max(
        0,
        transit.activeSubwayStations - transit.mappedSubwayStations,
      ),
    );
    this.#subwayTrackCoverage.reset();
    for (const line of geometryCoverage) {
      this.#subwayTrackCoverage.set(
        { service_line_id: line.serviceLineId },
        line.segmentCount === 0
          ? 1
          : line.geometryCount / line.segmentCount,
      );
    }
    this.#providerConfigured.set(
      { provider: "KAKAO" },
      this.#config.kakaoRestApiKey === undefined ? 0 : 1,
    );
    this.#providerConfigured.set(
      { provider: "NAVER" },
      this.#config.naverMapNcpKeyId === undefined ||
        this.#config.naverMapNcpKey === undefined
        ? 0
        : 1,
    );
    this.#providerConfigured.set(
      { provider: "TAGO" },
      (["stop", "route", "arrival", "location", "subway"] as const).every(
        (service) =>
          this.#config.tagoServiceKeys[service] !== undefined ||
          this.#config.dataGoKrServiceKey !== undefined,
      )
        ? 1
        : 0,
    );
    if (this.#config.walking.router === "VALHALLA") {
      this.#providerConfigured.set(
        { provider: "VALHALLA" },
        this.#config.walking.valhallaBaseUrl === undefined ? 0 : 1,
      );
    }

    if (this.#backupStatusPath === undefined) {
      this.#backupLastSuccess.set(0);
      this.#backupBytes.set(0);
    } else {
      try {
        const status = backupStatusSchema.parse(
          JSON.parse(await readFile(this.#backupStatusPath, "utf8")),
        );
        this.#backupLastSuccess.set(
          Math.floor(new Date(status.completedAt).getTime() / 1000),
        );
        this.#backupBytes.set(status.bytes);
      } catch {
        this.#backupLastSuccess.set(0);
        this.#backupBytes.set(0);
      }
    }

    if (this.#transitSyncStatusPath === undefined) {
      this.#transitSyncLastSuccess.set(0);
      this.#transitSyncLastAttemptSuccess.set(0);
      this.#transitSyncFailedRoutes.set(0);
    } else {
      try {
        const status = transitSyncStatusSchema.parse(
          JSON.parse(await readFile(this.#transitSyncStatusPath, "utf8")),
        );
        this.#transitSyncLastSuccess.set(
          status.lastSuccessAt === null
            ? 0
            : Math.floor(
                new Date(status.lastSuccessAt).getTime() / 1000,
              ),
        );
        this.#transitSyncLastAttemptSuccess.set(status.success ? 1 : 0);
        this.#transitSyncFailedRoutes.set(status.failedRouteCount);
      } catch {
        this.#transitSyncLastSuccess.set(0);
        this.#transitSyncLastAttemptSuccess.set(0);
        this.#transitSyncFailedRoutes.set(0);
      }
    }
  }

  public async metrics(): Promise<string> {
    await this.#refreshInfrastructure();
    return this.registry.metrics();
  }

  public readonly handleRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found\n");
      return;
    }
    try {
      const body = await this.metrics();
      response.writeHead(200, { "content-type": this.registry.contentType });
      response.end(body);
    } catch {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("metrics unavailable\n");
    }
  };
}
