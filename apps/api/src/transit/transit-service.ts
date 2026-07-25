import type {
  BusArrival,
  BusRoute,
  BusRouteStop,
  BusStop,
  BusVehiclePosition,
  Coordinate,
} from "@chimap/contracts";
import type { Logger } from "pino";

import type { AppConfig, TagoServiceKind } from "../config.js";
import { MemoryCache } from "../services/cache.js";
import {
  TagoApiError,
  TagoClient,
  type TagoCityCode,
} from "./tago-client.js";
import { TransitRepository } from "./transit-repository.js";

function roundedCoordinate(value: number): string {
  return value.toFixed(4);
}

function uniqueStops(stops: BusStop[]): BusStop[] {
  const result = new Map<string, BusStop>();
  for (const stop of stops) {
    const identity = stop.nodeId ?? stop.sourceStopNo;
    const key =
      identity ??
      `${stop.name}:${stop.latitude.toFixed(5)}:${stop.longitude.toFixed(5)}`;
    const existing = result.get(key);
    if (
      existing === undefined ||
      (stop.distanceMeters ?? Infinity) <
        (existing.distanceMeters ?? Infinity) ||
      (existing.nodeId === null && stop.nodeId !== null)
    ) {
      result.set(key, stop);
    }
  }
  return [...result.values()].sort(
    (first, second) =>
      (first.distanceMeters ?? Infinity) -
      (second.distanceMeters ?? Infinity),
  );
}

export type NearbyStopsResult = {
  items: BusStop[];
  partial: boolean;
};

export class TransitService {
  public readonly client: TagoClient;
  public readonly repository: TransitRepository;

  readonly #config: AppConfig;
  readonly #cache: MemoryCache;
  readonly #logger: Logger;

  public constructor(options: {
    config: AppConfig;
    logger: Logger;
    client?: TagoClient;
    repository?: TransitRepository;
    cache?: MemoryCache;
  }) {
    this.#config = options.config;
    this.#logger = options.logger;
    this.client = options.client ?? new TagoClient(options.config);
    this.repository =
      options.repository ??
      new TransitRepository(options.config.database);
    this.#cache = options.cache ?? new MemoryCache(64 * 1024 * 1024);
  }

  public initialize(): Promise<void> {
    return this.repository.migrate();
  }

  public close(): Promise<void> {
    return this.repository.close();
  }

  public hasServiceKey(service: TagoServiceKind): boolean {
    return this.client.hasServiceKey(service);
  }

