import type {
  Coordinate,
  NormalizedRoute,
  Place,
} from "@chimap/contracts";

import {
  normalizeKakaoTransitResponse,
  normalizeKakaoWalkResponse,
} from "./kakao-normalizers.js";
import { KakaoLocalClient } from "./kakao-local-client.js";
import { KakaoRestClient } from "./kakao-rest-client.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  TransitRouteRequest,
  WalkRouteRequest,
} from "./types.js";

function appendCoordinate(
  parameters: URLSearchParams,
  prefix: "start" | "end",
  coordinate: Coordinate,
): void {
  parameters.set(`${prefix}_x`, coordinate.lng.toString());
  parameters.set(`${prefix}_y`, coordinate.lat.toString());
}

export class KakaoMobilityProvider implements MobilityProvider {
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
}
