import {
  busArrivalsResponseSchema,
  busVehiclesResponseSchema,
  subwayDeparturesResponseSchema,
  subwayStationsResponseSchema,
  type BusArrivalsResponse,
  type BusVehiclesResponse,
  type Coordinate,
  type SubwayDeparturesResponse,
  type SubwayStationsResponse,
} from "@chimap/contracts";

import { mobileClientHeaders } from "../api/client-metadata";
import { fetchWithTimeout } from "../api/fetch-with-timeout";

async function getJson(
  apiBaseUrl: string,
  path: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetchWithTimeout(
    `${apiBaseUrl}${path}`,
    {
      headers: mobileClientHeaders({ Authorization: `Bearer ${accessToken}` }),
      ...(signal === undefined ? {} : { signal }),
    },
    8_000,
  );
  if (!response.ok) throw new Error(`교통 정보 요청 실패 (${response.status})`);
  return response.json();
}

export async function getBusVehicles(input: {
  apiBaseUrl: string;
  accessToken: string;
  cityCode: string;
  routeId: string;
  signal?: AbortSignal;
}): Promise<BusVehiclesResponse> {
  const query = new URLSearchParams({ cityCode: input.cityCode });
  return busVehiclesResponseSchema.parse(
    await getJson(
      input.apiBaseUrl,
      `/api/v1/transit/bus/routes/${encodeURIComponent(input.routeId)}/vehicles?${query.toString()}`,
      input.accessToken,
      input.signal,
    ),
  );
}

export async function getBusArrivals(input: {
  apiBaseUrl: string;
  accessToken: string;
  cityCode: string;
  nodeId: string;
  signal?: AbortSignal;
}): Promise<BusArrivalsResponse> {
  const query = new URLSearchParams({ cityCode: input.cityCode });
  return busArrivalsResponseSchema.parse(
    await getJson(
      input.apiBaseUrl,
      `/api/v1/transit/bus/stops/${encodeURIComponent(input.nodeId)}/arrivals?${query.toString()}`,
      input.accessToken,
      input.signal,
    ),
  );
}

export async function getNearbySubwayStations(input: {
  apiBaseUrl: string;
  accessToken: string;
  coordinate: Coordinate;
  radiusMeters?: number;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SubwayStationsResponse> {
  const query = new URLSearchParams({
    lat: String(input.coordinate.lat),
    lng: String(input.coordinate.lng),
    radiusMeters: String(input.radiusMeters ?? 2_000),
    limit: String(input.limit ?? 3),
  });
  return subwayStationsResponseSchema.parse(
    await getJson(
      input.apiBaseUrl,
      `/api/v1/transit/subway/stations/nearby?${query.toString()}`,
      input.accessToken,
      input.signal,
    ),
  );
}

export async function getSubwayDepartures(input: {
  apiBaseUrl: string;
  accessToken: string;
  stationId: string;
  direction: "U" | "D";
  at?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SubwayDeparturesResponse> {
  const query = new URLSearchParams({
    direction: input.direction,
    limit: String(input.limit ?? 2),
  });
  if (input.at !== undefined) query.set("at", input.at);
  return subwayDeparturesResponseSchema.parse(
    await getJson(
      input.apiBaseUrl,
      `/api/v1/transit/subway/stations/${encodeURIComponent(input.stationId)}/departures?${query.toString()}`,
      input.accessToken,
      input.signal,
    ),
  );
}
