import type { NormalizedRoute, Place } from "@chimap/contracts";

import {
  coordinateCacheKey,
  fiveMinuteBucket,
  MemoryCache,
  normalizeSearchTerm,
  waitForSharedLoad,
} from "../services/cache.js";
import type {
  BusGeometryRequest,
  MobilityProvider,
  PlaceSearchOptions,
  TransitRouteRequest,
  WalkRouteRequest,
  WalkingRouteProvider,
} from "./types.js";
import type { ResolvedBusGeometry } from "./route-geometry.js";

const PLACE_TTL_MS = 60 * 60 * 1000;
const TRANSIT_TTL_MS = 90 * 1000;
const WALK_TTL_MS = 24 * 60 * 60 * 1000;

export class CachedMobilityProvider implements MobilityProvider {
  public readonly source: "KAKAO" | "TAGO";

  readonly #provider: MobilityProvider;
  readonly #cache: MemoryCache;

  public constructor(provider: MobilityProvider, cache = new MemoryCache()) {
    this.#provider = provider;
    this.#cache = cache;
    this.source = provider.source;
  }

  public async searchPlaces(
    query: string,
    options: PlaceSearchOptions = {},
  ): Promise<Place[]> {
    const { signal, ...sharedOptions } = options;
    const center =
      options.center === undefined
        ? "none"
        : coordinateCacheKey(options.center);
    const limit = options.limit ?? 5;
    const radius = options.radiusMeters ?? "none";
    const key = [
      "places",
      normalizeSearchTerm(query),
      center,
      radius,
      limit,
    ].join(":");

    return waitForSharedLoad(
      this.#cache.getOrLoad(key, PLACE_TTL_MS, () =>
        this.#provider.searchPlaces(query, sharedOptions),
      ),
      signal,
    );
  }

  public async getTransitRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    const { signal, ...sharedRequest } = request;
    const key = [
      "transit",
      coordinateCacheKey(request.origin.location),
      coordinateCacheKey(request.destination.location),
      fiveMinuteBucket(),
      request.geometryProfile ?? "legacy-geometry",
    ].join(":");

    return waitForSharedLoad(
      this.#cache.getOrLoad(key, TRANSIT_TTL_MS, () =>
        this.#provider.getTransitRoutes(sharedRequest),
      ),
      signal,
    );
  }

  public async getWalkingRoute(
    request: WalkRouteRequest,
  ): Promise<NormalizedRoute> {
    const { signal, observeCacheState, ...sharedRequest } = request;
    if (signal?.aborted === true) {
      throw signal.reason ??
        new DOMException("요청이 취소되었습니다.", "AbortError");
    }
    const viaKey = (request.vias ?? []).map(coordinateCacheKey).join(";");
    const key = [
      "walk",
      coordinateCacheKey(request.origin),
      viaKey,
      coordinateCacheKey(request.destination),
      request.routeMode ?? "BROAD_FIRST",
    ].join(":");

    const cacheState = this.#cache.getLoadState(key);
    try {
      observeCacheState?.(cacheState);
    } catch {
      // Cache observability must never change a walking route result.
    }

    return waitForSharedLoad(
      this.#cache.getOrLoad(key, WALK_TTL_MS, () =>
        this.#provider.getWalkingRoute(sharedRequest),
      ),
      signal,
    );
  }

  public resolveBusGeometry(
    request: BusGeometryRequest,
  ): Promise<ResolvedBusGeometry> {
    if (this.#provider.resolveBusGeometry === undefined) {
      return Promise.reject(
        new TypeError("이 mobility provider는 버스 geometry를 지원하지 않습니다."),
      );
    }
    return this.#provider.resolveBusGeometry(request);
  }
}

export class CachedWalkingProvider implements WalkingRouteProvider {
  public readonly source: WalkingRouteProvider["source"];

  public constructor(
    private readonly provider: WalkingRouteProvider,
    private readonly ttlMilliseconds: number,
    private readonly cache = new MemoryCache(),
  ) {
    this.source = provider.source;
  }

  public getWalkingRoute(
    request: WalkRouteRequest,
  ): Promise<NormalizedRoute> {
    const { signal, observeCacheState, ...sharedRequest } = request;
    if (signal?.aborted === true) {
      return Promise.reject(
        signal.reason ??
          new DOMException("요청이 취소되었습니다.", "AbortError"),
      );
    }
    const viaKey = (request.vias ?? []).map(coordinateCacheKey).join(";");
    const key = [
      "walk-v3",
      this.source,
      coordinateCacheKey(request.origin),
      viaKey,
      coordinateCacheKey(request.destination),
      request.routeMode ?? "BROAD_FIRST",
    ].join(":");

    const cacheState = this.cache.getLoadState(key);
    try {
      observeCacheState?.(cacheState);
    } catch {
      // Cache observability must never change a walking route result.
    }

    return waitForSharedLoad(
      this.cache.getOrLoad(key, this.ttlMilliseconds, () =>
        this.provider.getWalkingRoute(sharedRequest),
      ),
      signal,
    );
  }
}
