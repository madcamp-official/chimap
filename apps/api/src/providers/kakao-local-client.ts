import type { Coordinate, Place } from "@chimap/contracts";

import {
  normalizeKakaoAddressResponse,
  normalizeKakaoPlaceResponse,
  normalizeKakaoReverseGeocodeResponse,
} from "./kakao-normalizers.js";
import { KakaoRestClient } from "./kakao-rest-client.js";

export type KakaoLocalOptions = {
  center?: Coordinate;
  limit?: number;
  radiusMeters?: number;
  signal?: AbortSignal;
};

export class KakaoLocalClient {
  readonly #rest: KakaoRestClient;

  public constructor(rest: KakaoRestClient) {
    this.#rest = rest;
  }

  public async searchKeyword(
    query: string,
    options: KakaoLocalOptions = {},
  ): Promise<Place[]> {
    const parameters = new URLSearchParams({
      query,
      size: String(options.limit ?? 8),
    });
    if (options.center !== undefined) {
      parameters.set("x", options.center.lng.toString());
      parameters.set("y", options.center.lat.toString());
      parameters.set("sort", "distance");
      if (options.radiusMeters !== undefined) {
        parameters.set(
          "radius",
          String(Math.min(Math.max(options.radiusMeters, 0), 20_000)),
        );
      }
    }
    return normalizeKakaoPlaceResponse(
      await this.#rest.requestJson(
        "/v2/local/search/keyword.json",
        parameters,
        {
          timeoutMilliseconds: 3000,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      ),
    );
  }

  public async searchAddress(
    query: string,
    options: Pick<KakaoLocalOptions, "limit" | "signal"> = {},
  ): Promise<Place[]> {
    const parameters = new URLSearchParams({
      query,
      analyze_type: "similar",
      size: String(options.limit ?? 8),
    });
    return normalizeKakaoAddressResponse(
      await this.#rest.requestJson(
        "/v2/local/search/address.json",
        parameters,
        {
          timeoutMilliseconds: 3000,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      ),
    );
  }

  public async reverseGeocode(
    coordinate: Coordinate,
    signal?: AbortSignal,
  ): Promise<Place | null> {
    const parameters = new URLSearchParams({
      x: String(coordinate.lng),
      y: String(coordinate.lat),
      input_coord: "WGS84",
    });
    return normalizeKakaoReverseGeocodeResponse(
      await this.#rest.requestJson(
        "/v2/local/geo/coord2address.json",
        parameters,
        {
          timeoutMilliseconds: 3000,
          ...(signal === undefined ? {} : { signal }),
        },
      ),
      coordinate,
    );
  }
}
