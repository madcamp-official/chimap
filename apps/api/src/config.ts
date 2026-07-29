import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.url().optional(),
);

const optionalSessionSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0
      ? undefined
      : value,
  z.string().min(32).optional(),
);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    KAKAO_REST_API_KEY: optionalSecret,
    KAKAO_OAUTH_CLIENT_SECRET: optionalSecret,
    KAKAO_OAUTH_REDIRECT_URI: optionalUrl,
    AUTH_SESSION_SECRET: optionalSessionSecret,
    AUTH_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    AUTH_MOBILE_ENABLED: z.enum(["0", "1"]).default("0"),
    AUTH_MOBILE_ACCESS_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(60)
      .default(15),
    AUTH_MOBILE_REFRESH_TTL_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .default(30),
    AUTH_REFRESH_GRACE_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(300)
      .default(120),
    AUTH_REFRESH_RETRY_ENCRYPTION_KEY: optionalSecret,
    APPLE_CLIENT_ID_IOS: optionalSecret,
    APPLE_TEAM_ID: optionalSecret,
    APPLE_KEY_ID: optionalSecret,
    APPLE_PRIVATE_KEY_BASE64: optionalSecret,
    KAKAO_APP_ID: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim().length === 0
          ? undefined
          : value,
      z.string().trim().regex(/^\d+$/u).optional(),
    ),
    MOBILE_MIN_IOS_VERSION: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
      .default("0.1.0"),
    MOBILE_MIN_ANDROID_VERSION: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u)
      .default("0.1.0"),
    MOBILE_MAINTENANCE_ENABLED: z.enum(["0", "1"]).default("0"),
    MOBILE_MAINTENANCE_MESSAGE: optionalSecret,
    MOBILE_SUPPORTED_REGIONS: z.string().trim().min(1).default("대전"),
    MOBILE_PRIVACY_POLICY_VERSION: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .default("2026-07-26"),
    MOBILE_VEHICLE_POLLING_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(60)
      .default(15),
    MOBILE_GUEST_ENABLED: z.enum(["0", "1"]).default("1"),
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
    SEOUL_SUBWAY_API_KEY: optionalSecret,
    SEOUL_SUBWAY_BASE_URL: z
      .url()
      .default("https://swopenAPI.seoul.go.kr"),
    SEOUL_SUBWAY_ENABLED: z.enum(["0", "1"]).default("0"),
    SEOUL_SUBWAY_ALLOW_INSECURE_HTTP: z.enum(["0", "1"]).default("0"),
    SEOUL_SUBWAY_HTTP_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(10_000)
      .default(3000),
    SEOUL_SUBWAY_DAILY_REQUEST_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(900),
    SEOUL_SUBWAY_ARRIVAL_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(120)
      .default(25),
    SEOUL_SUBWAY_POSITION_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(120)
      .default(30),
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
    SUBWAY_STATIONS_DATA_PATH: optionalSecret,
    SUBWAY_TOPOLOGY_DATA_DIR: optionalSecret,
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
      .default(10),
    TAGO_LOCATION_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    TAGO_SUBWAY_SCHEDULE_CACHE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(21_600),
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
      .max(2)
      .default(2),
    TRANSIT_ROUTER_MODE: z
      .enum(["legacy", "shadow", "multimodal"])
      .default("multimodal"),
    TRANSIT_GEOMETRY_V2_ENABLED: z.enum(["0", "1"]).default("0"),
    TRANSIT_WALK_SPEED_KMH: z.coerce.number().positive().default(4.5),
    TRANSIT_BUS_AVERAGE_SPEED_KMH: z.coerce.number().positive().default(20),
    TRANSIT_STOP_DWELL_SECONDS: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(25),
    WALKING_ROUTER: z.enum(["KAKAO", "VALHALLA"]).default("KAKAO"),
    VALHALLA_BASE_URL: optionalUrl,
    VALHALLA_HTTP_TIMEOUT_MS: z.coerce.number().int().min(500).max(10_000).default(3500),
    VALHALLA_HTTP_RETRY_COUNT: z.coerce.number().int().min(0).max(3).default(1),
    VALHALLA_WALK_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
    VALHALLA_MAX_SNAP_DISTANCE_METERS: z.coerce.number().min(10).max(500).default(100),
    VALHALLA_MAX_DETOUR_RATIO: z.coerce.number().min(1).max(20).default(5),
    KAKAO_WALKING_FALLBACK_ENABLED: z.enum(["0", "1"]).default("0"),
    PARK_ROUTE_IMPORT_ENABLED: z.enum(["0", "1"]).default("0"),
    PARK_ROUTE_IMPORT_TOKEN: optionalSecret,
    PARK_ROUTE_INTEGRATION_ENABLED: z.enum(["0", "1"]).default("0"),
    PARK_ROUTE_SEARCH_RADIUS_METERS: z.coerce
      .number()
      .int()
      .min(100)
      .max(2000)
      .default(800),
    PARK_ROUTE_MAX_CANDIDATES: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3),
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
    const authSpecificValues = [
      environment.KAKAO_OAUTH_CLIENT_SECRET,
      environment.KAKAO_OAUTH_REDIRECT_URI,
      environment.AUTH_SESSION_SECRET,
    ];
    if (
      authSpecificValues.some((value) => value !== undefined) &&
      (authSpecificValues.some((value) => value === undefined) ||
        environment.KAKAO_REST_API_KEY === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["KAKAO_OAUTH_CLIENT_SECRET"],
        message:
          "카카오 로그인을 사용하려면 REST API 키, OAuth Client Secret, Redirect URI, 세션 비밀값을 모두 설정해야 합니다.",
      });
    }
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
    if (environment.AUTH_MOBILE_ENABLED === "1") {
      if (
        environment.KAKAO_REST_API_KEY === undefined ||
        environment.KAKAO_APP_ID === undefined ||
        environment.AUTH_REFRESH_RETRY_ENCRYPTION_KEY === undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["AUTH_MOBILE_ENABLED"],
          message:
            "모바일 인증에는 Kakao REST 키, KAKAO_APP_ID, refresh 재시도 암호화 키가 필요합니다.",
        });
      } else {
        const key = Buffer.from(
          environment.AUTH_REFRESH_RETRY_ENCRYPTION_KEY,
          "base64",
        );
        if (key.byteLength !== 32) {
          context.addIssue({
            code: "custom",
            path: ["AUTH_REFRESH_RETRY_ENCRYPTION_KEY"],
            message: "refresh 재시도 암호화 키는 base64 인코딩한 32바이트여야 합니다.",
          });
        }
      }
    }
    const appleValues = [
      environment.APPLE_CLIENT_ID_IOS,
      environment.APPLE_TEAM_ID,
      environment.APPLE_KEY_ID,
      environment.APPLE_PRIVATE_KEY_BASE64,
    ];
    if (
      appleValues.some((value) => value !== undefined) &&
      appleValues.some((value) => value === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["APPLE_CLIENT_ID_IOS"],
        message:
          "Apple 로그인에는 iOS Client ID, Team ID, Key ID, private key를 모두 설정해야 합니다.",
      });
    }
    if (environment.APPLE_PRIVATE_KEY_BASE64 !== undefined) {
      const privateKey = Buffer.from(
        environment.APPLE_PRIVATE_KEY_BASE64,
        "base64",
      ).toString("utf8");
      if (
        !privateKey.includes("-----BEGIN PRIVATE KEY-----") ||
        !privateKey.includes("-----END PRIVATE KEY-----")
      ) {
        context.addIssue({
          code: "custom",
          path: ["APPLE_PRIVATE_KEY_BASE64"],
          message: "Apple private key는 .p8 내용을 base64로 인코딩해야 합니다.",
        });
      }
    }
    if (
      environment.MOBILE_MAINTENANCE_ENABLED === "1" &&
      environment.MOBILE_MAINTENANCE_MESSAGE === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["MOBILE_MAINTENANCE_MESSAGE"],
        message: "모바일 maintenance 상태에는 사용자 안내 문구가 필요합니다.",
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
    if (
      environment.PARK_ROUTE_IMPORT_ENABLED === "1" &&
      (environment.PARK_ROUTE_IMPORT_TOKEN === undefined ||
        environment.PARK_ROUTE_IMPORT_TOKEN.length < 32)
    ) {
      context.addIssue({
        code: "custom",
        path: ["PARK_ROUTE_IMPORT_TOKEN"],
        message:
          "공원 경로 Import API를 활성화하려면 32자 이상의 서버 전용 token이 필요합니다.",
      });
    }
    if (
      environment.WALKING_ROUTER === "VALHALLA" &&
      environment.VALHALLA_BASE_URL === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["VALHALLA_BASE_URL"],
        message: "Valhalla 도보 라우터에는 VALHALLA_BASE_URL이 필요합니다.",
      });
    }
    if (
      environment.SEOUL_SUBWAY_ENABLED === "1" &&
      environment.SEOUL_SUBWAY_API_KEY === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["SEOUL_SUBWAY_API_KEY"],
        message:
          "서울 지하철 실시간 연동을 켜려면 SEOUL_SUBWAY_API_KEY가 필요합니다.",
      });
    }
    const seoulSubwayUrl = new URL(environment.SEOUL_SUBWAY_BASE_URL);
    if (seoulSubwayUrl.protocol === "http:") {
      const approvedOfficialHost =
        seoulSubwayUrl.hostname.toLowerCase() ===
          "swopenapi.seoul.go.kr" &&
        (seoulSubwayUrl.port === "" || seoulSubwayUrl.port === "80") &&
        (seoulSubwayUrl.pathname === "" || seoulSubwayUrl.pathname === "/") &&
        seoulSubwayUrl.search === "" &&
        seoulSubwayUrl.hash === "" &&
        seoulSubwayUrl.username === "" &&
        seoulSubwayUrl.password === "";
      if (!approvedOfficialHost) {
        context.addIssue({
          code: "custom",
          path: ["SEOUL_SUBWAY_BASE_URL"],
          message:
            "암호화되지 않은 서울 지하철 API는 공식 swopenapi.seoul.go.kr 호스트만 사용할 수 있습니다.",
        });
      }
      if (environment.SEOUL_SUBWAY_ALLOW_INSECURE_HTTP !== "1") {
        context.addIssue({
          code: "custom",
          path: ["SEOUL_SUBWAY_ALLOW_INSECURE_HTTP"],
          message:
            "서울시 공식 HTTP API를 사용하려면 비암호화 전송을 명시적으로 허용해야 합니다.",
        });
      }
    } else if (seoulSubwayUrl.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        path: ["SEOUL_SUBWAY_BASE_URL"],
        message: "서울 지하철 API는 HTTP 또는 HTTPS URL이어야 합니다.",
      });
    }
  });

