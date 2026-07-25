import type { NormalizedRoute, Place } from "@chimap/contracts";

import {
  coordinateCacheKey,
  fiveMinuteBucket,
  MemoryCache,
  normalizeSearchTerm,
} from "../services/cache.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  TransitRouteRequest,
  WalkRouteRequest,
} from "./types.js";

const PLACE_TTL_MS = 60 * 60 * 1000;
const TRANSIT_TTL_MS = 90 * 1000;
const WALK_TTL_MS = 30 * 60 * 1000;

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

    return this.#cache.getOrLoad(key, PLACE_TTL_MS, () =>
      this.#provider.searchPlaces(query, options),
    );
  }

  public async getTransitRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    const key = [
      "transit",
      coordinateCacheKey(request.origin.location),
      coordinateCacheKey(request.destination.location),
      fiveMinuteBucket(),
    ].join(":");

    return this.#cache.getOrLoad(key, TRANSIT_TTL_MS, () =>
      this.#provider.getTransitRoutes(request),
    );
  }

  public async getWalkingRoute(
    request: WalkRouteRequest,
  ): Promise<NormalizedRoute> {
    const viaKey = (request.vias ?? []).map(coordinateCacheKey).join(";");
    const key = [
      "walk",
      coordinateCacheKey(request.origin),
      viaKey,
      coordinateCacheKey(request.destination),
      request.routeMode ?? "BROAD_FIRST",
    ].join(":");

    return this.#cache.getOrLoad(key, WALK_TTL_MS, () =>
      this.#provider.getWalkingRoute(request),
    );
  }
}
