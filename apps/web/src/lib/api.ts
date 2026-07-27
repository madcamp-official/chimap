import {
  authSessionResponseSchema,
  busArrivalsResponseSchema,
  busRouteStopsResponseSchema,
  busVehiclesResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  placeSearchResponseSchema,
  recommendationRequestSchema,
  recommendationResponseSchema,
  reverseGeocodeResponseSchema,
  subwayDeparturesResponseSchema,
  subwayStationsResponseSchema,
  type Coordinate,
  type BusArrivalsResponse,
  type BusRouteStopsResponse,
  type BusVehiclesResponse,
  type ErrorCode,
  type HealthResponse,
  type PlaceSearchResponse,
  type RecommendationRequest,
  type RecommendationResponse,
  type ReverseGeocodeResponse,
  type SubwayDeparturesResponse,
  type SubwayStationsResponse,
  type UiEventPayload,
  type AuthSessionResponse,
} from "@chimap/contracts";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL =
  configuredApiBaseUrl ||
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export class ApiClientError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly requestId?: string;
  public readonly fieldErrors?: Record<string, string[]>;

  public constructor(options: {
    code: ErrorCode;
    message: string;
    status: number;
    requestId?: string;
    fieldErrors?: Record<string, string[]>;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.status = options.status;
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.fieldErrors !== undefined) {
      this.fieldErrors = options.fieldErrors;
    }
  }
}

async function fetchJson(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(data);
    if (parsed.success) {
      throw new ApiClientError({
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        status: response.status,
        requestId: parsed.data.error.requestId,
        ...(parsed.data.error.fieldErrors === undefined
          ? {}
          : { fieldErrors: parsed.data.error.fieldErrors }),
      });
    }
    throw new ApiClientError({
      code: "INTERNAL_ERROR",
      message: "서버 응답을 확인하지 못했어요.",
      status: response.status,
    });
  }
  return data;
}

export function getKakaoLoginUrl(): string {
  return `${API_BASE_URL}/api/v1/auth/kakao/start`;
}

export async function getAuthSession(
  signal?: AbortSignal,
): Promise<AuthSessionResponse> {
  return authSessionResponseSchema.parse(
    await fetchJson("/api/v1/auth/session", {
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export async function logout(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("로그아웃하지 못했어요. 다시 시도해 주세요.");
  }
}

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return healthResponseSchema.parse(
    await fetchJson("/api/v1/health", {
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export async function searchPlaces(input: {
  query: string;
  scope: "suggest" | "resolve";
  center?: Coordinate;
  signal?: AbortSignal;
}): Promise<PlaceSearchResponse> {
  const parameters = new URLSearchParams({
    query: input.query,
    scope: input.scope,
    limit: "8",
  });
  if (input.center !== undefined) {
    parameters.set("x", String(input.center.lng));
    parameters.set("y", String(input.center.lat));
  }
  return placeSearchResponseSchema.parse(
    await fetchJson(`/api/v1/places?${parameters.toString()}`, {
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  );
}

export async function reverseGeocode(
  coordinate: Coordinate,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResponse> {
  const parameters = new URLSearchParams({
    x: String(coordinate.lng),
    y: String(coordinate.lat),
  });
  return reverseGeocodeResponseSchema.parse(
    await fetchJson(`/api/v1/places/reverse?${parameters.toString()}`, {
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export async function createRecommendations(
  request: RecommendationRequest,
  signal?: AbortSignal,
): Promise<RecommendationResponse> {
  const payload = recommendationRequestSchema.parse(request);
  return recommendationResponseSchema.parse(
    await fetchJson("/api/v1/recommendations", {
      method: "POST",
      body: JSON.stringify(payload),
      ...(signal === undefined ? {} : { signal }),
    }),
  );
}

export async function sendUiEvent(
  payload: UiEventPayload,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/ui-events`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: "include",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) {
    throw new Error("사용성 이벤트를 집계하지 못했습니다.");
  }
}

export async function getBusRouteStops(input: {
  cityCode: string;
  routeId: string;
  signal?: AbortSignal;
}): Promise<BusRouteStopsResponse> {
  const parameters = new URLSearchParams({ cityCode: input.cityCode });
  return busRouteStopsResponseSchema.parse(
    await fetchJson(
      `/api/v1/transit/bus/routes/${encodeURIComponent(input.routeId)}/stops?${parameters.toString()}`,
      input.signal === undefined ? {} : { signal: input.signal },
    ),
  );
}

export async function getBusVehicles(input: {
  cityCode: string;
  routeId: string;
  signal?: AbortSignal;
}): Promise<BusVehiclesResponse> {
  const parameters = new URLSearchParams({ cityCode: input.cityCode });
  return busVehiclesResponseSchema.parse(
    await fetchJson(
      `/api/v1/transit/bus/routes/${encodeURIComponent(input.routeId)}/vehicles?${parameters.toString()}`,
      input.signal === undefined ? {} : { signal: input.signal },
    ),
  );
}

export async function getBusArrivals(input: {
  cityCode: string;
  nodeId: string;
  signal?: AbortSignal;
}): Promise<BusArrivalsResponse> {
  const parameters = new URLSearchParams({ cityCode: input.cityCode });
  return busArrivalsResponseSchema.parse(
    await fetchJson(
      `/api/v1/transit/bus/stops/${encodeURIComponent(input.nodeId)}/arrivals?${parameters.toString()}`,
      input.signal === undefined ? {} : { signal: input.signal },
    ),
  );
}

export async function getNearbySubwayStations(input: {
  coordinate: Coordinate;
  radiusMeters?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SubwayStationsResponse> {
  const parameters = new URLSearchParams({
    lat: String(input.coordinate.lat),
    lng: String(input.coordinate.lng),
    radiusMeters: String(input.radiusMeters ?? 2_000),
    limit: String(input.limit ?? 3),
  });
  return subwayStationsResponseSchema.parse(
    await fetchJson(
      `/api/v1/transit/subway/stations/nearby?${parameters.toString()}`,
      input.signal === undefined ? {} : { signal: input.signal },
    ),
  );
}

export async function getSubwayDepartures(input: {
  stationId: string;
  direction: "U" | "D";
  at?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SubwayDeparturesResponse> {
  const parameters = new URLSearchParams({
    direction: input.direction,
    limit: String(input.limit ?? 2),
  });
  if (input.at !== undefined) {
    parameters.set("at", input.at);
  }
  return subwayDeparturesResponseSchema.parse(
    await fetchJson(
      `/api/v1/transit/subway/stations/${encodeURIComponent(input.stationId)}/departures?${parameters.toString()}`,
      input.signal === undefined ? {} : { signal: input.signal },
    ),
  );
}
