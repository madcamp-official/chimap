import {
  haversineDistanceMeters,
  type Coordinate,
  type Place,
  type PlaceSearchResponse,
  type ReverseGeocodeResponse,
} from "@chimap/contracts";

import { ProviderError } from "../errors.js";
import type { KakaoLocalClient } from "../providers/kakao-local-client.js";
import type { NaverGeocodingClient } from "../providers/naver-geocoding-client.js";
import {
  coordinateCacheKey,
  MemoryCache,
  normalizeSearchTerm,
} from "./cache.js";

const SEARCH_TTL_MS = 10 * 60 * 1000;
const EMPTY_SEARCH_TTL_MS = 60 * 1000;
const REVERSE_TTL_MS = 24 * 60 * 60 * 1000;

type SearchInput = {
  query: string;
  scope: "suggest" | "resolve";
  limit: number;
  center?: Coordinate;
  signal?: AbortSignal;
};

function isImmediateFailure(error: unknown): boolean {
  return (
    error instanceof ProviderError &&
    (error.kind === "CONFIGURATION" || error.kind === "ABORTED")
  );
}

function normalizedAddress(place: Place): string {
  return normalizeSearchTerm(place.roadAddress || place.address || place.name);
}

export function mergePlaces(
  query: string,
  primary: Place[],
  secondary: Place[],
  limit: number,
  center?: Coordinate,
): Place[] {
  const merged: Place[] = [];
  for (const place of [...primary, ...secondary]) {
    const address = normalizedAddress(place);
    const duplicate = merged.some(
      (candidate) =>
        normalizedAddress(candidate) === address &&
        haversineDistanceMeters(candidate.location, place.location) <= 20,
    );
    if (!duplicate) {
      merged.push(place);
    }
  }
  const normalizedQuery = normalizeSearchTerm(query);
  return merged
    .map((place, index) => ({
      place,
      index,
      exact:
        normalizeSearchTerm(place.name) === normalizedQuery ||
        normalizeSearchTerm(place.address) === normalizedQuery ||
        normalizeSearchTerm(place.roadAddress) === normalizedQuery,
      distance:
        center === undefined
          ? undefined
          : haversineDistanceMeters(center, place.location),
    }))
    .sort(
      (first, second) =>
        Number(second.exact) - Number(first.exact) ||
        (first.distance ?? 0) - (second.distance ?? 0) ||
        first.index - second.index,
    )
    .slice(0, limit)
    .map(({ place }) => place);
}

export class PlaceLookupService {
  readonly #kakao: KakaoLocalClient;
  readonly #naver: NaverGeocodingClient | undefined;
  readonly #cache: MemoryCache;

  public constructor(options: {
    kakao: KakaoLocalClient;
    naver?: NaverGeocodingClient;
    cache?: MemoryCache;
  }) {
    this.#kakao = options.kakao;
    this.#naver = options.naver;
    this.#cache = options.cache ?? new MemoryCache(16 * 1024 * 1024);
  }

