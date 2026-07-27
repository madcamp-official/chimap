import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type BusRouteStop,
  type Coordinate,
  type NormalizedRoute,
  type RecommendationRequest,
  type RouteLeg,
  type TransitBusLeg,
  type WalkingRole,
} from "@chimap/contracts";
import pLimit, { type LimitFunction } from "p-limit";

import { ProviderError } from "../errors.js";
import type { MobilityProvider } from "../providers/types.js";
import {
  calculateRemainingSteps,
  calculateTargetWalkDistanceMeters,
} from "./calculations.js";

export type CandidateKind =
  | "BASE"
  | "EARLY_ALIGHT"
  | "LATE_BOARD"
  | "BOTH_ENDS";

export type RouteCandidate = {
  route: NormalizedRoute;
  kind: CandidateKind;
};

export type CandidateGenerationResult = {
  baseline: NormalizedRoute;
  candidates: RouteCandidate[];
  candidateFailureCount: number;
  routeApiCallCount: number;
};

type AdjustmentSpec = {
  route: NormalizedRoute;
  kind: Exclude<CandidateKind, "BASE">;
  firstBusIndex: number;
  lastBusIndex: number;
  boardingIndex?: number;
  alightingIndex?: number;
  estimatedWalkDistanceMeters: number;
  fit: number;
};

class RouteCallBudget {
  readonly #provider: MobilityProvider;
  readonly #limit: LimitFunction;
  #transitCalls = 0;
  #walkCalls = 0;

  public constructor(provider: MobilityProvider, concurrency = 3) {
    this.#provider = provider;
    this.#limit = pLimit(concurrency);
  }

  public get totalCalls(): number {
    return this.#transitCalls + this.#walkCalls;
  }

  public transit(
    origin: RecommendationRequest["origin"],
    destination: RecommendationRequest["destination"],
    signal?: AbortSignal,
  ): Promise<NormalizedRoute[]> {
    if (this.#transitCalls >= 1) {
      return Promise.reject(
        new ProviderError({
          kind: "UPSTREAM",
          message: "대중교통 경로 호출 예산을 초과했습니다.",
        }),
      );
    }
    this.#transitCalls += 1;
    return this.#limit(() =>
      this.#provider.getTransitRoutes({
        origin,
        destination,
        ...(signal === undefined ? {} : { signal }),
      }),
    );
  }

  public walk(
    origin: Coordinate,
    destination: Coordinate,
    signal?: AbortSignal,
  ): Promise<NormalizedRoute> {
    if (this.#walkCalls >= 8) {
      return Promise.reject(
        new ProviderError({
          kind: "UPSTREAM",
          message: "도보 경로 호출 예산을 초과했습니다.",
        }),
      );
    }
    this.#walkCalls += 1;
    return this.#limit(() =>
      this.#provider.getWalkingRoute({
        origin,
        destination,
        routeMode: "BROAD_FIRST",
        ...(signal === undefined ? {} : { signal }),
      }),
    );
  }
}

function stopCoordinate(stop: BusRouteStop): Coordinate {
  return { lat: stop.latitude, lng: stop.longitude };
}

function routeStopAsBusStop(stop: BusRouteStop) {
  return {
    id: stop.stopId,
    cityCode: stop.cityCode,
    nodeId: stop.nodeId,
    sourceStopNo: null,
    arsId: null,
    name: stop.stopName,
    latitude: stop.latitude,
    longitude: stop.longitude,
    source: "database" as const,
  };
}

function polylineDistanceMeters(coordinates: readonly Coordinate[]): number {
  let distance = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    distance += haversineDistanceMeters(
      coordinates[index]!,
      coordinates[index + 1]!,
    );
  }
  return Math.round(distance);
}

