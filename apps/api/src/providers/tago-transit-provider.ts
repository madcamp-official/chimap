import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type BusArrival,
  type BusRoute,
  type BusRouteStop,
  type BusStop,
  type Coordinate,
  type NormalizedRoute,
  type RouteLeg,
  type TransitBusLeg,
} from "@chimap/contracts";

import type { AppConfig } from "../config.js";
import { ProviderError } from "../errors.js";
import {
  coordinateCacheKey,
  MemoryCache,
} from "../services/cache.js";
import { TagoApiError } from "../transit/tago-client.js";
import { TransitService } from "../transit/transit-service.js";
import type {
  MobilityProvider,
  PlaceSearchOptions,
  TransitRouteRequest,
  WalkRouteRequest,
} from "./types.js";

type StopRoutes = {
  stop: BusStop;
  routes: BusRoute[];
};

type DirectCandidate = {
  route: BusRoute;
  boardingStop: BusStop;
  alightingStop: BusStop;
  routeStops: BusRouteStop[];
  segment: BusRouteStop[];
};

type TransferCandidate = {
  firstRoute: BusRoute;
  secondRoute: BusRoute;
  boardingStop: BusStop;
  transferOutStop: BusRouteStop;
  transferInStop: BusRouteStop;
  alightingStop: BusStop;
  firstRouteStops: BusRouteStop[];
  secondRouteStops: BusRouteStop[];
  firstSegment: BusRouteStop[];
  secondSegment: BusRouteStop[];
};

function routeKey(route: BusRoute): string {
  return `${route.cityCode}:${route.routeId}`;
}

function stopCoordinate(stop: BusStop | BusRouteStop): Coordinate {
  return { lat: stop.latitude, lng: stop.longitude };
}

function routeStopAsStop(stop: BusRouteStop): BusStop {
  return {
    id: stop.stopId,
    cityCode: stop.cityCode,
    nodeId: stop.nodeId,
    sourceStopNo: null,
    arsId: null,
    name: stop.stopName,
    latitude: stop.latitude,
    longitude: stop.longitude,
    source: "database",
  };
}

function polylineDistance(stops: BusRouteStop[]): number {
  let total = 0;
  for (let index = 0; index < stops.length - 1; index += 1) {
    total += haversineDistanceMeters(
      stopCoordinate(stops[index]!),
      stopCoordinate(stops[index + 1]!),
    );
  }
  return Math.round(total);
}

function bestSegment(
  stops: BusRouteStop[],
  boardingNodeId: string,
  alightingNodeId: string,
): BusRouteStop[] | undefined {
  let best: BusRouteStop[] | undefined;
  for (let start = 0; start < stops.length; start += 1) {
    if (stops[start]?.nodeId !== boardingNodeId) {
      continue;
    }
    for (let end = start + 1; end < stops.length; end += 1) {
      if (stops[end]?.nodeId !== alightingNodeId) {
        continue;
      }
      const segment = stops.slice(start, end + 1);
      if (best === undefined || segment.length < best.length) {
        best = segment;
      }
      break;
    }
  }
  return best;
}

function walkingLegs(
  route: NormalizedRoute | undefined,
  idPrefix: string,
  fallbackGuidance: string,
): RouteLeg[] {
  return (
    route?.legs.map((leg, index) => ({
      ...leg,
      id: `${idPrefix}-${index}`,
      guidance: leg.guidance ?? fallbackGuidance,
      isExerciseSegment: false,
    })) ?? []
  );
}

function sumLegDistance(legs: RouteLeg[]): number {
  return legs.reduce((total, leg) => total + leg.distanceMeters, 0);
}

function estimatedWaitSeconds(route: BusRoute): number {
  const day = new Date().getDay();
  const interval =
    day === 0 || day === 6
      ? (route.weekendIntervalMinutes ??
        route.weekdayIntervalMinutes)
      : (route.weekdayIntervalMinutes ??
        route.weekendIntervalMinutes);
  return interval === null ? 600 : Math.max(30, Math.round(interval * 30));
}