  public search(input: SearchInput): Promise<PlaceSearchResponse> {
    const key = [
      "place-lookup",
      input.scope,
      normalizeSearchTerm(input.query),
      input.limit,
      input.center === undefined
        ? "none"
        : coordinateCacheKey(input.center),
    ].join(":");
    return this.#cache.getOrLoadWithTtl(key, async () => {
      const value =
        input.scope === "suggest"
          ? await this.#suggest(input)
          : await this.#resolve(input);
      return {
        value,
        ttlMilliseconds:
          value.items.length === 0 ? EMPTY_SEARCH_TTL_MS : SEARCH_TTL_MS,
      };
    });
  }

  async #suggest(input: SearchInput): Promise<PlaceSearchResponse> {
    let degraded = false;
    let kakaoFailure: unknown;
    try {
      const keyword = await this.#kakao.searchKeyword(input.query, {
        limit: input.limit,
        ...(input.center === undefined ? {} : { center: input.center }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (keyword.length > 0) {
        return {
          items: keyword.slice(0, input.limit),
          meta: {
            provider: "KAKAO",
            strategy: "KAKAO_KEYWORD",
            fallbackUsed: false,
            degraded: false,
          },
        };
      }
    } catch (error) {
      if (isImmediateFailure(error)) {
        throw error;
      }
      degraded = true;
      kakaoFailure = error;
    }

    try {
      const addresses = await this.#kakao.searchAddress(input.query, {
        limit: input.limit,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (addresses.length > 0) {
        return {
          items: addresses.slice(0, input.limit),
          meta: {
            provider: "KAKAO",
            strategy: "KAKAO_ADDRESS",
            fallbackUsed: false,
            degraded,
          },
        };
      }
    } catch (error) {
      if (isImmediateFailure(error)) {
        throw error;
      }
      degraded = true;
      kakaoFailure ??= error;
    }
    return this.#naverFallback(input, degraded, kakaoFailure);
  }

  async #resolve(input: SearchInput): Promise<PlaceSearchResponse> {
    const [keywordResult, addressResult] = await Promise.allSettled([
      this.#kakao.searchKeyword(input.query, {
        limit: input.limit,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
      this.#kakao.searchAddress(input.query, {
        limit: input.limit,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      }),
    ]);
    for (const result of [keywordResult, addressResult]) {
      if (result.status === "rejected" && isImmediateFailure(result.reason)) {
        throw result.reason;
      }
    }
    const keyword =
      keywordResult.status === "fulfilled" ? keywordResult.value : [];
    const addresses =
      addressResult.status === "fulfilled" ? addressResult.value : [];
    const items = mergePlaces(
      input.query,
      keyword,
      addresses,
      input.limit,
      input.center,
    );
    const degraded =
      keywordResult.status === "rejected" ||
      addressResult.status === "rejected";
    if (items.length > 0) {
      return {
        items,
        meta: {
          provider: "KAKAO",
          strategy:
            keyword.length > 0 && addresses.length > 0
              ? "KAKAO_KEYWORD_ADDRESS"
              : keyword.length > 0
                ? "KAKAO_KEYWORD"
                : "KAKAO_ADDRESS",
          fallbackUsed: false,
          degraded,
        },
      };
    }
    const failure =
      keywordResult.status === "rejected"
        ? keywordResult.reason
        : addressResult.status === "rejected"
          ? addressResult.reason
          : undefined;
    return this.#naverFallback(input, degraded, failure);
  }

  async #naverFallback(
    input: SearchInput,
    degraded: boolean,
    kakaoFailure?: unknown,
  ): Promise<PlaceSearchResponse> {
    if (this.#naver === undefined) {
      if (kakaoFailure !== undefined) {
        throw kakaoFailure;
      }
      return {
        items: [],
        meta: {
          provider: "NONE",
          strategy: "NONE",
          fallbackUsed: false,
          degraded,
        },
      };
    }
    try {
      const items = await this.#naver.geocode(
        input.query,
        input.limit,
        input.signal,
      );
      return {
        items,
        meta: {
          provider: items.length > 0 ? "NAVER" : "NONE",
          strategy: items.length > 0 ? "NAVER_GEOCODE" : "NONE",
          fallbackUsed: true,
          degraded,
        },
      };
    } catch (error) {
      throw error;
    }
  }

  public reverseGeocode(
    coordinate: Coordinate,
    signal?: AbortSignal,
  ): Promise<ReverseGeocodeResponse> {
    const key = `reverse-geocode:${coordinateCacheKey(coordinate)}`;
    return this.#cache.getOrLoad(key, REVERSE_TTL_MS, async () => {
      let degraded = false;
      let kakaoFailure: unknown;
      try {
        const place = await this.#kakao.reverseGeocode(coordinate, signal);
        if (place !== null) {
          return {
            place,
            meta: {
              provider: "KAKAO",
              fallbackUsed: false,
              degraded: false,
            },
          };
        }
      } catch (error) {
        if (isImmediateFailure(error)) {
          throw error;
        }
        degraded = true;
        kakaoFailure = error;
      }
      if (this.#naver === undefined) {
        if (kakaoFailure !== undefined) {
          throw kakaoFailure;
        }
        return {
          place: null,
          meta: {
            provider: "NONE",
            fallbackUsed: false,
            degraded,
          },
        };
      }
      try {
        const place = await this.#naver.reverseGeocode(coordinate, signal);
        return {
          place,
          meta: {
            provider: place === null ? "NONE" : "NAVER",
            fallbackUsed: true,
            degraded,
          },
        };
      } catch (error) {
        throw error;
      }
    });
  }
}
