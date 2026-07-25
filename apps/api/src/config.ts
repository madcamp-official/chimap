import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().min(1).optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    KAKAO_REST_API_KEY: optionalSecret,
    NAVER_MAP_NCP_KEY_ID: optionalSecret,
    NAVER_MAP_NCP_KEY: optionalSecret,
    VITE_NAVER_MAP_NCP_KEY_ID: optionalSecret,
    DATABASE_URL: z
      .string()
      .trim()
      .min(1)
      .default(
        "postgresql://chimap:chimap@127.0.0.1:5432/chimap",
      ),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(60_000)
      .default(3000),
    DATABASE_STATEMENT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(60_000)
      .default(5000),
    DATABASE_SSL_MODE: z
      .enum(["disable", "require", "verify-full"])
      .default("disable"),
    DATA_GO_KR_SERVICE_KEY: optionalSecret,
    TAGO_BUS_STOP_SERVICE_KEY: optionalSecret,
    TAGO_BUS_ROUTE_SERVICE_KEY: optionalSecret,
    TAGO_BUS_ARRIVAL_SERVICE_KEY: optionalSecret,
    TAGO_BUS_LOCATION_SERVICE_KEY: optionalSecret,
    TAGO_BASE_URL: z
      .url()
      .default("https://apis.data.go.kr/1613000"),
    TAGO_RESPONSE_TYPE: z.literal("json").default("json"),
    TAGO_DEFAULT_CITY_CODE: z.string().trim().min(1).default("25"),
    BUS_STOPS_DATA_PATH: optionalSecret,
    TAGO_HTTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(60_000)
      .default(7000),
    TAGO_HTTP_RETRY_COUNT: z.coerce.number().int().min(0).max(5).default(2),
    TAGO_NEARBY_STOP_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(300),
    TAGO_ROUTE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400),
    TAGO_ROUTE_STOPS_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(86_400),
    TAGO_ARRIVAL_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(20),
    TAGO_LOCATION_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS: z.coerce
      .number()
      .int()
      .min(50)
      .max(500)
      .default(500),
    TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS: z.coerce
      .number()
      .int()
      .min(500)
      .max(2000)
      .default(1200),
    TRANSIT_MAX_TRANSFER_COUNT: z.coerce
      .number()
      .int()
      .min(0)
      .max(1)
      .default(1),
    TRANSIT_WALK_SPEED_KMH: z.coerce.number().positive().default(4.5),
    TRANSIT_BUS_AVERAGE_SPEED_KMH: z.coerce.number().positive().default(20),
    TRANSIT_STOP_DWELL_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(25),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    WEB_ORIGIN: z.url().default("http://localhost:5173"),
    WEB_DIST_PATH: optionalSecret,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    METRICS_ENABLED: z.enum(["0", "1"]).default("0"),
    METRICS_PORT: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(9091),
    APP_COMMIT_SHA: optionalSecret,
    BACKUP_STATUS_PATH: optionalSecret,
    TRANSIT_SYNC_STATUS_PATH: optionalSecret,
    LIVE_API_TEST: z.enum(["0", "1"]).default("0"),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      environment.KAKAO_REST_API_KEY === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["KAKAO_REST_API_KEY"],
        message: "운영 환경에는 Kakao REST API 키가 필요합니다.",
      });
    }
    if (
      environment.NAVER_MAP_NCP_KEY !== undefined &&
      environment.VITE_NAVER_MAP_NCP_KEY_ID === environment.NAVER_MAP_NCP_KEY
    ) {
      context.addIssue({
        code: "custom",
        path: ["VITE_NAVER_MAP_NCP_KEY_ID"],
        message:
          "브라우저 공개 NAVER Key ID에 서버 Client Secret을 사용할 수 없습니다.",
      });
    }
    if (
      environment.TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS <
      environment.TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS
    ) {
      context.addIssue({
        code: "custom",
        path: ["TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS"],
        message:
          "추천 경로 정류장 탐색 상한은 기본 주변 정류장 반경보다 작을 수 없습니다.",
      });
    }
  });