function transferDistance(
  first: BusRouteStop,
  second: BusRouteStop,
): number {
  return haversineDistanceMeters(
    stopCoordinate(first),
    stopCoordinate(second),
  );
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (error instanceof TagoApiError) {
    if (error.resultCode === "CONFIGURATION_ERROR") {
      return new ProviderError({
        kind: "CONFIGURATION",
        message: error.safeMessage,
        retryable: false,
        cause: error,
      });
    }
    if (error.resultCode === "ABORTED") {
      return new ProviderError({
        kind: "ABORTED",
        message: error.safeMessage,
        retryable: false,
        cause: error,
      });
    }
    if (error.resultCode === "TIMEOUT") {
      return new ProviderError({
        kind: "TIMEOUT",
        message: error.safeMessage,
        retryable: true,
        cause: error,
      });
    }
    return new ProviderError({
      kind: "UPSTREAM",
      message: error.safeMessage,
      retryable: error.retryable,
      cause: error,
    });
  }
  return new ProviderError({
    kind: "UPSTREAM",
    message: "TAGO 버스 경로 계산에 실패했습니다.",
    retryable: false,
    cause: error,
  });
}

export class TagoTransitMobilityProvider implements MobilityProvider {
  public readonly source = "TAGO" as const;

  readonly #baseProvider: MobilityProvider;
  readonly #transitService: TransitService;
  readonly #config: AppConfig;
  readonly #walkingCache = new MemoryCache(32 * 1024 * 1024);

  public constructor(options: {
    baseProvider: MobilityProvider;
    transitService: TransitService;
    config: AppConfig;
  }) {
    this.#baseProvider = options.baseProvider;
    this.#transitService = options.transitService;
    this.#config = options.config;
  }

  public searchPlaces(
    query: string,
    options?: PlaceSearchOptions,
  ) {
    return this.#baseProvider.searchPlaces(query, options);
  }

  public getWalkingRoute(request: WalkRouteRequest) {
    return this.#baseProvider.getWalkingRoute(request);
  }

  public async getTransitRoutes(
    request: TransitRouteRequest,
  ): Promise<NormalizedRoute[]> {
    try {
      const [origin, destination] = await Promise.all([
        this.#transitService.getNearbyStops(
          request.origin.location,
          this.#config.transit.maxNearbyStopDistanceMeters,
          request.signal,
        ),
        this.#transitService.getNearbyStops(
          request.destination.location,
          this.#config.transit.maxNearbyStopDistanceMeters,
          request.signal,
        ),
      ]);
      const originStops = origin.items
        .filter(
          (stop) => stop.cityCode !== null && stop.nodeId !== null,
        )
        .slice(0, 8);
      const destinationStops = destination.items
        .filter(
          (stop) => stop.cityCode !== null && stop.nodeId !== null,
        )
        .slice(0, 8);
      if (originStops.length === 0 || destinationStops.length === 0) {
        throw new ProviderError({
          kind: "NO_ROUTE",
          message:
            "출발지 또는 목적지 주변에서 TAGO 정류장을 찾지 못했습니다.",
        });
      }

