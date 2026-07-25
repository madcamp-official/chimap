import {
  haversineDistanceMeters,
  type Coordinate,
  type NormalizedRoute,
  type Place,
} from "@chimap/contracts";

import {
  normalizeKakaoDrivingGeometry,
  normalizeKakaoTransitResponse,
  normalizeKakaoWalkResponse,
} from "./kakao-normalizers.js";
import { KakaoLocalClient } from "./kakao-local-client.js";
import { KakaoRestClient } from "./kakao-rest-client.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  RoadGeometryProvider,
  RoadRouteRequest,
  TransitRouteRequest,
  WalkRouteRequest,
} from "./types.js";

const KAKAO_DIRECTIONS_URL =
  "https://apis-navi.kakaomobility.com/v1/waypoints/directions";
const MAX_DIRECTIONS_POINTS = 32;

function appendCoordinate(
  parameters: URLSearchParams,
  prefix: "start" | "end",
  coordinate: Coordinate,
): void {
  parameters.set(`${prefix}_x`, coordinate.lng.toString());
  parameters.set(`${prefix}_y`, coordinate.lat.toString());
}

function distinctRoadPoints(points: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (
      previous === undefined ||
      haversineDistanceMeters(previous, point) > 3
    ) {
      result.push(point);
    }
  }
  return result;
}

function chunkRoadPoints(points: Coordinate[]): Coordinate[][] {
  const chunks: Coordinate[][] = [];
  let start = 0;
  while (start < points.length - 1) {
    const end = Math.min(
      start + MAX_DIRECTIONS_POINTS - 1,
      points.length - 1,
    );
    chunks.push(points.slice(start, end + 1));
    start = end;
  }
  return chunks;
}

export class KakaoMobilityProvider
  implements MobilityProvider, RoadGeometryProvider
{
  public readonly source = "KAKAO" as const;
  public readonly local: KakaoLocalClient;

  readonly #rest: KakaoRestClient;

  public constructor(restApiKey: string, fetchImplementation = fetch) {
    this.#rest = new KakaoRestClient(restApiKey, fetchImplementation);
    this.local = new KakaoLocalClient(this.#rest);
  }

  public async searchPlaces(
    query: string,
    options: PlaceSearchOptions = {},
  ): Promise<Place[]> {
    return this.local.searchKeyword(query, options);
  }

  public async getTransitRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    const parameters = new URLSearchParams({
      input_coord: "WGS84",
      output_coord: "WGS84",
      s_name: request.origin.name,
      e_name: request.destination.name,
    });
    appendCoordinate(parameters, "start", request.origin.location);
    appendCoordinate(parameters, "end", request.destination.location);

    const response = await this.#rest.requestJson(
      "/v2/routing/publictraffic",
      parameters,
      {
        timeoutMilliseconds: 5_000,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    return normalizeKakaoTransitResponse(response);
  }

  public async getWalkingRoute(
    request: WalkRouteRequest,
  ): Promise<NormalizedRoute> {
    const parameters = new URLSearchParams({
      input_coord: "WGS84",
      output_coord: "WGS84",
      route_mode: request.routeMode ?? "BROAD_FIRST",
    });
    appendCoordinate(parameters, "start", request.origin);
    appendCoordinate(parameters, "end", request.destination);
    if (request.vias !== undefined && request.vias.length > 0) {
      const vias = request.vias.slice(0, 5);
      parameters.set("via_x", vias.map((point) => point.lng).join(","));
      parameters.set("via_y", vias.map((point) => point.lat).join(","));
    }

    const response = await this.#rest.requestJson(
      "/v2/routing/walk",
      parameters,
      {
        timeoutMilliseconds: 5_000,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    return normalizeKakaoWalkResponse(response);
  }

  public async getRoadRouteGeometry(
    request: RoadRouteRequest,
  ): Promise<Coordinate[]> {
    const points = distinctRoadPoints(request.points);
    if (points.length < 2) {
      return points;
    }
    const geometries = await Promise.all(
      chunkRoadPoints(points).map(async (chunk) => {
        const origin = chunk[0]!;
        const destination = chunk.at(-1)!;
        const response = await this.#rest.requestJsonBody(
          new URL(KAKAO_DIRECTIONS_URL),
          {
            origin: { x: origin.lng, y: origin.lat },
            destination: {
              x: destination.lng,
              y: destination.lat,
            },
            waypoints: chunk.slice(1, -1).map((point) => ({
              x: point.lng,
              y: point.lat,
            })),
            priority: "RECOMMEND",
            alternatives: false,
            road_details: false,
            summary: false,
          },
          {
            timeoutMilliseconds: 5_000,
            ...(request.signal === undefined
              ? {}
              : { signal: request.signal }),
          },
        );
        return normalizeKakaoDrivingGeometry(response);
      }),
    );
    const joined: Coordinate[] = [];
    for (const geometry of geometries) {
      for (const coordinate of geometry) {
        const previous = joined.at(-1);
        if (
          previous === undefined ||
          previous.lng !== coordinate.lng ||
          previous.lat !== coordinate.lat
        ) {
          joined.push(coordinate);
        }
      }
    }
    return joined;
  }
}