export type TagoServiceKind = "stop" | "route" | "arrival" | "location";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  kakaoRestApiKey?: string;
  naverMapNcpKeyId?: string;
  naverMapNcpKey?: string;
  database: {
    url: string;
    poolMax: number;
    connectTimeoutMs: number;
    statementTimeoutMs: number;
    sslMode: "disable" | "require" | "verify-full";
  };
  port: number;
  webOrigin: string;
  webDistPath?: string;
  logLevel:
    | "fatal"
    | "error"
    | "warn"
    | "info"
    | "debug"
    | "trace"
    | "silent";
  metrics: {
    enabled: boolean;
    port: number;
    commitSha?: string;
    backupStatusPath?: string;
    transitSyncStatusPath?: string;
  };
  liveApiTest: boolean;
  dataGoKrServiceKey?: string;
  tagoServiceKeys: Partial<Record<TagoServiceKind, string>>;
  tagoBaseUrl: string;
  tagoResponseType: "json";
  tagoDefaultCityCode: string;
  busStopsDataPath?: string;
  tagoHttpTimeoutMs: number;
  tagoHttpRetryCount: number;
  tagoCacheTtlSeconds: {
    nearbyStops: number;
    route: number;
    routeStops: number;
    arrivals: number;
    locations: number;
  };
  transit: {
    maxNearbyStopDistanceMeters: number;
    routeSearchMaxDistanceMeters: number;
    maxTransferCount: 0 | 1;
    walkSpeedKmh: number;
    busAverageSpeedKmh: number;
    stopDwellSeconds: number;
  };
};

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const tagoServiceKeys: Partial<Record<TagoServiceKind, string>> = {};
  if (parsed.TAGO_BUS_STOP_SERVICE_KEY !== undefined) {
    tagoServiceKeys.stop = parsed.TAGO_BUS_STOP_SERVICE_KEY;
  }
  if (parsed.TAGO_BUS_ROUTE_SERVICE_KEY !== undefined) {
    tagoServiceKeys.route = parsed.TAGO_BUS_ROUTE_SERVICE_KEY;
  }
  if (parsed.TAGO_BUS_ARRIVAL_SERVICE_KEY !== undefined) {
    tagoServiceKeys.arrival = parsed.TAGO_BUS_ARRIVAL_SERVICE_KEY;
  }
  if (parsed.TAGO_BUS_LOCATION_SERVICE_KEY !== undefined) {
    tagoServiceKeys.location = parsed.TAGO_BUS_LOCATION_SERVICE_KEY;
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    ...(parsed.KAKAO_REST_API_KEY === undefined
      ? {}
      : { kakaoRestApiKey: parsed.KAKAO_REST_API_KEY }),
    ...(parsed.NAVER_MAP_NCP_KEY_ID === undefined
      ? {}
      : { naverMapNcpKeyId: parsed.NAVER_MAP_NCP_KEY_ID }),
    ...(parsed.NAVER_MAP_NCP_KEY === undefined
      ? {}
      : { naverMapNcpKey: parsed.NAVER_MAP_NCP_KEY }),
    database: {
      url: parsed.DATABASE_URL,
      poolMax: parsed.DATABASE_POOL_MAX,
      connectTimeoutMs: parsed.DATABASE_CONNECT_TIMEOUT_MS,
      statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
      sslMode: parsed.DATABASE_SSL_MODE,
    },
    port: parsed.PORT,
    webOrigin: parsed.WEB_ORIGIN,
    ...(parsed.WEB_DIST_PATH === undefined
      ? {}
      : { webDistPath: parsed.WEB_DIST_PATH }),
    logLevel: parsed.LOG_LEVEL,
    metrics: {
      enabled: parsed.METRICS_ENABLED === "1",
      port: parsed.METRICS_PORT,
      ...(parsed.APP_COMMIT_SHA === undefined
        ? {}
        : { commitSha: parsed.APP_COMMIT_SHA }),
      ...(parsed.BACKUP_STATUS_PATH === undefined
        ? {}
        : { backupStatusPath: parsed.BACKUP_STATUS_PATH }),
      ...(parsed.TRANSIT_SYNC_STATUS_PATH === undefined
        ? {}
        : { transitSyncStatusPath: parsed.TRANSIT_SYNC_STATUS_PATH }),
    },
    liveApiTest: parsed.LIVE_API_TEST === "1",
    ...(parsed.DATA_GO_KR_SERVICE_KEY === undefined
      ? {}
      : { dataGoKrServiceKey: parsed.DATA_GO_KR_SERVICE_KEY }),
    tagoServiceKeys,
    tagoBaseUrl: parsed.TAGO_BASE_URL.replace(/\/+$/u, ""),
    tagoResponseType: parsed.TAGO_RESPONSE_TYPE,
    tagoDefaultCityCode: parsed.TAGO_DEFAULT_CITY_CODE,
    ...(parsed.BUS_STOPS_DATA_PATH === undefined
      ? {}
      : { busStopsDataPath: parsed.BUS_STOPS_DATA_PATH }),
    tagoHttpTimeoutMs: parsed.TAGO_HTTP_TIMEOUT_MS,
    tagoHttpRetryCount: parsed.TAGO_HTTP_RETRY_COUNT,
    tagoCacheTtlSeconds: {
      nearbyStops: parsed.TAGO_NEARBY_STOP_CACHE_TTL_SECONDS,
      route: parsed.TAGO_ROUTE_CACHE_TTL_SECONDS,
      routeStops: parsed.TAGO_ROUTE_STOPS_CACHE_TTL_SECONDS,
      arrivals: parsed.TAGO_ARRIVAL_CACHE_TTL_SECONDS,
      locations: parsed.TAGO_LOCATION_CACHE_TTL_SECONDS,
    },
    transit: {
      maxNearbyStopDistanceMeters:
        parsed.TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS,
      routeSearchMaxDistanceMeters:
        parsed.TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS,
      maxTransferCount: parsed.TRANSIT_MAX_TRANSFER_COUNT as 0 | 1,
      walkSpeedKmh: parsed.TRANSIT_WALK_SPEED_KMH,
      busAverageSpeedKmh: parsed.TRANSIT_BUS_AVERAGE_SPEED_KMH,
      stopDwellSeconds: parsed.TRANSIT_STOP_DWELL_SECONDS,
    },
  };
}