      const [originStopRoutes, destinationStopRoutes] = await Promise.all([
        this.#loadStopRoutes(originStops, request.signal),
        this.#loadStopRoutes(destinationStops, request.signal),
      ]);
      const directCandidates = await this.#findDirectCandidates(
        originStopRoutes,
        destinationStopRoutes,
        request.signal,
      );
      const directSettled = await Promise.allSettled(
        directCandidates.slice(0, 3).map((candidate, index) =>
          this.#buildDirectRoute(request, candidate, index),
        ),
      );
      const directRoutes = directSettled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const transferRoutes =
        this.#config.transit.maxTransferCount === 0 ||
        directRoutes.length >= 2
          ? []
          : await this.#findAndBuildTransferRoutes(
              request,
              originStopRoutes,
              destinationStopRoutes,
            );
      const routes = [...directRoutes, ...transferRoutes]
        .sort(
          (first, second) =>
            first.durationSeconds - second.durationSeconds,
        )
        .slice(0, 8);
      if (routes.length === 0) {
        throw new ProviderError({
          kind: "NO_ROUTE",
          message:
            "정류장 순서와 진행 방향이 맞는 버스 경로를 찾지 못했습니다.",
        });
      }
      if (!origin.partial && !destination.partial) {
        return routes;
      }
      return routes.map((route) =>
        normalizedRouteSchema.parse({
          ...route,
          isPartial: true,
          estimationNotes: [
            ...(route.estimationNotes ?? []),
            "TAGO 주변 정류장 갱신에 실패해 import된 실제 정류장 데이터 일부를 사용했습니다.",
          ],
        }),
      );
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async #loadStopRoutes(
    stops: BusStop[],
    signal?: AbortSignal,
  ): Promise<StopRoutes[]> {
    const settled = await Promise.allSettled(
      stops.map(async (stop): Promise<StopRoutes> => {
        const result = await this.#transitService.getRoutesByStop(
          stop.cityCode!,
          stop.nodeId!,
          signal,
        );
        return { stop, routes: result.items };
      }),
    );
    const successful = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (successful.length === 0) {
      const rejection = settled.find(
        (result) => result.status === "rejected",
      );
      if (rejection?.status === "rejected") {
        throw rejection.reason;
      }
    }
    return successful;
  }

  async #findDirectCandidates(
    originStopRoutes: StopRoutes[],
    destinationStopRoutes: StopRoutes[],
    signal?: AbortSignal,
  ): Promise<DirectCandidate[]> {
    const origins = new Map<
      string,
      { route: BusRoute; stops: BusStop[] }
    >();
    for (const entry of originStopRoutes) {
      for (const route of entry.routes) {
        const key = routeKey(route);
        const existing = origins.get(key);
        if (existing === undefined) {
          origins.set(key, { route, stops: [entry.stop] });
        } else {
          existing.stops.push(entry.stop);
        }
      }
    }
    const destinations = new Map<string, BusStop[]>();
    for (const entry of destinationStopRoutes) {
      for (const route of entry.routes) {
        const key = routeKey(route);
        const stops = destinations.get(key) ?? [];
        stops.push(entry.stop);
        destinations.set(key, stops);
      }
    }

    const common = [...origins.entries()]
      .filter(([key]) => destinations.has(key))
      .sort((first, second) => {
        const firstWalk = Math.min(
          ...first[1].stops.map((stop) => stop.distanceMeters ?? Infinity),
        );
        const secondWalk = Math.min(
          ...second[1].stops.map((stop) => stop.distanceMeters ?? Infinity),
        );
        return firstWalk - secondWalk;
      })
      .slice(0, 12);
    const settled = await Promise.allSettled(
      common.map(async ([key, origin]) => {
        const [routeStops, detailedRoute] = await Promise.all([
          this.#transitService.getRouteStops(
            origin.route.cityCode,
            origin.route.routeId,
            signal,
          ),
          this.#transitService.getRoute(
            origin.route.cityCode,
            origin.route.routeId,
            signal,
          ),
        ]);
        let best: DirectCandidate | undefined;
        for (const boardingStop of origin.stops) {
          for (const alightingStop of destinations.get(key) ?? []) {
            const segment = bestSegment(
              routeStops,
              boardingStop.nodeId!,
              alightingStop.nodeId!,
            );
            if (segment === undefined) {
              continue;
            }
            const candidate: DirectCandidate = {
              route: detailedRoute,
              boardingStop,
              alightingStop,
              routeStops,
              segment,
            };
            if (
              best === undefined ||
              segment.length +
                (boardingStop.distanceMeters ?? 0) / 100 +
                (alightingStop.distanceMeters ?? 0) / 100 <
                best.segment.length +
                  (best.boardingStop.distanceMeters ?? 0) / 100 +
                  (best.alightingStop.distanceMeters ?? 0) / 100
            ) {
              best = candidate;
            }
          }
        }
        return best;
      }),
    );
    return settled.flatMap((result) =>
      result.status === "fulfilled" && result.value !== undefined
        ? [result.value]
        : [],
    );
  }

  async #arrivalForLeg(
    route: BusRoute,
    boardingNodeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival | undefined> {
    const realtimeTimeout = AbortSignal.timeout(2_500);
    const requestSignal =
      signal === undefined
        ? realtimeTimeout
        : AbortSignal.any([signal, realtimeTimeout]);
    try {
      const arrivals = await this.#transitService.getArrivals(
        route.cityCode,
        boardingNodeId,
        requestSignal,
      );
      return arrivals
        .filter((arrival) => arrival.routeId === route.routeId)
        .sort(
          (first, second) =>
            first.arrivalSeconds - second.arrivalSeconds,
        )[0];
    } catch (error) {
      if (
        error instanceof TagoApiError &&
        error.resultCode !== "CONFIGURATION_ERROR"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async #arrivalForRoute(
    route: BusRoute,
    boardingNodeId: string,
    signal?: AbortSignal,
  ): Promise<BusArrival | undefined> {
    const realtimeTimeout = AbortSignal.timeout(2_500);
    const requestSignal =
      signal === undefined
        ? realtimeTimeout
        : AbortSignal.any([signal, realtimeTimeout]);
    try {
      return (
        await this.#transitService.getArrivalsForRoute(
          route.cityCode,
          boardingNodeId,
          route.routeId,
          requestSignal,
        )
      ).sort(
        (first, second) =>
          first.arrivalSeconds - second.arrivalSeconds,
      )[0];
    } catch (error) {
      if (
        error instanceof TagoApiError &&
        error.resultCode !== "CONFIGURATION_ERROR"
      ) {
        return undefined;
      }
      throw error;
    }
  }

  async #walkingRoute(
    from: Coordinate,
    to: Coordinate,
    signal?: AbortSignal,
  ): Promise<NormalizedRoute | undefined> {
    if (haversineDistanceMeters(from, to) <= 3) {
      return undefined;
    }
    const key = `tago:walk:${coordinateCacheKey(from)}:${coordinateCacheKey(to)}`;
    return this.#walkingCache.getOrLoad(
      key,
      30 * 60 * 1000,
      () =>
        this.#baseProvider.getWalkingRoute({
          origin: from,
          destination: to,
          routeMode: "BROAD_FIRST",
          ...(signal === undefined ? {} : { signal }),
        }),
    );
  }

  #busLeg(input: {
    id: string;
    route: BusRoute;
    segment: BusRouteStop[];
    arrival?: BusArrival;
  }): { routeLeg: RouteLeg; busLeg: TransitBusLeg; rideDistance: number } {
    const boarding = input.segment[0]!;
    const alighting = input.segment[input.segment.length - 1]!;
    const rideDistance = polylineDistance(input.segment);
    const rideSeconds = Math.max(
      60,
      Math.round(
        rideDistance /
          ((this.#config.transit.busAverageSpeedKmh * 1000) / 3600) +
          Math.max(0, input.segment.length - 2) *
            this.#config.transit.stopDwellSeconds,
      ),
    );
    const waitSeconds =
      input.arrival?.arrivalSeconds ??
      estimatedWaitSeconds(input.route);
    const busLeg: TransitBusLeg = {
      routeId: input.route.routeId,
      cityCode: input.route.cityCode,
      routeNo: input.route.routeNo,
      routeType: input.route.routeType,
      boardingStop: routeStopAsStop(boarding),
      alightingStop: routeStopAsStop(alighting),
      stopCount: input.segment.length - 1,
      boardingNodeOrder: boarding.nodeOrder,
      alightingNodeOrder: alighting.nodeOrder,
      expectedArrivalSeconds: waitSeconds,
      expectedRideSeconds: rideSeconds,
      vehicleNo: null,
      vehicleType: input.arrival?.vehicleType ?? null,
      isArrivalRealtime: input.arrival !== undefined,
      polyline: input.segment.map(stopCoordinate),
      stops: input.segment,
    };
    return {
      busLeg,
      rideDistance,
      routeLeg: {
        id: input.id,
        mode: "BUS",
        name: input.route.routeNo,
        guidance: `${boarding.stopName}에서 ${input.route.routeNo}번 버스를 타고 ${alighting.stopName}까지 이동`,
        distanceMeters: rideDistance,
        durationSeconds: waitSeconds + rideSeconds,
        stops: input.segment.map((stop) => stop.stopName),
        coordinates: busLeg.polyline,
        isExerciseSegment: false,
        bus: busLeg,
      },
    };
  }

  async #buildDirectRoute(
    request: TransitRouteRequest,
    candidate: DirectCandidate,
    index: number,
  ): Promise<NormalizedRoute> {
    const [arrival, startWalkingRoute, endWalkingRoute] = await Promise.all([
      this.#arrivalForLeg(
        candidate.route,
        candidate.boardingStop.nodeId!,
        request.signal,
      ),
      this.#walkingRoute(
        request.origin.location,
        stopCoordinate(candidate.boardingStop),
        request.signal,
      ),
      this.#walkingRoute(
        stopCoordinate(candidate.alightingStop),
        request.destination.location,
        request.signal,
      ),
    ]);
    const startWalk = walkingLegs(
      startWalkingRoute,
      `tago-direct-${index}-walk-start`,
      `${candidate.boardingStop.name} 정류장까지 도보 이동`,
    );
    const bus = this.#busLeg({
      id: `tago-direct-${index}-bus`,
      route: candidate.route,
      segment: candidate.segment,
      ...(arrival === undefined ? {} : { arrival }),
    });
    const endWalk = walkingLegs(
      endWalkingRoute,
      `tago-direct-${index}-walk-end`,
      `${candidate.alightingStop.name} 정류장에서 목적지까지 도보 이동`,
    );
    const legs = [...startWalk, bus.routeLeg, ...endWalk];
    const walkingDistanceMeters =
      sumLegDistance(startWalk) + sumLegDistance(endWalk);
    const waitingDurationSeconds = bus.busLeg.expectedArrivalSeconds;
    const ridingDurationSeconds = bus.busLeg.expectedRideSeconds;
    return normalizedRouteSchema.parse({
      id: `tago-direct-${candidate.route.cityCode}-${candidate.route.routeId}-${candidate.boardingStop.nodeId}-${candidate.alightingStop.nodeId}`,
      source: "TAGO",
      durationSeconds: legs.reduce(
        (total, leg) => total + leg.durationSeconds,
        0,
      ),
      distanceMeters: walkingDistanceMeters + bus.rideDistance,
      walkDistanceMeters: walkingDistanceMeters,
      transitDistanceMeters: bus.rideDistance,
      transferCount: 0,
      waitingDurationSeconds,
      ridingDurationSeconds,
      isRealtime: bus.busLeg.isArrivalRealtime,
      estimationNotes: [
        ...(bus.busLeg.isArrivalRealtime
          ? []
          : ["실시간 도착정보가 없어 배차간격 기반 대기시간을 사용했습니다."]),
        "버스 승차시간은 경유 정류장 좌표, 평균 속도, 정차시간으로 추정했습니다.",
        "노선선은 실제 도로 shape가 아니라 정류장 좌표를 순서대로 연결한 것입니다.",
      ],
      legs,
    });
  }

  async #findAndBuildTransferRoutes(
    request: TransitRouteRequest,
    originStopRoutes: StopRoutes[],
    destinationStopRoutes: StopRoutes[],
  ): Promise<NormalizedRoute[]> {
    const originRoutes = new Map<
      string,
      { route: BusRoute; stops: BusStop[] }
    >();
    const destinationRoutes = new Map<
      string,
      { route: BusRoute; stops: BusStop[] }
    >();
    for (const entry of originStopRoutes) {
      for (const route of entry.routes) {
        const key = routeKey(route);
        const value = originRoutes.get(key) ?? { route, stops: [] };
        value.stops.push(entry.stop);
        originRoutes.set(key, value);
      }
    }
    for (const entry of destinationStopRoutes) {
      for (const route of entry.routes) {
        const key = routeKey(route);
        const value = destinationRoutes.get(key) ?? { route, stops: [] };
        value.stops.push(entry.stop);
        destinationRoutes.set(key, value);
      }
    }
    const originEntries = [...originRoutes.values()].slice(0, 6);
    const destinationEntries = [...destinationRoutes.values()].slice(0, 6);
    const allRoutes = new Map<string, BusRoute>();
    [...originEntries, ...destinationEntries].forEach(({ route }) =>
      allRoutes.set(routeKey(route), route),
    );
    const stopLists = new Map<string, BusRouteStop[]>();
    const loaded = await Promise.allSettled(
      [...allRoutes.entries()].map(async ([key, route]) => {
        const [stops, detailedRoute] = await Promise.all([
          this.#transitService.getRouteStops(
            route.cityCode,
            route.routeId,
            request.signal,
          ),
          this.#transitService.getRoute(
            route.cityCode,
            route.routeId,
            request.signal,
          ),
        ]);
        return { key, stops, detailedRoute };
      }),
    );
    loaded.forEach((result) => {
      if (result.status === "fulfilled") {
        stopLists.set(result.value.key, result.value.stops);
        allRoutes.set(result.value.key, result.value.detailedRoute);
      }
    });

    const candidates: TransferCandidate[] = [];
    firstRouteLoop: for (const first of originEntries) {
      const firstStops = stopLists.get(routeKey(first.route));
      if (firstStops === undefined) {
        continue;
      }
      for (const second of destinationEntries) {
        if (
          routeKey(first.route) === routeKey(second.route) ||
          first.route.cityCode !== second.route.cityCode
        ) {
          continue;
        }
        const secondStops = stopLists.get(routeKey(second.route));
        if (secondStops === undefined) {
          continue;
        }
        for (const boardingStop of first.stops) {
          const boardingIndexes = firstStops.flatMap((stop, index) =>
            stop.nodeId === boardingStop.nodeId ? [index] : [],
          );
          for (const alightingStop of second.stops) {
            const alightingIndexes = secondStops.flatMap((stop, index) =>
              stop.nodeId === alightingStop.nodeId ? [index] : [],
            );
            for (const boardingIndex of boardingIndexes) {
              for (const alightingIndex of alightingIndexes) {
                for (
                  let firstTransferIndex = boardingIndex + 1;
                  firstTransferIndex <
                  Math.min(firstStops.length, boardingIndex + 81);
                  firstTransferIndex += 1
                ) {
                  const transferOutStop =
                    firstStops[firstTransferIndex]!;
                  for (
                    let secondTransferIndex = Math.max(
                      0,
                      alightingIndex - 80,
                    );
                    secondTransferIndex < alightingIndex;
                    secondTransferIndex += 1
                  ) {
                    const transferInStop =
                      secondStops[secondTransferIndex]!;
                    if (
                      transferOutStop.nodeId !== transferInStop.nodeId &&
                      transferDistance(
                        transferOutStop,
                        transferInStop,
                      ) > 100
                    ) {
                      continue;
                    }
                    candidates.push({
                      firstRoute:
                        allRoutes.get(routeKey(first.route)) ??
                        first.route,
                      secondRoute:
                        allRoutes.get(routeKey(second.route)) ??
                        second.route,
                      boardingStop,
                      transferOutStop,
                      transferInStop,
                      alightingStop,
                      firstRouteStops: firstStops,
                      secondRouteStops: secondStops,
                      firstSegment: firstStops.slice(
                        boardingIndex,
                        firstTransferIndex + 1,
                      ),
                      secondSegment: secondStops.slice(
                        secondTransferIndex,
                        alightingIndex + 1,
                      ),
                    });
                    if (candidates.length >= 100) {
                      break firstRouteLoop;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    const ranked = candidates
      .sort(
        (first, second) =>
          first.firstSegment.length +
            first.secondSegment.length +
            transferDistance(
              first.transferOutStop,
              first.transferInStop,
            ) /
              10 -
          (second.firstSegment.length +
            second.secondSegment.length +
            transferDistance(
              second.transferOutStop,
              second.transferInStop,
            ) /
              10),
      )
      .filter(
        (candidate, index, array) =>
          array.findIndex(
            (other) =>
              routeKey(other.firstRoute) ===
                routeKey(candidate.firstRoute) &&
              routeKey(other.secondRoute) ===
                routeKey(candidate.secondRoute),
          ) === index,
      )
      .slice(0, 3);
    const settled = await Promise.allSettled(
      ranked.map((candidate, index) =>
        this.#buildTransferRoute(request, candidate, index),
      ),
    );
    return settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  async #buildTransferRoute(
    request: TransitRouteRequest,
    candidate: TransferCandidate,
    index: number,
  ): Promise<NormalizedRoute> {
    const [
      firstArrival,
      secondArrival,
      startWalkingRoute,
      transferWalkingRoute,
      endWalkingRoute,
    ] = await Promise.all([
      this.#arrivalForLeg(
        candidate.firstRoute,
        candidate.boardingStop.nodeId!,
        request.signal,
      ),
      this.#arrivalForRoute(
        candidate.secondRoute,
        candidate.transferInStop.nodeId,
        request.signal,
      ),
      this.#walkingRoute(
        request.origin.location,
        stopCoordinate(candidate.boardingStop),
        request.signal,
      ),
      this.#walkingRoute(
        stopCoordinate(candidate.transferOutStop),
        stopCoordinate(candidate.transferInStop),
        request.signal,
      ),
      this.#walkingRoute(
        stopCoordinate(candidate.alightingStop),
        request.destination.location,
        request.signal,
      ),
    ]);
    const startWalk = walkingLegs(
      startWalkingRoute,
      `tago-transfer-${index}-walk-start`,
      `${candidate.boardingStop.name} 정류장까지 도보 이동`,
    );
    const firstBus = this.#busLeg({
      id: `tago-transfer-${index}-bus-1`,
      route: candidate.firstRoute,
      segment: candidate.firstSegment,
      ...(firstArrival === undefined ? {} : { arrival: firstArrival }),
    });
    const transferWalk = walkingLegs(
      transferWalkingRoute,
      `tago-transfer-${index}-walk-transfer`,
      `${candidate.transferInStop.stopName} 정류장으로 환승`,
    );
    const secondBus = this.#busLeg({
      id: `tago-transfer-${index}-bus-2`,
      route: candidate.secondRoute,
      segment: candidate.secondSegment,
      ...(secondArrival === undefined ? {} : { arrival: secondArrival }),
    });
    const endWalk = walkingLegs(
      endWalkingRoute,
      `tago-transfer-${index}-walk-end`,
      `${candidate.alightingStop.name} 정류장에서 목적지까지 도보 이동`,
    );
    const legs = [
      ...startWalk,
      firstBus.routeLeg,
      ...transferWalk,
      secondBus.routeLeg,
      ...endWalk,
    ];
    const walkingDistanceMeters =
      sumLegDistance(startWalk) +
      sumLegDistance(transferWalk) +
      sumLegDistance(endWalk);
    const waitingDurationSeconds =
      firstBus.busLeg.expectedArrivalSeconds +
      secondBus.busLeg.expectedArrivalSeconds;
    const ridingDurationSeconds =
      firstBus.busLeg.expectedRideSeconds +
      secondBus.busLeg.expectedRideSeconds;
    const realtime =
      firstBus.busLeg.isArrivalRealtime &&
      secondBus.busLeg.isArrivalRealtime;
    return normalizedRouteSchema.parse({
      id: `tago-transfer-${candidate.firstRoute.routeId}-${candidate.secondRoute.routeId}-${candidate.boardingStop.nodeId}-${candidate.alightingStop.nodeId}`,
      source: "TAGO",
      durationSeconds: legs.reduce(
        (total, leg) => total + leg.durationSeconds,
        0,
      ),
      distanceMeters:
        walkingDistanceMeters +
        firstBus.rideDistance +
        secondBus.rideDistance,
      walkDistanceMeters: walkingDistanceMeters,
      transitDistanceMeters:
        firstBus.rideDistance + secondBus.rideDistance,
      transferCount: 1,
      waitingDurationSeconds,
      ridingDurationSeconds,
      isRealtime: realtime,
      estimationNotes: [
        ...(realtime
          ? []
          : ["일부 도착정보가 없어 배차간격 기반 대기시간을 사용했습니다."]),
        "버스 승차시간은 경유 정류장 좌표, 평균 속도, 정차시간으로 추정했습니다.",
        "환승은 1회까지만 탐색했습니다.",
        "노선선은 실제 도로 shape가 아니라 정류장 좌표를 순서대로 연결한 것입니다.",
      ],
      legs,
    });
  }
}
