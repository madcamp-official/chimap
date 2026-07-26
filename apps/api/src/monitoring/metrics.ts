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
  readonly #uiEvents: Counter;
  readonly #apiErrors: Counter;
  readonly #databaseReady: Gauge;
  readonly #databasePoolConnections: Gauge;
  readonly #transitRows: Gauge;
  readonly #providerConfigured: Gauge;
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
  }): void {
    this.#recommendationRequests.inc({ outcome: input.outcome });
    this.#recommendationDuration.observe(
      { outcome: input.outcome },
      input.durationSeconds,
    );
    if (input.resultCount !== undefined) {
      this.#recommendationCount.observe(input.resultCount);
    }
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

  async #refreshInfrastructure(): Promise<void> {
    const [database, transit] = await Promise.all([
      this.#repository.status(),
      this.#repository.stats().catch(() => ({
        stops: 0,
        linkedStops: 0,
        routes: 0,
        routeStops: 0,
      })),
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
      (["stop", "route", "arrival", "location"] as const).every(
        (service) =>
          this.#config.tagoServiceKeys[service] !== undefined ||
          this.#config.dataGoKrServiceKey !== undefined,
      )
        ? 1
        : 0,
    );

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
