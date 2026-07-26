import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  busArrivalsResponseSchema,
  busRouteSchema,
  busRoutesResponseSchema,
  busRouteStopsResponseSchema,
  busVehiclesResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  nearbyBusStopsResponseSchema,
  placeSearchQuerySchema,
  placeSearchResponseSchema,
  readinessResponseSchema,
  recommendationRequestSchema,
  reverseGeocodeQuerySchema,
  reverseGeocodeResponseSchema,
  uiEventPayloadSchema,
  type ErrorResponse,
} from "@chimap/contracts";
import compression from "compression";
import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type Response,
} from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { Logger } from "pino";
import { z, ZodError } from "zod";

import type { AppConfig } from "./config.js";
import {
  AppError,
  mapProviderError,
  ProviderError,
} from "./errors.js";
import { createLogger } from "./logger.js";
import { AppMetrics } from "./monitoring/metrics.js";
import { CachedMobilityProvider } from "./providers/cached-provider.js";
import { KakaoMobilityProvider } from "./providers/kakao-provider.js";
import { NaverGeocodingClient } from "./providers/naver-geocoding-client.js";
import { TagoTransitMobilityProvider } from "./providers/tago-transit-provider.js";
import { CandidateGenerator } from "./services/candidate-generator.js";
import { PlaceLookupService } from "./services/place-lookup-service.js";
import type { Clock } from "./services/recommendation-service.js";
import { RecommendationService } from "./services/recommendation-service.js";
import { TagoApiError } from "./transit/tago-client.js";
import { TransitService } from "./transit/transit-service.js";

type RateLimitOptions = {
  windowMs?: number;
  placesMax?: number;
  recommendationsMax?: number;
  uiEventsMax?: number;
};

export type CreateAppOptions = {
  config: AppConfig;
  logger?: Logger;
  clock?: Clock;
  transitService?: TransitService;
  metrics?: AppMetrics;
  rateLimits?: RateLimitOptions;
};

function requestId(response: Response): string {
  return response.locals.requestId as string;
}

function requestAbortSignal(request: Request): AbortSignal {
  const controller = new AbortController();
  request.once("aborted", () => controller.abort());
  return controller.signal;
}

function upstreamProvider(
  error: unknown,
  path: string,
): "TAGO" | "KAKAO_NAVER" | "KAKAO_TAGO" | "UNKNOWN" {
  let current = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (current instanceof TagoApiError) {
      return "TAGO";
    }
    if (
      typeof current !== "object" ||
      current === null ||
      !("cause" in current)
    ) {
      break;
    }
    current = current.cause;
  }
  if (path.startsWith("/api/v1/places")) {
    return "KAKAO_NAVER";
  }
  if (
    path === "/api/v1/recommendations" ||
    path.endsWith("/recommendations")
  ) {
    return "KAKAO_TAGO";
  }
  return "UNKNOWN";
}

function fieldErrors(error: ZodError): Record<string, string[]> {
  const flattened: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length === 0 ? "_root" : issue.path.join(".");
    flattened[path] ??= [];
    flattened[path].push(issue.message);
  }
  return flattened;
}

function bodyParserError(error: unknown): AppError | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const type = "type" in error ? error.type : undefined;
  if (type === "entity.too.large") {
    return new AppError({
      code: "VALIDATION_ERROR",
      message: "요청 본문은 32KB를 넘을 수 없어요.",
      status: 413,
      cause: error,
    });
  }
  if (type === "entity.parse.failed") {
    return new AppError({
      code: "VALIDATION_ERROR",
      message: "올바른 JSON 요청 본문을 보내 주세요.",
      status: 400,
      cause: error,
    });
  }
  return undefined;
}

function rateLimiter(max: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      const payload: ErrorResponse = {
        error: {
          code: "RATE_LIMITED",
          message: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
          requestId: requestId(response),
        },
      };
      response.status(429).json(payload);
    },
  });
}

function createProviders(
  config: AppConfig,
  transitService: TransitService,
): {
  mobility: CachedMobilityProvider;
  places: PlaceLookupService;
} {
  if (config.kakaoRestApiKey === undefined) {
    throw new Error(
      "실제 장소와 경로 조회에는 KAKAO_REST_API_KEY가 필요합니다.",
    );
  }
  const baseProvider = new KakaoMobilityProvider(config.kakaoRestApiKey);
  const provider = new TagoTransitMobilityProvider({
    baseProvider,
    transitService,
    config,
  });
  const naver =
    config.naverMapNcpKeyId === undefined ||
    config.naverMapNcpKey === undefined
      ? undefined
      : new NaverGeocodingClient(
          config.naverMapNcpKeyId,
          config.naverMapNcpKey,
        );
  return {
    mobility: new CachedMobilityProvider(provider),
    places: new PlaceLookupService({
      kakao: baseProvider.local,
      ...(naver === undefined ? {} : { naver }),
    }),
  };
}