function closestCoordinateIndex(
  coordinates: readonly Coordinate[],
  target: Coordinate,
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  coordinates.forEach((coordinate, index) => {
    const distance = haversineDistanceMeters(coordinate, target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function sliceBusPolyline(
  coordinates: readonly Coordinate[],
  firstStop: BusRouteStop,
  lastStop: BusRouteStop,
): Coordinate[] {
  const fallback = [stopCoordinate(firstStop), stopCoordinate(lastStop)];
  if (coordinates.length < 2) {
    return fallback;
  }
  const startIndex = closestCoordinateIndex(
    coordinates,
    stopCoordinate(firstStop),
  );
  const endIndex = closestCoordinateIndex(
    coordinates,
    stopCoordinate(lastStop),
  );
  if (endIndex <= startIndex) {
    return fallback;
  }
  const result = coordinates.slice(startIndex, endIndex + 1);
  return result.length >= 2 ? result : fallback;
}

function busLegIndexes(route: NormalizedRoute): {
  first: number;
  last: number;
} | null {
  const indexes = route.legs.flatMap((leg, index) =>
    leg.mode === "BUS" && leg.bus !== undefined ? [index] : [],
  );
  const first = indexes[0];
  const last = indexes.at(-1);
  return first === undefined || last === undefined
    ? null
    : { first, last };
}

function walkingDistance(
  legs: readonly RouteLeg[],
  from: number,
  to: number,
): number {
  return legs
    .slice(from, to)
    .filter((leg) => leg.mode === "WALK")
    .reduce((total, leg) => total + leg.distanceMeters, 0);
}

function adjustmentFit(
  estimatedWalkDistanceMeters: number,
  targetWalkDistanceMeters: number,
): number {
  return (
    Math.abs(estimatedWalkDistanceMeters - targetWalkDistanceMeters) /
    Math.max(targetWalkDistanceMeters, 300)
  );
}

function enumerateAdjustments(
  routes: readonly NormalizedRoute[],
  request: RecommendationRequest,
  targetWalkDistanceMeters: number,
): {
  early: AdjustmentSpec[];
  late: AdjustmentSpec[];
  combined: AdjustmentSpec[];
} {
  const early: AdjustmentSpec[] = [];
  const late: AdjustmentSpec[] = [];
  const combined: AdjustmentSpec[] = [];

  for (const route of routes) {
    const indexes = busLegIndexes(route);
    if (indexes === null) {
      continue;
    }
    const firstBus = route.legs[indexes.first]?.bus;
    const lastBus = route.legs[indexes.last]?.bus;
    if (firstBus === undefined || lastBus === undefined) {
      continue;
    }
    const walkBeforeFirst = walkingDistance(route.legs, 0, indexes.first);
    const walkAfterLast = walkingDistance(
      route.legs,
      indexes.last + 1,
      route.legs.length,
    );
    const fixedMiddleWalk =
      route.walkDistanceMeters - walkBeforeFirst - walkAfterLast;

    for (
      let alightingIndex = 1;
      alightingIndex < lastBus.stops.length - 1;
      alightingIndex += 1
    ) {
      const stop = lastBus.stops[alightingIndex]!;
      const estimatedWalkDistanceMeters =
        walkBeforeFirst +
        fixedMiddleWalk +
        haversineDistanceMeters(
          stopCoordinate(stop),
          request.destination.location,
        ) *
          1.25;
      early.push({
        route,
        kind: "EARLY_ALIGHT",
        firstBusIndex: indexes.first,
        lastBusIndex: indexes.last,
        alightingIndex,
        estimatedWalkDistanceMeters,
        fit: adjustmentFit(
          estimatedWalkDistanceMeters,
          targetWalkDistanceMeters,
        ),
      });
    }

    for (
      let boardingIndex = 1;
      boardingIndex < firstBus.stops.length - 1;
      boardingIndex += 1
    ) {
      const stop = firstBus.stops[boardingIndex]!;
      const estimatedWalkDistanceMeters =
        fixedMiddleWalk +
        walkAfterLast +
        haversineDistanceMeters(
          request.origin.location,
          stopCoordinate(stop),
        ) *
          1.25;
      late.push({
        route,
        kind: "LATE_BOARD",
        firstBusIndex: indexes.first,
        lastBusIndex: indexes.last,
        boardingIndex,
        estimatedWalkDistanceMeters,
        fit: adjustmentFit(
          estimatedWalkDistanceMeters,
          targetWalkDistanceMeters,
        ),
      });
    }

    for (
      let boardingIndex = 1;
      boardingIndex < firstBus.stops.length - 1;
      boardingIndex += 1
    ) {
      for (
        let alightingIndex = 1;
        alightingIndex < lastBus.stops.length - 1;
        alightingIndex += 1
      ) {
        if (
          indexes.first === indexes.last &&
          boardingIndex >= alightingIndex
        ) {
          continue;
        }
        const boardingStop = firstBus.stops[boardingIndex]!;
        const alightingStop = lastBus.stops[alightingIndex]!;
        const estimatedWalkDistanceMeters =
          fixedMiddleWalk +
          haversineDistanceMeters(
            request.origin.location,
            stopCoordinate(boardingStop),
          ) *
            1.25 +
          haversineDistanceMeters(
            stopCoordinate(alightingStop),
            request.destination.location,
          ) *
            1.25;
        combined.push({
          route,
          kind: "BOTH_ENDS",
          firstBusIndex: indexes.first,
          lastBusIndex: indexes.last,
          boardingIndex,
          alightingIndex,
          estimatedWalkDistanceMeters,
          fit: adjustmentFit(
            estimatedWalkDistanceMeters,
            targetWalkDistanceMeters,
          ),
        });
      }
    }
  }

  const rank = (first: AdjustmentSpec, second: AdjustmentSpec) =>
    first.fit - second.fit ||
    first.route.durationSeconds - second.route.durationSeconds;
  return {
    early: early.sort(rank),
    late: late.sort(rank),
    combined: combined.sort(rank),
  };
}

function walkingLegs(
  route: NormalizedRoute,
  idPrefix: string,
  role: WalkingRole,
  guidance: string,
): RouteLeg[] {
  return route.legs.map((leg, index) => ({
    ...leg,
    id: `${idPrefix}-${index}`,
    guidance: leg.guidance ?? guidance,
    isExerciseSegment: true,
    walkingRole: role,
  }));
}

function adjustedBusLeg(
  leg: RouteLeg,
  startIndex: number,
  endIndex: number,
  lateBoarding: boolean,
): RouteLeg {
  const bus = leg.bus;
  if (bus === undefined) {
    throw new TypeError("버스 정보가 없는 구간은 조정할 수 없습니다.");
  }
  const stops = bus.stops.slice(startIndex, endIndex + 1);
  const boarding = stops[0];
  const alighting = stops.at(-1);
  if (boarding === undefined || alighting === undefined || stops.length < 2) {
    throw new RangeError("조정한 버스 구간에는 두 개 이상의 정류장이 필요합니다.");
  }
  const polyline = sliceBusPolyline(
    leg.coordinates.length >= 2 ? leg.coordinates : bus.polyline,
    boarding,
    alighting,
  );
  const distanceMeters = Math.max(1, polylineDistanceMeters(polyline));
  const distanceRatio =
    leg.distanceMeters <= 0
      ? stops.length / bus.stops.length
      : distanceMeters / leg.distanceMeters;
  const expectedRideSeconds = Math.max(
    60,
    Math.round(bus.expectedRideSeconds * Math.min(distanceRatio, 1)),
  );
  const adjustedBus: TransitBusLeg = {
    ...bus,
    boardingStop: routeStopAsBusStop(boarding),
    alightingStop: routeStopAsBusStop(alighting),
    stopCount: stops.length - 1,
    boardingNodeOrder: boarding.nodeOrder,
    alightingNodeOrder: alighting.nodeOrder,
    expectedRideSeconds,
    vehicleNo: lateBoarding ? null : bus.vehicleNo,
    isArrivalRealtime: lateBoarding ? false : bus.isArrivalRealtime,
    polyline,
    stops,
  };
  return {
    ...leg,
    guidance: `${boarding.stopName}에서 ${bus.routeNo}번 버스를 타고 ${alighting.stopName}까지 이동`,
    distanceMeters,
    durationSeconds:
      adjustedBus.expectedArrivalSeconds + adjustedBus.expectedRideSeconds,
    stops: stops.map((stop) => stop.stopName),
    coordinates: polyline,
    bus: adjustedBus,
  };
}

export function rebuildRoute(
  base: NormalizedRoute,
  legs: RouteLeg[],
  id: string,
  kind: Exclude<CandidateKind, "BASE">,
): NormalizedRoute {
  const walkDistanceMeters = legs
    .filter((leg) => leg.mode === "WALK")
    .reduce((total, leg) => total + leg.distanceMeters, 0);
  const transitDistanceMeters = legs
    .filter((leg) => leg.mode !== "WALK")
    .reduce((total, leg) => total + leg.distanceMeters, 0);
  const busLegs = legs.flatMap((leg) =>
    leg.bus === undefined ? [] : [leg.bus],
  );
  const baseBusLegs = base.legs.flatMap((leg) =>
    leg.bus === undefined ? [] : [leg.bus],
  );
  const nonBusWaitingDurationSeconds = Math.max(
    0,
    (base.waitingDurationSeconds ?? 0) -
      baseBusLegs.reduce(
        (total, bus) => total + bus.expectedArrivalSeconds,
        0,
      ),
  );
  const nonBusRidingDurationSeconds = Math.max(
    0,
    (base.ridingDurationSeconds ?? 0) -
      baseBusLegs.reduce(
        (total, bus) => total + bus.expectedRideSeconds,
        0,
      ),
  );
  return normalizedRouteSchema.parse({
    ...base,
    id,
    durationSeconds: legs.reduce(
      (total, leg) => total + leg.durationSeconds,
      0,
    ),
    distanceMeters: walkDistanceMeters + transitDistanceMeters,
    walkDistanceMeters,
    transitDistanceMeters,
    waitingDurationSeconds:
      nonBusWaitingDurationSeconds +
      busLegs.reduce(
        (total, bus) => total + bus.expectedArrivalSeconds,
        0,
      ),
    ridingDurationSeconds:
      nonBusRidingDurationSeconds +
      busLegs.reduce(
        (total, bus) => total + bus.expectedRideSeconds,
        0,
      ),
    isRealtime:
      base.isRealtime === false
        ? false
        : busLegs.every((bus) => bus.isArrivalRealtime),
    estimationNotes: [
      ...(base.estimationNotes ?? []),
      ...(kind === "LATE_BOARD" || kind === "BOTH_ENDS"
        ? [
            "늦은 탑승 정류장의 실시간 도착정보는 다시 조회하지 않아 기존 노선 대기시간을 예상값으로 사용했습니다.",
          ]
        : []),
    ],
    legs,
  });
}

async function buildAdjustedCandidate(
  spec: AdjustmentSpec,
  request: RecommendationRequest,
  budget: RouteCallBudget,
  signal?: AbortSignal,
): Promise<RouteCandidate> {
  const firstBusLeg = spec.route.legs[spec.firstBusIndex];
  const lastBusLeg = spec.route.legs[spec.lastBusIndex];
  if (firstBusLeg?.bus === undefined || lastBusLeg?.bus === undefined) {
    throw new TypeError("조정 대상 버스 구간을 찾지 못했습니다.");
  }
  const boardingStop =
    spec.boardingIndex === undefined
      ? undefined
      : firstBusLeg.bus.stops[spec.boardingIndex];
  const alightingStop =
    spec.alightingIndex === undefined
      ? undefined
      : lastBusLeg.bus.stops[spec.alightingIndex];
  if (
    (spec.boardingIndex !== undefined && boardingStop === undefined) ||
    (spec.alightingIndex !== undefined && alightingStop === undefined)
  ) {
    throw new RangeError("조정 대상 정류장 인덱스가 유효하지 않습니다.");
  }

  const [startWalkingRoute, endWalkingRoute] = await Promise.all([
    boardingStop === undefined
      ? Promise.resolve(undefined)
      : budget.walk(
          request.origin.location,
          stopCoordinate(boardingStop),
          signal,
        ),
    alightingStop === undefined
      ? Promise.resolve(undefined)
      : budget.walk(
          stopCoordinate(alightingStop),
          request.destination.location,
          signal,
        ),
  ]);

  let legs = [...spec.route.legs];
  const sameBus = spec.firstBusIndex === spec.lastBusIndex;
  if (sameBus) {
    const startIndex = spec.boardingIndex ?? 0;
    const endIndex =
      spec.alightingIndex ?? firstBusLeg.bus.stops.length - 1;
    legs[spec.firstBusIndex] = adjustedBusLeg(
      firstBusLeg,
      startIndex,
      endIndex,
      spec.boardingIndex !== undefined,
    );
  } else {
    if (spec.boardingIndex !== undefined) {
      legs[spec.firstBusIndex] = adjustedBusLeg(
        firstBusLeg,
        spec.boardingIndex,
        firstBusLeg.bus.stops.length - 1,
        true,
      );
    }
    if (spec.alightingIndex !== undefined) {
      legs[spec.lastBusIndex] = adjustedBusLeg(
        lastBusLeg,
        0,
        spec.alightingIndex,
        false,
      );
    }
  }

  if (startWalkingRoute !== undefined && boardingStop !== undefined) {
    legs = [
      ...walkingLegs(
        startWalkingRoute,
        `${spec.route.id}-late-board-walk`,
        "GOAL_LATE_BOARDING",
        `${boardingStop.stopName} 정류장까지 걸어가 탑승`,
      ),
      ...legs.slice(spec.firstBusIndex),
    ];
  }
  if (endWalkingRoute !== undefined && alightingStop !== undefined) {
    const adjustedLastBusIndex =
      startWalkingRoute === undefined
        ? spec.lastBusIndex
        : spec.lastBusIndex - spec.firstBusIndex +
          startWalkingRoute.legs.length;
    legs = [
      ...legs.slice(0, adjustedLastBusIndex + 1),
      ...walkingLegs(
        endWalkingRoute,
        `${spec.route.id}-early-alight-walk`,
        "GOAL_EARLY_ALIGHTING",
        `${alightingStop.stopName} 정류장에서 미리 내려 목적지까지 걷기`,
      ),
    ];
  }

  const id = [
    spec.kind.toLocaleLowerCase(),
    spec.route.id,
    boardingStop?.nodeId ?? "same-board",
    alightingStop?.nodeId ?? "same-alight",
  ].join("-");
  return {
    route: rebuildRoute(spec.route, legs, id, spec.kind),
    kind: spec.kind,
  };
}

function withinGoalTolerance(
  route: NormalizedRoute,
  targetWalkDistanceMeters: number,
): boolean {
  return (
    Math.abs(route.walkDistanceMeters - targetWalkDistanceMeters) <=
    targetWalkDistanceMeters * 0.05
  );
}

export class CandidateGenerator {
  readonly #provider: MobilityProvider;

  public constructor(provider: MobilityProvider) {
    this.#provider = provider;
  }

  public async generate(
    request: RecommendationRequest,
    signal?: AbortSignal,
  ): Promise<CandidateGenerationResult> {
    const budget = new RouteCallBudget(this.#provider, 3);
    const baselineRoutes = await budget.transit(
      request.origin,
      request.destination,
      signal,
    );
    const sortedBaselineRoutes = [...baselineRoutes].sort(
      (first, second) => first.durationSeconds - second.durationSeconds,
    );
    const baseline = sortedBaselineRoutes[0];
    if (baseline === undefined) {
      throw new ProviderError({
        kind: "NO_ROUTE",
        message: "기본 대중교통 경로가 없습니다.",
      });
    }
    const candidates: RouteCandidate[] = sortedBaselineRoutes.map((route) => ({
      route,
      kind: "BASE",
    }));
    const remainingSteps = calculateRemainingSteps(
      request.currentSteps,
      request.goalSteps,
    );
    if (remainingSteps === 0) {
      return {
        baseline,
        candidates,
        candidateFailureCount: 0,
        routeApiCallCount: budget.totalCalls,
      };
    }
    const targetWalkDistanceMeters = calculateTargetWalkDistanceMeters(
      remainingSteps,
      request.walkingMetric.stepLengthMeters,
    );
    if (
      sortedBaselineRoutes.some((route) =>
        withinGoalTolerance(route, targetWalkDistanceMeters),
      )
    ) {
      return {
        baseline,
        candidates,
        candidateFailureCount: 0,
        routeApiCallCount: budget.totalCalls,
      };
    }

    const specs = enumerateAdjustments(
      sortedBaselineRoutes,
      request,
      targetWalkDistanceMeters,
    );
    let candidateFailureCount = 0;
    const buildBatch = async (batch: AdjustmentSpec[]) => {
      const settled = await Promise.allSettled(
        batch.map((spec) =>
          buildAdjustedCandidate(spec, request, budget, signal),
        ),
      );
      const built = settled.flatMap((result) => {
        if (result.status === "fulfilled") {
          return [result.value];
        }
        candidateFailureCount += 1;
        if (
          result.reason instanceof ProviderError &&
          result.reason.kind === "ABORTED"
        ) {
          throw result.reason;
        }
        return [];
      });
      candidates.push(...built);
      return built;
    };

    const early = await buildBatch(specs.early.slice(0, 4));
    if (
      !early.some((candidate) =>
        withinGoalTolerance(candidate.route, targetWalkDistanceMeters),
      )
    ) {
      const late = await buildBatch(specs.late.slice(0, 2));
      if (
        !late.some((candidate) =>
          withinGoalTolerance(candidate.route, targetWalkDistanceMeters),
        )
      ) {
        await buildBatch(specs.combined.slice(0, 1));
      }
    }

    return {
      baseline,
      candidates,
      candidateFailureCount,
      routeApiCallCount: budget.totalCalls,
    };
  }
}
