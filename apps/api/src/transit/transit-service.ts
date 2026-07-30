import type {
  BusArrival,
  BusRoute,
  BusRouteStop,
  BusStop,
  BusVehiclePosition,
  Coordinate,
  SubwayDeparture,
  SubwayStation,
  TransitTiming,
} from "@chimap/contracts";
import type { Logger } from "pino";

import type { AppConfig, TagoServiceKind } from "../config.js";
import { MemoryCache, waitForSharedLoad } from "../services/cache.js";
import { busSegmentSourceHash } from "../providers/route-geometry.js";
import {
  adjustedSeoulWaitSeconds,
  SeoulSubwayClient,
} from "./seoul-subway-client.js";
import {
  TagoApiError,
  TagoClient,
  type TagoCityCode,
  type TagoRouteProviderObservation,
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

function seoulSubwayId(lineName: string): string | null {
  const normalized = normalizedLineName(lineName).replace(/선$/u, "");
  return ({
    "1호": "1001", "2호": "1002", "3호": "1003",
    "4호": "1004", "5호": "1005", "6호": "1006",
    "7호": "1007", "8호": "1008", "9호": "1009",
    경의중앙: "1063", 공항: "1065", 경춘: "1067",
    경강: "1081", 수인분당: "1075", 신분당: "1077",
    우이신설: "1092", 서해: "1093", 신림: "1094",
    gtxa: "1032",
  } as Record<string, string | undefined>)[normalized] ?? null;
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

export type NearbyStopsOptions = {
  mode?: "AUTO" | "DATABASE_ONLY" | "FORCE_ONLINE";
  onlineTimeoutMilliseconds?: number;
  routableOnly?: boolean;
  reconcileOnline?: boolean;
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

const RECOMMENDATION_TIMING_SOFT_TIMEOUT_MILLISECONDS = 2_000;

type TimedOperationResult<T> =
  | { status: "FULFILLED"; value: T }
  | { status: "REJECTED"; error: unknown }
  | { status: "TIMED_OUT" };

async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
): Promise<TimedOperationResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TimedOperationResult<T>>((resolve) => {
    timeout = setTimeout(
      () => resolve({ status: "TIMED_OUT" }),
      timeoutMilliseconds,
    );
  });
  try {
    return await Promise.race([
      operation.then<TimedOperationResult<T>, TimedOperationResult<T>>(
        (value) => ({ status: "FULFILLED", value }),
        (error: unknown) => ({ status: "REJECTED", error }),
      ),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function rethrowClientAbort(signal: AbortSignal | undefined, error: unknown): void {
  if (
    signal?.aborted === true &&
    !(
      signal.reason instanceof DOMException &&
      signal.reason.name === "TimeoutError"
    )
  ) {
    throw error;
  }
}

export class TransitService {
  public readonly client: TagoClient;
  public readonly seoulSubwayClient: SeoulSubwayClient;
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
    this.seoulSubwayClient = new SeoulSubwayClient(options.config);
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

  public setRouteProviderMetricsObserver(
    observer: (observation: TagoRouteProviderObservation) => void,
  ): void {
    this.client.setRouteProviderObserver?.(observer);
  }

  async #recommendationTimingResult<T>(
    operation: () => Promise<T>,
    softTimeoutMilliseconds?: number,
  ): Promise<T | undefined> {
    if (!this.#config.recommendation.phasedTimeoutsEnabled) {
      return operation();
    }
    const timeoutMilliseconds = Math.min(
      RECOMMENDATION_TIMING_SOFT_TIMEOUT_MILLISECONDS,
      softTimeoutMilliseconds ?? RECOMMENDATION_TIMING_SOFT_TIMEOUT_MILLISECONDS,
    );
    if (timeoutMilliseconds <= 0) return undefined;
    const result = await settleWithin(
      operation(),
      timeoutMilliseconds,
    );
    if (result.status === "REJECTED") throw result.error;
    return result.status === "FULFILLED" ? result.value : undefined;
  }

  async #removeMismatchedBusGeometry(
    route: BusRoute,
    stops: BusRouteStop[],
  ): Promise<void> {
    const hashes = stops.slice(0, -1).map((from, index) =>
      busSegmentSourceHash(
        route.cityCode,
        route.routeId,
        from,
        stops[index + 1]!,
      ),
    );
    await this.repository.removeMismatchedBusSegmentGeometries(
      route.cityCode,
      route.routeId,
      hashes,
    );
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
              canonicalStatus: "MAPPED",
              tagoStationId: match.stationId,
              tagoRouteName: match.routeName,
            });
            mapped += 1;
          } else {
            await this.repository.updateSubwayStationMapping({
              id: station.id,
              status: "UNRESOLVED",
              canonicalStatus:
                matches.length > 1 ? "AMBIGUOUS" : "NOT_FOUND",
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

  public async resolveBusTiming(input: {
    cityCode: string;
    nodeId: string;
    routeId: string;
    plannedBoardingAt: Date;
    fallbackWaitSeconds: number;
    signal?: AbortSignal;
    softTimeoutMilliseconds?: number;
  }): Promise<TransitTiming> {
    const now = new Date();
    const futureSeconds = Math.max(
      0,
      Math.round((input.plannedBoardingAt.getTime() - now.getTime()) / 1_000),
    );
    if (futureSeconds <= 600) {
      try {
        const arrivals = await this.#recommendationTimingResult(
          () => this.getArrivalsForRoute(
            input.cityCode,
            input.nodeId,
            input.routeId,
            input.signal,
          ),
          input.softTimeoutMilliseconds,
        );
        const arrival = arrivals
          ?.filter((item) => item.routeId === input.routeId)
          .sort((first, second) => first.arrivalSeconds - second.arrivalSeconds)[0];
        if (arrival !== undefined) {
          return {
            waitSeconds: Math.max(0, arrival.arrivalSeconds - futureSeconds),
            timingSource: "TAGO_BUS_ARRIVAL",
            isRealtime: arrival.isRealtime,
            plannedBoardingAt: input.plannedBoardingAt.toISOString(),
            updatedAt: arrival.fetchedAt,
            stale: false,
          };
        }
      } catch (error) {
        rethrowClientAbort(input.signal, error);
        // 외부 장애는 노선 배차간격 fallback으로 격리한다.
      }
    }
    return {
      waitSeconds: input.fallbackWaitSeconds,
      timingSource: "BUS_INTERVAL_FALLBACK",
      isRealtime: false,
      plannedBoardingAt: input.plannedBoardingAt.toISOString(),
      updatedAt: null,
      stale: false,
    };
  }

  public async resolveSubwayTiming(input: {
    serviceLineId: string;
    stationLineId: string;
    fromSourceStationKey: string;
    toSourceStationKey: string;
    plannedBoardingAt: Date;
    fallbackWaitSeconds: number;
    signal?: AbortSignal;
    softTimeoutMilliseconds?: number;
  }): Promise<TransitTiming & { direction: "U" | "D" | "UNKNOWN" }> {
    const softDeadlineAtMilliseconds =
      this.#config.recommendation.phasedTimeoutsEnabled
        ? performance.now() + Math.min(
            RECOMMENDATION_TIMING_SOFT_TIMEOUT_MILLISECONDS,
            input.softTimeoutMilliseconds ??
              RECOMMENDATION_TIMING_SOFT_TIMEOUT_MILLISECONDS,
          )
        : undefined;
    const remainingSoftTimeout = () =>
      softDeadlineAtMilliseconds === undefined
        ? input.softTimeoutMilliseconds
        : Math.max(0, softDeadlineAtMilliseconds - performance.now());
    const context = await this.repository.getSubwayTimingContext(input);
    const fallback = (direction: "U" | "D" | "UNKNOWN") => ({
      waitSeconds: input.fallbackWaitSeconds,
      timingSource: "SUBWAY_HEADWAY_FALLBACK" as const,
      isRealtime: false,
      plannedBoardingAt: input.plannedBoardingAt.toISOString(),
      updatedAt: null,
      stale: false,
      direction,
    });
    if (context === null) {
      return fallback("UNKNOWN");
    }
    const tagoDirection = context.directionMappings.find(
      (mapping) =>
        mapping.provider === "TAGO" && mapping.mappingStatus === "MAPPED",
    )?.externalDirectionCode;
    const direction = tagoDirection === "U" || tagoDirection === "D"
      ? tagoDirection
      : context.toStationOrder > context.fromStationOrder
        ? "D" as const
        : context.toStationOrder < context.fromStationOrder
          ? "U" as const
          : "UNKNOWN" as const;
    if (direction === "UNKNOWN") {
      return fallback(direction);
    }
    const now = new Date();
    const futureSeconds = Math.max(
      0,
      Math.round((input.plannedBoardingAt.getTime() - now.getTime()) / 1_000),
    );
    const seoul = context.mappings.find(
      (mapping) =>
        mapping.provider === "SEOUL" && mapping.mappingStatus !== "DISABLED",
    );
    if (
      futureSeconds <= 600 &&
      context.roadAddress?.includes("서울") === true &&
      seoul !== undefined &&
      this.seoulSubwayClient.enabled
    ) {
      try {
        const arrivals = await this.#recommendationTimingResult(
          () => {
            const pending = this.#cache.getOrLoad(
              `seoul:subway:arrival:${seoul.queryStationName}:${seoul.externalLineId ?? context.lineName}:${direction}`,
              this.#config.seoulSubway.arrivalCacheTtlSeconds * 1_000,
              () => this.seoulSubwayClient.getArrivals(seoul.queryStationName),
            );
            return waitForSharedLoad(pending, input.signal);
          },
          remainingSoftTimeout(),
        );
        const directionName = context.directionMappings.find(
          (mapping) =>
            mapping.provider === "SEOUL" && mapping.mappingStatus === "MAPPED",
        )?.externalDirectionCode ?? (direction === "U" ? "상행" : "하행");
        const expectedLineId =
          seoul.externalLineId ?? seoulSubwayId(context.lineName);
        const matching = arrivals
          ?.filter((arrival) =>
            arrival.directionName.includes(directionName) &&
            expectedLineId !== null && arrival.subwayId === expectedLineId,
          )
          .map((arrival) => ({
            arrival,
            wait: adjustedSeoulWaitSeconds(
              arrival.remainingSeconds,
              arrival.receivedAt,
              now,
            ),
          }))
          .sort((first, second) => first.wait - second.wait)[0];
        if (matching !== undefined) {
          const rawReceived = matching.arrival.receivedAt.trim().replace(" ", "T");
          const received = Date.parse(
            /(?:Z|[+-]\d\d:\d\d)$/u.test(rawReceived)
              ? rawReceived
              : `${rawReceived}+09:00`,
          );
          return {
            waitSeconds: Math.max(0, matching.wait - futureSeconds),
            timingSource: "SEOUL_REALTIME_ARRIVAL",
            isRealtime: true,
            plannedBoardingAt: input.plannedBoardingAt.toISOString(),
            updatedAt: Number.isFinite(received)
              ? new Date(received).toISOString()
              : now.toISOString(),
            stale: false,
            direction,
          };
        }
      } catch (error) {
        rethrowClientAbort(input.signal, error);
        // TAGO 시간표와 정적 headway fallback을 계속 시도한다.
      }
    }
    const tago = context.mappings.find(
      (mapping) =>
        mapping.provider === "TAGO" &&
        mapping.mappingStatus === "MAPPED" &&
        mapping.externalStationId !== null,
    );
    if (tago !== undefined) {
      try {
        const parts = kstParts(input.plannedBoardingAt);
        const dailyTypeCode = parts.day === 0 ? "03" : parts.day === 6 ? "02" : "01";
        const schedules = await this.#recommendationTimingResult(
          () => {
            const pending = this.#cache.getOrLoadWithTtl(
              `tago:subway:timetable:${tago.externalStationId}:${dailyTypeCode}:${direction}`,
              async () => ({
                value: await this.#observeSubwayRequest("station_schedule", () =>
                  this.client.getSubwaySchedules(
                    tago.externalStationId!,
                    dailyTypeCode,
                    direction,
                  )),
                ttlMilliseconds: Math.min(
                  6 * 60 * 60 * 1_000,
                  Math.max(
                    60_000,
                    Date.parse(`${parts.date}T23:59:59+09:00`) - Date.now(),
                  ),
                ),
              }),
            );
            return waitForSharedLoad(pending, input.signal);
          },
          remainingSoftTimeout(),
        );
        const next = schedules
          ?.map((schedule) => scheduleTimestamp(
            parts.date,
            schedule.departureTime,
            input.plannedBoardingAt,
          ))
          .filter((timestamp) => timestamp >= input.plannedBoardingAt.getTime())
          .sort((first, second) => first - second)[0];
        if (next !== undefined) {
          return {
            waitSeconds: Math.max(
              0,
              Math.round((next - input.plannedBoardingAt.getTime()) / 1_000),
            ),
            timingSource: "TAGO_SUBWAY_TIMETABLE",
            isRealtime: false,
            plannedBoardingAt: input.plannedBoardingAt.toISOString(),
            updatedAt: now.toISOString(),
            stale: false,
            direction,
          };
        }
      } catch (error) {
        rethrowClientAbort(input.signal, error);
        // 정적 headway가 최종 fallback이다.
      }
    }
    return fallback(direction);
  }

  public async getNearbyStops(
    coordinate: Coordinate,
    radiusMeters = this.#config.transit.maxNearbyStopDistanceMeters,
    signal?: AbortSignal,
    options: NearbyStopsOptions = {},
  ): Promise<NearbyStopsResult> {
    const radius = Math.min(
      Math.max(1, radiusMeters),
      this.#config.transit.routeSearchMaxDistanceMeters,
    );
    const databaseStops = options.routableOnly === true
      ? await this.repository.findNearbyRoutableStops(
          coordinate.lat,
          coordinate.lng,
          radius,
        )
      : await this.repository.findNearbyStops(
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
    if (options.mode === "DATABASE_ONLY") {
      return { items: uniqueStops(databaseStops), partial: false };
    }
    if (
      options.mode !== "FORCE_ONLINE" &&
      linkedCoverageIsSufficient
    ) {
      return { items: uniqueStops(databaseStops), partial: false };
    }

    const onlineTimeoutSignal =
      options.onlineTimeoutMilliseconds === undefined
        ? undefined
        : AbortSignal.timeout(options.onlineTimeoutMilliseconds);
    const onlineSignal =
      onlineTimeoutSignal === undefined
        ? signal
        : signal === undefined
          ? onlineTimeoutSignal
          : AbortSignal.any([signal, onlineTimeoutSignal]);
    const cacheNamespace =
      options.mode === "FORCE_ONLINE" ? "recommendation" : "default";
    try {
      const tagoStops = await this.#cache.getOrLoad(
        `tago:nearby-stops:${cacheNamespace}:${roundedCoordinate(coordinate.lat)}:${roundedCoordinate(coordinate.lng)}`,
        this.#config.tagoCacheTtlSeconds.nearbyStops * 1000,
        () => this.client.getNearbyStops(
          coordinate,
          onlineSignal,
          options.mode === "FORCE_ONLINE" ? { retryCount: 0 } : undefined,
        ),
      );
      const reconciled = options.reconcileOnline === false
        ? tagoStops
        : await Promise.all(tagoStops.map(async (stop) => {
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
    const storedStops = await this.repository.getRouteStops(cityCode, routeId);
    await this.#removeMismatchedBusGeometry(route, storedStops);
    return storedStops;
  }

  public getArrivals(
    cityCode: string,
    nodeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    const pending = this.#cache.getOrLoad(
      `tago:arrivals:${cityCode}:${nodeId}`,
      this.#config.tagoCacheTtlSeconds.arrivals * 1000,
      () => this.client.getArrivals(cityCode, nodeId),
    );
    return waitForSharedLoad(pending, signal);
  }

  public getArrivalsForRoute(
    cityCode: string,
    nodeId: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival[]> {
    const pending = this.#cache.getOrLoad(
      `tago:arrivals:${cityCode}:${nodeId}:${routeId}`,
      this.#config.tagoCacheTtlSeconds.arrivals * 1000,
      () =>
        this.client.getArrivalsForRoute(
          cityCode,
          nodeId,
          routeId,
          undefined,
          { retryCount: 0 },
        ),
    );
    return waitForSharedLoad(pending, signal);
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
    const storedRoute = (await this.repository.getRoute(cityCode, routeId)) ?? route;
    const storedStops = await this.repository.getRouteStops(cityCode, routeId);
    await this.#removeMismatchedBusGeometry(storedRoute, storedStops);
    return {
      route: storedRoute,
      stops: storedStops,
    };
  }
}