export type TagoServiceKind =
  | "stop"
  | "route"
  | "arrival"
  | "location"
  | "subway";

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  kakaoRestApiKey?: string;
  kakaoAuth?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    sessionSecret: string;
    sessionTtlDays: number;
  };
  mobileAuth?: {
    kakaoAppId: string;
    apple?: {
      clientId: string;
      teamId: string;
      keyId: string;
      privateKey: string;
    };
    accessTtlMinutes: number;
    refreshTtlDays: number;
    graceSeconds: number;
    retryEncryptionKey: Buffer;
  };
  mobileClient: {
    minimumSupportedVersion: { ios: string; android: string };
    maintenance: { enabled: boolean; message: string | null };
    supportedRegions: string[];
    privacyPolicyVersion: string;
    vehiclePollingIntervalSeconds: number;
    guestEnabled: boolean;
  };
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
  seoulSubway: {
    enabled: boolean;
    apiKey?: string;
    baseUrl: string;
    allowInsecureHttp: boolean;
    timeoutMs: number;
    dailyRequestLimit: number;
    arrivalCacheTtlSeconds: number;
    positionCacheTtlSeconds: number;
  };
  tagoServiceKeys: Partial<Record<TagoServiceKind, string>>;
  tagoBaseUrl: string;
  tagoResponseType: "json";
  tagoDefaultCityCode: string;
  busStopsDataPath?: string;
  subwayStationsDataPath?: string;
  subwayTopologyDataDir?: string;
  tagoHttpTimeoutMs: number;
  tagoHttpRetryCount: number;
  tagoCacheTtlSeconds: {
    nearbyStops: number;
    route: number;
    routeStops: number;
    arrivals: number;
    locations: number;
    subwaySchedules: number;
  };
  transit: {
    maxNearbyStopDistanceMeters: number;
    routeSearchMaxDistanceMeters: number;
    maxTransferCount: 0 | 1 | 2;
    routerMode: "legacy" | "shadow" | "multimodal";
    geometryV2Enabled: boolean;
    walkSpeedKmh: number;
    busAverageSpeedKmh: number;
    stopDwellSeconds: number;
  };
  walking: {
    router: "KAKAO" | "VALHALLA";
    valhallaBaseUrl?: string;
    timeoutMs: number;
    retryCount: number;
    cacheTtlSeconds: number;
    maxSnapDistanceMeters: number;
    maxDetourRatio: number;
    kakaoFallbackEnabled: boolean;
  };
  parkRoutes: {
    importEnabled: boolean;
    importToken?: string;
    integrationEnabled: boolean;
    searchRadiusMeters: number;
    maxCandidates: number;
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
    ...(parsed.KAKAO_REST_API_KEY === undefined ||
    parsed.KAKAO_OAUTH_CLIENT_SECRET === undefined ||
    parsed.KAKAO_OAUTH_REDIRECT_URI === undefined ||
    parsed.AUTH_SESSION_SECRET === undefined
      ? {}
      : {
          kakaoAuth: {
            clientId: parsed.KAKAO_REST_API_KEY,
            clientSecret: parsed.KAKAO_OAUTH_CLIENT_SECRET,
            redirectUri: parsed.KAKAO_OAUTH_REDIRECT_URI,
            sessionSecret: parsed.AUTH_SESSION_SECRET,
            sessionTtlDays: parsed.AUTH_SESSION_TTL_DAYS,
          },
        }),
    ...(parsed.AUTH_MOBILE_ENABLED !== "1" ||
    parsed.KAKAO_APP_ID === undefined ||
    parsed.AUTH_REFRESH_RETRY_ENCRYPTION_KEY === undefined
      ? {}
      : {
          mobileAuth: {
            kakaoAppId: parsed.KAKAO_APP_ID,
            ...(parsed.APPLE_CLIENT_ID_IOS === undefined ||
            parsed.APPLE_TEAM_ID === undefined ||
            parsed.APPLE_KEY_ID === undefined ||
            parsed.APPLE_PRIVATE_KEY_BASE64 === undefined
              ? {}
              : {
                  apple: {
                    clientId: parsed.APPLE_CLIENT_ID_IOS,
                    teamId: parsed.APPLE_TEAM_ID,
                    keyId: parsed.APPLE_KEY_ID,
                    privateKey: Buffer.from(
                      parsed.APPLE_PRIVATE_KEY_BASE64,
                      "base64",
                    ).toString("utf8"),
                  },
                }),
            accessTtlMinutes: parsed.AUTH_MOBILE_ACCESS_TTL_MINUTES,
            refreshTtlDays: parsed.AUTH_MOBILE_REFRESH_TTL_DAYS,
            graceSeconds: parsed.AUTH_REFRESH_GRACE_SECONDS,
            retryEncryptionKey: Buffer.from(
              parsed.AUTH_REFRESH_RETRY_ENCRYPTION_KEY,
              "base64",
            ),
          },
        }),
    mobileClient: {
      minimumSupportedVersion: {
        ios: parsed.MOBILE_MIN_IOS_VERSION,
        android: parsed.MOBILE_MIN_ANDROID_VERSION,
      },
      maintenance: {
        enabled: parsed.MOBILE_MAINTENANCE_ENABLED === "1",
        message: parsed.MOBILE_MAINTENANCE_MESSAGE ?? null,
      },
      supportedRegions: parsed.MOBILE_SUPPORTED_REGIONS.split(",")
        .map((region) => region.trim())
        .filter((region) => region.length > 0),
      privacyPolicyVersion: parsed.MOBILE_PRIVACY_POLICY_VERSION,
      vehiclePollingIntervalSeconds:
        parsed.MOBILE_VEHICLE_POLLING_INTERVAL_SECONDS,
      guestEnabled: parsed.MOBILE_GUEST_ENABLED === "1",
    },
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
    seoulSubway: {
      enabled: parsed.SEOUL_SUBWAY_ENABLED === "1",
      ...(parsed.SEOUL_SUBWAY_API_KEY === undefined
        ? {}
        : { apiKey: parsed.SEOUL_SUBWAY_API_KEY }),
      baseUrl: parsed.SEOUL_SUBWAY_BASE_URL.replace(/\/+$/u, ""),
      allowInsecureHttp:
        parsed.SEOUL_SUBWAY_ALLOW_INSECURE_HTTP === "1",
      timeoutMs: parsed.SEOUL_SUBWAY_HTTP_TIMEOUT_MS,
      dailyRequestLimit: parsed.SEOUL_SUBWAY_DAILY_REQUEST_LIMIT,
      arrivalCacheTtlSeconds:
        parsed.SEOUL_SUBWAY_ARRIVAL_CACHE_TTL_SECONDS,
      positionCacheTtlSeconds:
        parsed.SEOUL_SUBWAY_POSITION_CACHE_TTL_SECONDS,
    },
    tagoServiceKeys,
    tagoBaseUrl: parsed.TAGO_BASE_URL.replace(/\/+$/u, ""),
    tagoResponseType: parsed.TAGO_RESPONSE_TYPE,
    tagoDefaultCityCode: parsed.TAGO_DEFAULT_CITY_CODE,
    ...(parsed.BUS_STOPS_DATA_PATH === undefined
      ? {}
      : { busStopsDataPath: parsed.BUS_STOPS_DATA_PATH }),
    ...(parsed.SUBWAY_STATIONS_DATA_PATH === undefined
      ? {}
      : { subwayStationsDataPath: parsed.SUBWAY_STATIONS_DATA_PATH }),
    ...(parsed.SUBWAY_TOPOLOGY_DATA_DIR === undefined
      ? {}
      : { subwayTopologyDataDir: parsed.SUBWAY_TOPOLOGY_DATA_DIR }),
    tagoHttpTimeoutMs: parsed.TAGO_HTTP_TIMEOUT_MS,
    tagoHttpRetryCount: parsed.TAGO_HTTP_RETRY_COUNT,
    tagoCacheTtlSeconds: {
      nearbyStops: parsed.TAGO_NEARBY_STOP_CACHE_TTL_SECONDS,
      route: parsed.TAGO_ROUTE_CACHE_TTL_SECONDS,
      routeStops: parsed.TAGO_ROUTE_STOPS_CACHE_TTL_SECONDS,
      arrivals: parsed.TAGO_ARRIVAL_CACHE_TTL_SECONDS,
      locations: parsed.TAGO_LOCATION_CACHE_TTL_SECONDS,
      subwaySchedules: parsed.TAGO_SUBWAY_SCHEDULE_CACHE_TTL_SECONDS,
    },
    transit: {
      maxNearbyStopDistanceMeters:
        parsed.TRANSIT_MAX_NEARBY_STOP_DISTANCE_METERS,
      routeSearchMaxDistanceMeters:
        parsed.TRANSIT_ROUTE_SEARCH_MAX_DISTANCE_METERS,
      maxTransferCount: parsed.TRANSIT_MAX_TRANSFER_COUNT as 0 | 1 | 2,
      routerMode: parsed.TRANSIT_ROUTER_MODE,
      geometryV2Enabled: parsed.TRANSIT_GEOMETRY_V2_ENABLED === "1",
      walkSpeedKmh: parsed.TRANSIT_WALK_SPEED_KMH,
      busAverageSpeedKmh: parsed.TRANSIT_BUS_AVERAGE_SPEED_KMH,
      stopDwellSeconds: parsed.TRANSIT_STOP_DWELL_SECONDS,
    },
    walking: {
      router: parsed.WALKING_ROUTER,
      ...(parsed.VALHALLA_BASE_URL === undefined
        ? {}
        : { valhallaBaseUrl: parsed.VALHALLA_BASE_URL }),
      timeoutMs: parsed.VALHALLA_HTTP_TIMEOUT_MS,
      retryCount: parsed.VALHALLA_HTTP_RETRY_COUNT,
      cacheTtlSeconds: parsed.VALHALLA_WALK_CACHE_TTL_SECONDS,
      maxSnapDistanceMeters: parsed.VALHALLA_MAX_SNAP_DISTANCE_METERS,
      maxDetourRatio: parsed.VALHALLA_MAX_DETOUR_RATIO,
      kakaoFallbackEnabled: parsed.KAKAO_WALKING_FALLBACK_ENABLED === "1",
    },
    parkRoutes: {
      importEnabled: parsed.PARK_ROUTE_IMPORT_ENABLED === "1",
      ...(parsed.PARK_ROUTE_IMPORT_TOKEN === undefined
        ? {}
        : { importToken: parsed.PARK_ROUTE_IMPORT_TOKEN }),
      integrationEnabled:
        parsed.PARK_ROUTE_INTEGRATION_ENABLED === "1",
      searchRadiusMeters: parsed.PARK_ROUTE_SEARCH_RADIUS_METERS,
      maxCandidates: parsed.PARK_ROUTE_MAX_CANDIDATES,
    },
  };
}