  public getCityCodes(
    service: TagoServiceKind = "stop",
    signal?: AbortSignal,
  ): Promise<TagoCityCode[]> {
    return this.#cache.getOrLoad(
      `tago:city-codes:${service}`,
      this.#config.tagoCacheTtlSeconds.route * 1000,
      () => this.client.getCityCodes(service, signal),
    );
  }

  public async getNearbyStops(
    coordinate: Coordinate,
    radiusMeters = this.#config.transit.maxNearbyStopDistanceMeters,
    signal?: AbortSignal,
  ): Promise<NearbyStopsResult> {
    const radius = Math.min(
      Math.max(1, radiusMeters),
      this.#config.transit.routeSearchMaxDistanceMeters,
    );
    const databaseStops = await this.repository.findNearbyStops(
      coordinate.lat,
      coordinate.lng,
      radius,
    );
    const linkedDatabaseStopCount = databaseStops.filter(
      (stop) => stop.cityCode !== null && stop.nodeId !== null,
    ).length;
    const linkedCoverageIsSufficient =
      linkedDatabaseStopCount >= 8 &&
      linkedDatabaseStopCount / Math.max(databaseStops.length, 1) >= 0.8;
    if (linkedCoverageIsSufficient) {
      return { items: uniqueStops(databaseStops), partial: false };
    }

    try {
      const tagoStops = await this.#cache.getOrLoad(
        `tago:nearby-stops:${roundedCoordinate(coordinate.lat)}:${roundedCoordinate(coordinate.lng)}`,
        this.#config.tagoCacheTtlSeconds.nearbyStops * 1000,
        () => this.client.getNearbyStops(coordinate, signal),
      );
      const reconciled = await Promise.all(tagoStops.map(async (stop) => {
        const result = await this.repository.reconcileTagoStop(stop);
        if (result.status === "ambiguous") {
          this.#logger.warn({
            event: "transit.stop_match_ambiguous",
            cityCode: stop.cityCode,
            nodeId: stop.nodeId,
            candidateCount: result.candidateIds.length,
          });
          return stop;
        }
        return {
          ...result.stop,
          distanceMeters: stop.distanceMeters,
        };
      }));
      return {
        items: uniqueStops([...databaseStops, ...reconciled]).filter(
          (stop) => (stop.distanceMeters ?? Infinity) <= radius,
        ),
        partial: false,
      };
    } catch (error) {
      if (
        error instanceof TagoApiError &&
        error.resultCode !== "CONFIGURATION_ERROR" &&
        databaseStops.length > 0
      ) {
        this.#logger.warn({
          event: "transit.nearby_partial",
          resultCode: error.resultCode,
          retryable: error.retryable,
        });
        return { items: databaseStops, partial: true };
      }
      throw error;
    }
  }

  public async getRoutesByStop(
    cityCode: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<{ items: BusRoute[]; source: "database" | "tago" }> {
    const stored = await this.repository.getRoutesByStop(cityCode, nodeId);
    if (stored.length > 0) {
      return { items: stored, source: "database" };
    }
    try {
      const routes = await this.#cache.getOrLoad(
        `tago:stop-routes:${cityCode}:${nodeId}`,
        this.#config.tagoCacheTtlSeconds.route * 1000,
        () => this.client.getRoutesByStop(cityCode, nodeId, signal),
      );
      await Promise.all(
        routes.map((route) => this.repository.upsertRoute(route)),
      );
      return { items: routes, source: "tago" };
    } catch (error) {
      if (
        error instanceof TagoApiError &&
        error.resultCode !== "CONFIGURATION_ERROR" &&
        stored.length > 0
      ) {
        this.#logger.warn({
          event: "transit.stop_routes_partial",
          cityCode,
          resultCode: error.resultCode,
          storedRouteCount: stored.length,
        });
        return { items: stored, source: "database" };
      }
      throw error;
    }
  }

  public async getRoute(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusRoute> {
    const stored = await this.repository.getRoute(cityCode, routeId);
    if (stored !== undefined) {
      return stored;
    }
    const route = await this.#cache.getOrLoad(
      `tago:route:${cityCode}:${routeId}`,
      this.#config.tagoCacheTtlSeconds.route * 1000,
      () => this.client.getRouteInfo(cityCode, routeId, signal),
    );
    return this.repository.upsertRoute(route);
  }

  public async getRouteStops(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusRouteStop[]> {
    const stored = await this.repository.getRouteStops(cityCode, routeId);
    if (stored.length > 0) {
      return stored;
    }
    const stops = await this.#cache.getOrLoad(
      `tago:route-stops:${cityCode}:${routeId}`,
      this.#config.tagoCacheTtlSeconds.routeStops * 1000,
      () => this.client.getRouteStops(cityCode, routeId, signal),
    );
    const route = await this.getRoute(cityCode, routeId, signal);
    await this.repository.replaceRouteStops(route, stops);
    return this.repository.getRouteStops(cityCode, routeId);
  }

  public getArrivals(
    cityCode: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    return this.#cache.getOrLoad(
      `tago:arrivals:${cityCode}:${nodeId}`,
      this.#config.tagoCacheTtlSeconds.arrivals * 1000,
      () => this.client.getArrivals(cityCode, nodeId, signal),
    );
  }

  public getArrivalsForRoute(
    cityCode: string,
    nodeId: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    return this.#cache.getOrLoad(
      `tago:arrivals:${cityCode}:${nodeId}:${routeId}`,
      this.#config.tagoCacheTtlSeconds.arrivals * 1000,
      () =>
        this.client.getArrivalsForRoute(
          cityCode,
          nodeId,
          routeId,
          signal,
        ),
    );
  }

  public getVehiclePositions(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusVehiclePosition[]> {
    return this.#cache.getOrLoad(
      `tago:vehicle-locations:${cityCode}:${routeId}`,
      this.#config.tagoCacheTtlSeconds.locations * 1000,
      () => this.client.getVehiclePositions(cityCode, routeId, signal),
    );
  }

  public async syncRoute(
    cityCode: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<{ route: BusRoute; stops: BusRouteStop[] }> {
    const [route, stops] = await Promise.all([
      this.client.getRouteInfo(cityCode, routeId, signal),
      this.client.getRouteStops(cityCode, routeId, signal),
    ]);
    await this.repository.replaceRouteStops(route, stops);
    return {
      route: (await this.repository.getRoute(cityCode, routeId)) ?? route,
      stops: await this.repository.getRouteStops(cityCode, routeId),
    };
  }
}
