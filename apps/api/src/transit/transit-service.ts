import type {
  BusArrival,
  BusRoute,
  BusRouteStop,
  BusStop,
  BusVehiclePosition,
  Coordinate,
  SubwayDeparture,
  SubwayStation,
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

function normalizedStationName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\([^)]*\)/gu, "")
    .replace(/역$/u, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase();
}

function normalizedLineName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase();
}

function sameSubwayLine(csvName: string, tagoName: string): boolean {
  const csv = normalizedLineName(csvName);
  const tago = normalizedLineName(tagoName);
  if (csv === tago) {
    return true;
  }
  const csvNumber = csv.match(/(\d+)호선$/u)?.[1];
  const tagoNumber = tago.match(/(\d+)호선$/u)?.[1];
  return (
    csvNumber !== undefined &&
    tagoNumber !== undefined &&
    csvNumber === tagoNumber
  );
}

function kstParts(at: Date): {
  date: string;
  day: number;
  hour: number;
} {
  const shifted = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    day: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  };
}

function kstIso(milliseconds: number): string {
  const shifted = new Date(milliseconds + 9 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+09:00`;
}

function scheduleTimestamp(
  serviceDate: string,
  rawTime: string,
  at: Date,
): number {
  const hours = Number(rawTime.slice(0, 2));
  const minutes = Number(rawTime.slice(2, 4));
  const seconds = Number(rawTime.slice(4, 6));
  let timestamp =
    Date.parse(`${serviceDate}T00:00:00+09:00`) +
    (hours * 3600 + minutes * 60 + seconds) * 1000;
  if (hours < 4 && kstParts(at).hour >= 4) {
    timestamp += 24 * 60 * 60 * 1000;
  }
  return timestamp;
}

export type NearbyStopsResult = {
  items: BusStop[];
  partial: boolean;
};

export type SubwayDepartureResult = {
  station: SubwayStation | null;
  items: SubwayDeparture[];
  scheduleAvailable: boolean;
  unavailableReason:
    | "TAGO_STATION_UNRESOLVED"
    | "NO_UPCOMING_DEPARTURES"
    | null;
  fetchedAt: string;
};

type SubwayMetricsObserver = (input: {
  operation: "station_search" | "station_schedule";
  outcome: "success" | "failure";
  durationSeconds: number;
}) => void;

export class TransitService {
  public readonly client: TagoClient;
  public readonly repository: TransitRepository;

  readonly #config: AppConfig;
  readonly #cache: MemoryCache;
  readonly #logger: Logger;
  #subwayMetricsObserver: SubwayMetricsObserver | undefined;

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

  public setSubwayMetricsObserver(observer: SubwayMetricsObserver): void {
    this.#subwayMetricsObserver = observer;
  }

  async #observeSubwayRequest<T>(
    operation: "station_search" | "station_schedule",
    request: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await request();
      this.#subwayMetricsObserver?.({
        operation,
        outcome: "success",
        durationSeconds: (performance.now() - startedAt) / 1000,
      });
      return result;
    } catch (error) {
      this.#subwayMetricsObserver?.({
        operation,
        outcome: "failure",
        durationSeconds: (performance.now() - startedAt) / 1000,
      });
      throw error;
    }
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

  public searchSubwayStations(
    query: string,
    limit: number,
  ): Promise<SubwayStation[]> {
    return this.repository.searchSubwayStations(query, limit);
  }

  public findNearbySubwayStations(
    coordinate: Coordinate,
    radiusMeters: number,
    limit: number,
  ): Promise<SubwayStation[]> {
    return this.repository.findNearbySubwayStations(
      coordinate,
      radiusMeters,
      limit,
    );
  }

  public async syncSubwayStationMappings(
    concurrency = 4,
    signal?: AbortSignal,
  ): Promise<{
    mapped: number;
    unresolved: number;
    failed: number;
    checked: number;
  }> {
    const stations = await this.repository.subwayStationsForMapping();
    let nextIndex = 0;
    let mapped = 0;
    let unresolved = 0;
    let failed = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, Math.max(stations.length, 1)) },
      async () => {
        while (nextIndex < stations.length) {
          const station = stations[nextIndex];
          nextIndex += 1;
          if (station === undefined) {
            continue;
          }
          const queryName = station.name
            .replace(/\([^)]*\)/gu, "")
            .replace(/역$/u, "")
            .trim();
          let candidates;
          try {
            candidates = await this.#cache.getOrLoad(
              `tago:subway:station-search:${normalizedStationName(queryName)}`,
              24 * 60 * 60 * 1000,
              () =>
                this.#observeSubwayRequest("station_search", () =>
                  this.client.searchSubwayStations(queryName, signal),
                ),
            );
          } catch (error) {
            if (!(error instanceof TagoApiError)) {
              throw error;
            }
            failed += 1;
            this.#logger.warn({
              event: "transit.subway_station_mapping_partial",
              stationId: station.id,
              resultCode: error.resultCode,
              retryable: error.retryable,
            });
            continue;
          }
          const matches = candidates.filter(
            (candidate) =>
              normalizedStationName(candidate.name) ===
                normalizedStationName(station.name) &&
              sameSubwayLine(station.lineName, candidate.routeName),
          );
          if (matches.length === 1) {
            const match = matches[0]!;
            await this.repository.updateSubwayStationMapping({
              id: station.id,
              status: "MAPPED",
              tagoStationId: match.stationId,
              tagoRouteName: match.routeName,
            });
            mapped += 1;
          } else {
            await this.repository.updateSubwayStationMapping({
              id: station.id,
              status: "UNRESOLVED",
              tagoStationId: null,
              tagoRouteName: null,
            });
            unresolved += 1;
          }
        }
      },
    );
    await Promise.all(workers);
    return { mapped, unresolved, failed, checked: stations.length };
  }

  public async getSubwayDepartures(input: {
    stationId: string;
    direction: "U" | "D";
    at: Date;
    limit: number;
    signal?: AbortSignal;
  }): Promise<SubwayDepartureResult> {
    const station = await this.repository.getSubwayStation(input.stationId);
    if (station === null) {
      return {
        station: null,
        items: [],
        scheduleAvailable: false,
        unavailableReason: "TAGO_STATION_UNRESOLVED",
        fetchedAt: new Date().toISOString(),
      };
    }
    if (station.tagoStationId === null) {
      return {
        station,
        items: [],
        scheduleAvailable: false,
        unavailableReason: "TAGO_STATION_UNRESOLVED",
        fetchedAt: new Date().toISOString(),
      };
    }
    const parts = kstParts(input.at);
    const dailyTypeCode = parts.day === 0 ? "03" : parts.day === 6 ? "02" : "01";
    const schedules = await this.#cache.getOrLoad(
      `tago:subway:schedules:${station.tagoStationId}:${dailyTypeCode}:${input.direction}`,
      this.#config.tagoCacheTtlSeconds.subwaySchedules * 1000,
      () =>
        this.#observeSubwayRequest("station_schedule", () =>
          this.client.getSubwaySchedules(
            station.tagoStationId!,
            dailyTypeCode,
            input.direction,
            input.signal,
          ),
        ),
    );
    const items = schedules
      .map((schedule): SubwayDeparture => {
        const departureTimestamp = scheduleTimestamp(
          parts.date,
          schedule.departureTime,
          input.at,
        );
        let arrivalTimestamp = scheduleTimestamp(
          parts.date,
          schedule.arrivalTime,
          input.at,
        );
        if (arrivalTimestamp < departureTimestamp) {
          arrivalTimestamp += 24 * 60 * 60 * 1000;
        }
        return {
          stationId: station.id,
          stationName: schedule.stationName,
          tagoStationId: schedule.stationId,
          subwayRouteId: schedule.subwayRouteId,
          terminalStationId: schedule.terminalStationId,
          terminalStationName: schedule.terminalStationName,
          direction: schedule.direction,
          dailyTypeCode: schedule.dailyTypeCode,
          rawDepartureTime: schedule.departureTime,
          rawArrivalTime: schedule.arrivalTime,
          departureAt: kstIso(departureTimestamp),
          arrivalAt: kstIso(arrivalTimestamp),
          scheduleBased: true,
        };
      })
      .filter(
        (departure) => Date.parse(departure.departureAt) >= input.at.getTime(),
      )
      .sort(
        (first, second) =>
          Date.parse(first.departureAt) - Date.parse(second.departureAt),
      )
      .slice(0, input.limit);
    return {
      station,
      items,
      scheduleAvailable: items.length > 0,
      unavailableReason:
        items.length === 0 ? "NO_UPCOMING_DEPARTURES" : null,
      fetchedAt: new Date().toISOString(),
    };
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
