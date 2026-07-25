import type {
  Coordinate,
  NormalizedRoute,
  Place,
} from "@chimap/contracts";

import { ProviderError } from "../errors.js";
import {
  normalizeKakaoPlaceResponse,
  normalizeKakaoTransitResponse,
  normalizeKakaoWalkResponse,
} from "./kakao-normalizers.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  TransitRouteRequest,
  WalkRouteRequest,
} from "./types.js";

const KAKAO_BASE_URL = "https://dapi.kakao.com";
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

type RequestOptions = {
  timeoutMilliseconds: number;
  signal?: AbortSignal;
};

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

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
  public readonly mode = "live" as const;

  readonly #restApiKey: string;
  readonly #fetch: typeof fetch;

  public constructor(restApiKey: string, fetchImplementation = fetch) {
    if (restApiKey.length === 0) {
      throw new Error("Kakao REST API 키가 필요합니다.");
    }
    this.#restApiKey = restApiKey;
    this.#fetch = fetchImplementation;
  }

  async #requestJson(
    path: string,
    parameters: URLSearchParams,
    options: RequestOptions,
  ): Promise<unknown> {
    const url = new URL(path, KAKAO_BASE_URL);
    url.search = parameters.toString();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const timeoutSignal = AbortSignal.timeout(options.timeoutMilliseconds);
      const signal =
        options.signal === undefined
          ? timeoutSignal
          : AbortSignal.any([options.signal, timeoutSignal]);
      try {
        const response = await this.#fetch(url, {
          method: "GET",
          headers: {
            Authorization: `KakaoAK ${this.#restApiKey}`,
            Accept: "application/json",
          },
          signal,
        });

        if (response.ok) {
          return (await response.json()) as unknown;
        }

        if (RETRYABLE_STATUSES.has(response.status) && attempt === 0) {
          await delay(100 + Math.floor(Math.random() * 100), options.signal);
          continue;
        }

        if (response.status === 429) {
          throw new ProviderError({
            kind: "RATE_LIMIT",
            message: "Kakao API rate limit",
            retryable: true,
          });
        }

        throw new ProviderError({
          kind: "UPSTREAM",
          message: `Kakao API HTTP ${response.status}`,
          retryable: RETRYABLE_STATUSES.has(response.status),
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        if (options.signal?.aborted === true) {
          throw new ProviderError({
            kind: "ABORTED",
            message: "Kakao 요청이 취소되었습니다.",
            cause: error,
          });
        }
        if (timeoutSignal.aborted) {
          if (attempt === 0) {
            continue;
          }
          throw new ProviderError({
            kind: "TIMEOUT",
            message: "Kakao 요청 시간이 초과되었습니다.",
            retryable: true,
            cause: error,
          });
        }
        if (attempt === 0) {
          await delay(100 + Math.floor(Math.random() * 100), options.signal);
          continue;
        }
        throw new ProviderError({
          kind: "UPSTREAM",
          message: "Kakao 네트워크 요청에 실패했습니다.",
          retryable: true,
          cause: error,
        });
      }
    }

    throw new ProviderError({
      kind: "UPSTREAM",
      message: "Kakao 요청이 완료되지 않았습니다.",
    });
  }

  public async searchPlaces(
    query: string,
    options: PlaceSearchOptions = {},
  ): Promise<Place[]> {
    const parameters = new URLSearchParams({
      query,
      size: String(options.limit ?? 5),
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

    const response = await this.#requestJson(
      "/v2/local/search/keyword.json",
      parameters,
      {
        timeoutMilliseconds: 3_000,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    return normalizeKakaoPlaceResponse(response);
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

    const response = await this.#requestJson(
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

    const response = await this.#requestJson(
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