function mapTagoError(error: TagoApiError): AppError {
  if (error.resultCode === "CONFIGURATION_ERROR") {
    return new AppError({
      code: "TRANSIT_NOT_CONFIGURED",
      message: error.safeMessage,
      status: 503,
      cause: error,
    });
  }
  if (error.resultCode === "TIMEOUT") {
    return new AppError({
      code: "UPSTREAM_TIMEOUT",
      message: error.safeMessage,
      status: 504,
      cause: error,
    });
  }
  if (error.resultCode === "ABORTED") {
    return new AppError({
      code: "UPSTREAM_TIMEOUT",
      message: error.safeMessage,
      status: 408,
      cause: error,
    });
  }
  return new AppError({
    code: "UPSTREAM_ERROR",
    message: error.safeMessage,
    status: 502,
    cause: error,
  });
}

async function transitCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TagoApiError) {
      throw mapTagoError(error);
    }
    throw error;
  }
}

async function providerCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProviderError) {
      throw mapProviderError(error);
    }
    throw error;
  }
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const logger = options.logger ?? createLogger(options.config);
  const transitService =
    options.transitService ??
    new TransitService({ config: options.config, logger });
  app.locals.transitService = transitService;
  const metrics =
    options.metrics ??
    new AppMetrics({
      config: options.config,
      repository: transitService.repository,
    });
  app.locals.metrics = metrics;
  const providers = createProviders(options.config, transitService);
  const provider = providers.mobility;
  const placeLookup = providers.places;
  const recommendationService = new RecommendationService({
    candidateGenerator: new CandidateGenerator(provider),
    logger,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });
  const rateLimitWindow = options.rateLimits?.windowMs ?? 60_000;

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((request, response, next) => {
    const id = randomUUID();
    response.locals.requestId = id;
    response.setHeader("x-request-id", id);
    const startedAt = performance.now();
    response.on("finish", () => {
      const durationMilliseconds = performance.now() - startedAt;
      logger.info({
        event: "request.completed",
        requestId: id,
        method: request.method,
        path: request.path,
        httpStatus: response.statusCode,
        durationMs: Math.round(durationMilliseconds),
      });
      metrics.observeHttp({
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationSeconds: durationMilliseconds / 1000,
      });
    });
    next();
  });
  app.use(
    options.config.webDistPath === undefined
      ? helmet()
      : helmet({ contentSecurityPolicy: false }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (origin === undefined || origin === options.config.webOrigin) {
          callback(null, true);
          return;
        }
        callback(
          new AppError({
            code: "VALIDATION_ERROR",
            message: "허용되지 않은 웹 출처입니다.",
            status: 403,
          }),
        );
      },
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "32kb", strict: true }));

  app.get("/api/v1/health", (_request, response) => {
    response.json(
      healthResponseSchema.parse({
        status: "ok",
        timestamp: (options.clock ?? (() => new Date()))().toISOString(),
      }),
    );
  });

  app.get("/api/v1/readiness", async (_request, response) => {
    const [database, transit] = await Promise.all([
      transitService.repository.status(),
      transitService.repository.stats().catch(() => ({
        stops: 0,
        linkedStops: 0,
        routes: 0,
        routeStops: 0,
      })),
    ]);
    const tago = (
      ["stop", "route", "arrival", "location"] as const
    ).every((service) => transitService.hasServiceKey(service));
    const providersReady =
      options.config.kakaoRestApiKey !== undefined &&
      options.config.naverMapNcpKeyId !== undefined &&
      options.config.naverMapNcpKey !== undefined &&
      tago;
    const transitReady =
      transit.stops > 0 &&
      transit.linkedStops > 0 &&
      transit.routes > 0 &&
      transit.routeStops > 0;
    const ready =
      database.connected &&
      database.postgis &&
      database.migrationsCurrent &&
      providersReady &&
      transitReady;
    const payload = readinessResponseSchema.parse({
      status: ready ? "ready" : "not_ready",
      timestamp: (options.clock ?? (() => new Date()))().toISOString(),
      database,
      providers: {
        kakao: options.config.kakaoRestApiKey !== undefined,
        naver:
          options.config.naverMapNcpKeyId !== undefined &&
          options.config.naverMapNcpKey !== undefined,
        tago,
      },
      transit,
    });
    response.status(ready ? 200 : 503).json(payload);
  });

  app.get(
    "/api/v1/places",
    rateLimiter(options.rateLimits?.placesMax ?? 60, rateLimitWindow),
    async (request, response) => {
      const query = placeSearchQuerySchema.parse(request.query);
      const startedAt = performance.now();
      const result = await providerCall(() =>
        placeLookup.search({
          query: query.query,
          limit: query.limit,
          scope: query.scope,
          ...(query.x === undefined || query.y === undefined
            ? {}
            : { center: { lng: query.x, lat: query.y } }),
          signal: requestAbortSignal(request),
        }),
      );
      metrics.observePlace(query.scope, result);
      logger.info({
        event: "place.lookup.completed",
        requestId: requestId(response),
        scope: query.scope,
        provider: result.meta.provider,
        strategy: result.meta.strategy,
        fallbackUsed: result.meta.fallbackUsed,
        degraded: result.meta.degraded,
        itemCount: result.items.length,
        durationMs: Math.round(performance.now() - startedAt),
      });
      response.json(placeSearchResponseSchema.parse(result));
    },
  );

  app.get(
    "/api/v1/places/reverse",
    rateLimiter(options.rateLimits?.placesMax ?? 60, rateLimitWindow),
    async (request, response) => {
      const query = reverseGeocodeQuerySchema.parse(request.query);
      const result = await providerCall(() =>
        placeLookup.reverseGeocode(
          { lng: query.x, lat: query.y },
          requestAbortSignal(request),
        ),
      );
      metrics.observeReverse({
        provider: result.meta.provider,
        fallbackUsed: result.meta.fallbackUsed,
        degraded: result.meta.degraded,
        found: result.place !== null,
      });
      response.json(reverseGeocodeResponseSchema.parse(result));
    },
  );

  const handleRecommendations = async (
    request: Request,
    response: Response,
  ) => {
    const startedAt = performance.now();
    try {
      const parsedRequest = recommendationRequestSchema.parse(request.body);
      const abortController = new AbortController();
      request.once("aborted", () => abortController.abort());
      const result = await recommendationService.createRecommendations({
        request: parsedRequest,
        requestId: requestId(response),
        signal: abortController.signal,
      });
      metrics.observeRecommendation({
        outcome: "success",
        durationSeconds: (performance.now() - startedAt) / 1000,
        resultCount: result.recommendations.length,
      });
      response.json(result);
    } catch (error) {
      metrics.observeRecommendation({
        outcome: "error",
        durationSeconds: (performance.now() - startedAt) / 1000,
      });
      throw error;
    }
  };

  app.post(
    "/api/v1/ui-events",
    rateLimiter(options.rateLimits?.uiEventsMax ?? 120, rateLimitWindow),
    (request, response) => {
      const event = uiEventPayloadSchema.parse(request.body);
      metrics.observeUiEvent(event);
      response.status(204).end();
    },
  );

  app.post(
    "/api/v1/recommendations",
    rateLimiter(
      options.rateLimits?.recommendationsMax ?? 10,
      rateLimitWindow,
    ),
    handleRecommendations,
  );

  const transitRouter = express.Router();
  const nearbyStopsQuerySchema = z
    .object({
      lat: z.coerce.number().finite().min(-90).max(90),
      lng: z.coerce.number().finite().min(-180).max(180),
      radiusMeters: z.coerce
        .number()
        .int()
        .positive()
        .max(options.config.transit.maxNearbyStopDistanceMeters)
        .optional(),
    })
    .strict();
  const cityCodeQuerySchema = z
    .object({
      cityCode: z.string().trim().min(1).max(20),
    })
    .strict();
  const nodeParametersSchema = z
    .object({
      nodeId: z.string().trim().min(1).max(100),
    })
    .strict();
  const routeParametersSchema = z
    .object({
      routeId: z.string().trim().min(1).max(100),
    })
    .strict();

  transitRouter.get("/bus/stops/nearby", async (request, response) => {
    const query = nearbyStopsQuerySchema.parse(request.query);
    const result = await transitCall(() =>
      transitService.getNearbyStops(
        { lat: query.lat, lng: query.lng },
        query.radiusMeters,
        requestAbortSignal(request),
      ),
    );
    response.json(nearbyBusStopsResponseSchema.parse(result));
  });

  transitRouter.get(
    "/bus/stops/:nodeId/routes",
    async (request, response) => {
      const parameters = nodeParametersSchema.parse(request.params);
      const query = cityCodeQuerySchema.parse(request.query);
      const result = await transitCall(() =>
        transitService.getRoutesByStop(
          query.cityCode,
          parameters.nodeId,
          requestAbortSignal(request),
        ),
      );
      response.json(busRoutesResponseSchema.parse(result));
    },
  );

  transitRouter.get(
    "/bus/stops/:nodeId/arrivals",
    async (request, response) => {
      const parameters = nodeParametersSchema.parse(request.params);
      const query = cityCodeQuerySchema.parse(request.query);
      const items = await transitCall(() =>
        transitService.getArrivals(
          query.cityCode,
          parameters.nodeId,
          requestAbortSignal(request),
        ),
      );
      response.json(
        busArrivalsResponseSchema.parse({
          items,
          realtimeAvailable: items.length > 0,
          fetchedAt: new Date().toISOString(),
        }),
      );
    },
  );

  transitRouter.get(
    "/bus/routes/:routeId",
    async (request, response) => {
      const parameters = routeParametersSchema.parse(request.params);
      const query = cityCodeQuerySchema.parse(request.query);
      const route = await transitCall(() =>
        transitService.getRoute(
          query.cityCode,
          parameters.routeId,
          requestAbortSignal(request),
        ),
      );
      response.json(busRouteSchema.parse(route));
    },
  );

  transitRouter.get(
    "/bus/routes/:routeId/stops",
    async (request, response) => {
      const parameters = routeParametersSchema.parse(request.params);
      const query = cityCodeQuerySchema.parse(request.query);
      const items = await transitCall(() =>
        transitService.getRouteStops(
          query.cityCode,
          parameters.routeId,
          requestAbortSignal(request),
        ),
      );
      response.json(busRouteStopsResponseSchema.parse({ items }));
    },
  );

  transitRouter.get(
    "/bus/routes/:routeId/vehicles",
    async (request, response) => {
      const parameters = routeParametersSchema.parse(request.params);
      const query = cityCodeQuerySchema.parse(request.query);
      const items = await transitCall(() =>
        transitService.getVehiclePositions(
          query.cityCode,
          parameters.routeId,
          requestAbortSignal(request),
        ),
      );
      response.json(
        busVehiclesResponseSchema.parse({
          items,
          realtimeAvailable: items.length > 0,
          fetchedAt: new Date().toISOString(),
        }),
      );
    },
  );

  transitRouter.post(
    "/recommendations",
    rateLimiter(
      options.rateLimits?.recommendationsMax ?? 10,
      rateLimitWindow,
    ),
    handleRecommendations,
  );
  app.use("/api/v1/transit", transitRouter);
  app.use("/api/transit", transitRouter);

  if (options.config.webDistPath !== undefined) {
    app.use(
      express.static(options.config.webDistPath, {
        index: false,
        immutable: true,
        maxAge: "1y",
        setHeaders(response, filePath) {
          if (filePath.endsWith("index.html")) {
            response.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
  }

  app.use((request, response) => {
    if (
      options.config.webDistPath !== undefined &&
      request.method === "GET" &&
      !request.path.startsWith("/api/")
    ) {
      response.sendFile(join(options.config.webDistPath, "index.html"), {
        headers: { "Cache-Control": "no-cache" },
      });
      return;
    }

    const payload: ErrorResponse = {
      error: {
        code: "NOT_FOUND",
        message: `${request.method} ${request.path} API를 찾을 수 없어요.`,
        requestId: requestId(response),
      },
    };
    response.status(404).json(payload);
  });

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    request,
    response,
    _next,
  ) => {
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else if (error instanceof ZodError) {
      appError = new AppError({
        code: "VALIDATION_ERROR",
        message: "입력값을 확인해 주세요.",
        status: 400,
        fieldErrors: fieldErrors(error),
        cause: error,
      });
    } else {
      appError =
        bodyParserError(error) ??
        new AppError({
          code: "INTERNAL_ERROR",
          message: "예상하지 못한 서버 오류가 발생했어요.",
          status: 500,
          cause: error,
        });
    }

    logger.error({
      event: "request.failed",
      requestId: requestId(response),
      errorCode: appError.code,
      httpStatus: appError.status,
    });
    metrics.observeApiError(
      appError.code,
      upstreamProvider(appError, request.path),
    );
    const payload = errorResponseSchema.parse({
      error: {
        code: appError.code,
        message: appError.message,
        requestId: requestId(response),
        ...(appError.fieldErrors === undefined
          ? {}
          : { fieldErrors: appError.fieldErrors }),
      },
    });
    response.status(appError.status).json(payload);
  };
  app.use(errorHandler);

  return app;
}
