import {
  haversineDistanceMeters,
  type Coordinate,
  type NormalizedRoute,
  type Place,
} from "@chimap/contracts";

import {
  normalizeKakaoDrivingSections,
  normalizeKakaoTransitResponse,
  normalizeKakaoWalkResponse,
} from "./kakao-normalizers.js";
import { KakaoLocalClient } from "./kakao-local-client.js";
import {
  KakaoRestClient,
  type KakaoRouteProviderObservation,
} from "./kakao-rest-client.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  RoadGeometryProvider,
  RoadRouteRequest,
  RoadRouteSectionsRequest,
  RoadRouteSectionsResult,
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

function polylineDistanceMeters(points: readonly Coordinate[]): number {
  let distance = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    distance += haversineDistanceMeters(points[index]!, points[index + 1]!);
  }
  return distance;
}

/**
 * Kakao 자동차 길찾기는 버스 정류장 좌표를 자동차 경유지로 스냅하면서
 * 가까운 두 정류장 사이에 불필요한 U턴·블록 우회를 만들 수 있다. 응답을
 * 정류장 구간별로 검증해 과도한 우회나 잘못 연결된 구간을 걸러낸다.
 */
export function isPlausibleRoadSection(
  section: readonly Coordinate[],
  from: Coordinate,
  to: Coordinate,
): boolean {
  if (section.length < 2) {
    return false;
  }
  const straightDistance = Math.max(1, haversineDistanceMeters(from, to));
  const pathDistance = polylineDistanceMeters(section);
  const endpointTolerance = Math.min(
    250,
    Math.max(75, straightDistance * 0.5),
  );
  const detourLimit = Math.max(
    straightDistance + 300,
    straightDistance * 3,
  );
  return (
    haversineDistanceMeters(from, section[0]!) <= endpointTolerance &&
    haversineDistanceMeters(to, section.at(-1)!) <= endpointTolerance &&
    pathDistance <= detourLimit
  );
}

export function roadGeometryForWaypoints(
  sections: readonly (readonly Coordinate[])[],
  waypoints: readonly Coordinate[],
): Coordinate[] {
  const joined: Coordinate[] = [];
  const append = (coordinate: Coordinate) => {
    const previous = joined.at(-1);
    if (
      previous === undefined ||
      previous.lng !== coordinate.lng ||
      previous.lat !== coordinate.lat
    ) {
      joined.push(coordinate);
    }
  };
  const sectionsMatchWaypoints = sections.length === waypoints.length - 1;
  for (let index = 0; index < waypoints.length - 1; index += 1) {
    const from = waypoints[index]!;
    const to = waypoints[index + 1]!;
    const section = sectionsMatchWaypoints ? sections[index] ?? [] : [];
    append(from);
    if (isPlausibleRoadSection(section, from, to)) {
      section.forEach(append);
    }
    append(to);
  }
  return joined;
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

  public setRouteProviderObserver(
    observer: (observation: KakaoRouteProviderObservation) => void,
  ): void {
    this.#rest.setRouteProviderObserver(observer);
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
        timeoutMilliseconds: 3_500,
        operation: "ROUTE_SEARCH",
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
        timeoutMilliseconds: 3_500,
        operation: "WALK_GEOMETRY",
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      },
    );
    return normalizeKakaoWalkResponse(response, {
      origin: request.origin,
      destination: request.destination,
    });
  }

  public async getRoadRouteGeometry(
    request: RoadRouteRequest,
  ): Promise<Coordinate[]> {
    const points = distinctRoadPoints(request.points);
    if (points.length < 2) {
      return points;
    }
    const { sections } = await this.getRoadRouteSections({
      points,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return roadGeometryForWaypoints(sections, points);
  }

  public async getRoadRouteSections(
    request: RoadRouteSectionsRequest,
  ): Promise<RoadRouteSectionsResult> {
    if (request.points.length < 2) {
      return { sections: [] };
    }
    const sectionGroups = await Promise.all(
      chunkRoadPoints(request.points).map(async (chunk) => {
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
            timeoutMilliseconds: 3_500,
            operation: "ROAD_GEOMETRY",
            ...(request.signal === undefined
              ? {}
              : { signal: request.signal }),
          },
        );
        return normalizeKakaoDrivingSections(response);
      }),
    );
    return { sections: sectionGroups.flat() };
  }
}
