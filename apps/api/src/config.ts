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
    KAKAO_MODE: z.enum(["mock", "live"]).default("mock"),
    KAKAO_REST_API_KEY: optionalSecret,
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
    TRANSIT_DB_PATH: optionalSecret,
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
    USE_MOCK_TRANSIT_DATA: z.enum(["true", "false"]).default("false"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    WEB_ORIGIN: z.url().default("http://localhost:5173"),
    WEB_DIST_PATH: optionalSecret,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    LIVE_API_TEST: z.enum(["0", "1"]).default("0"),
  })
  .superRefine((environment, context) => {
    if (
      environment.KAKAO_MODE === "live" &&
      environment.KAKAO_REST_API_KEY === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["KAKAO_REST_API_KEY"],
        message: "live 모드에는 KAKAO_REST_API_KEY가 필요합니다.",
      });
    }
    if (
      environment.NODE_ENV === "production" &&
      environment.USE_MOCK_TRANSIT_DATA === "true"
    ) {
      context.addIssue({
        code: "custom",
        path: ["USE_MOCK_TRANSIT_DATA"],
        message: "production에서는 mock 대중교통 데이터를 사용할 수 없습니다.",
      });
    }
  });

export type TagoServiceKind = "stop" | "route" | "arrival" | "location";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  kakaoMode: "mock" | "live";
  kakaoRestApiKey?: string;
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
  liveApiTest: boolean;
  dataGoKrServiceKey?: string;
  tagoServiceKeys: Partial<Record<TagoServiceKind, string>>;
  tagoBaseUrl: string;
  tagoResponseType: "json";
  tagoDefaultCityCode: string;
  busStopsDataPath?: string;
  transitDatabasePath: string;
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
    maxTransferCount: 0 | 1;
    walkSpeedKmh: number;
    busAverageSpeedKmh: number;
    stopDwellSeconds: number;
  };
  useMockTransitData: boolean;
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
    kakaoMode: parsed.KAKAO_MODE,
    ...(parsed.KAKAO_REST_API_KEY === undefined
      ? {}
      : { kakaoRestApiKey: parsed.KAKAO_REST_API_KEY }),
    port: parsed.PORT,
    webOrigin: parsed.WEB_ORIGIN,
    ...(parsed.WEB_DIST_PATH === undefined
      ? {}
      : { webDistPath: parsed.WEB_DIST_PATH }),
    logLevel: parsed.LOG_LEVEL,
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
    transitDatabasePath:
      parsed.TRANSIT_DB_PATH ??
      (parsed.NODE_ENV === "test" ? ":memory:" : ".data/transit.sqlite"),
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
      maxTransferCount: parsed.TRANSIT_MAX_TRANSFER_COUNT as 0 | 1,
      walkSpeedKmh: parsed.TRANSIT_WALK_SPEED_KMH,
      busAverageSpeedKmh: parsed.TRANSIT_BUS_AVERAGE_SPEED_KMH,
      stopDwellSeconds: parsed.TRANSIT_STOP_DWELL_SECONDS,
    },
    useMockTransitData: parsed.USE_MOCK_TRANSIT_DATA === "true",
  };
}
