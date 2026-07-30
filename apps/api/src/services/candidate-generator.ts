import {
  HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND,
  haversineDistanceMeters,
  normalizedRouteSchema,
  type BusRouteStop,
  type Coordinate,
  type NormalizedRoute,
  type Recommendation,
  type RecommendationRequest,
  type RouteLeg,
  type TransitBusLeg,
  type WalkingRole,
} from "@chimap/contracts";
import pLimit, { type LimitFunction } from "p-limit";

import { ProviderError } from "../errors.js";
import type { MobilityProvider } from "../providers/types.js";
import type {
  RouteGeometryProfile,
  SubwayGeometryObservation,
} from "../providers/subway-track-geometry.js";
import type { RouteGeometryObservation } from "../providers/route-geometry.js";
import {
  calculateRemainingSteps,
  calculateTargetWalkDistanceMeters,
} from "./calculations.js";
import {
  SelectedRouteGeometryService,
  type GeometrySkippedObservation,
  type SelectedRouteGeometryPlan,
} from "./selected-route-geometry-service.js";

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
  planningTimedOut?: boolean;
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

function approximateWalkingRoute(
  source: MobilityProvider["source"],
  origin: Coordinate,
  destination: Coordinate,
  id: string,
): NormalizedRoute {
  const distanceMeters = Math.max(
    1,
    Math.round(haversineDistanceMeters(origin, destination) * 1.25),
  );
  const durationSeconds = Math.max(
    1,
    Math.round(
      distanceMeters /
        (HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND / 100),
    ),
  );
  return normalizedRouteSchema.parse({
    id: `candidate-walk-fallback-${id}`,
    source,
    durationSeconds,
    distanceMeters,
    walkDistanceMeters: distanceMeters,
    transitDistanceMeters: 0,
    transferCount: 0,
    legs: [{
      id: `candidate-walk-fallback-${id}-leg`,
      mode: "WALK",
      guidance: "도보 이동 (근사 경로)",
      distanceMeters,
      durationSeconds,
      coordinates: [origin, destination],
      geometryQuality: "APPROXIMATE",
      isExerciseSegment: false,
    }],
  });
}

function isDeadlineAbort(signal?: AbortSignal): boolean {
  return signal?.aborted === true &&
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError";
}

function abortedProviderError(signal: AbortSignal): ProviderError {
  const timedOut = isDeadlineAbort(signal);
  return new ProviderError({
    kind: timedOut ? "TIMEOUT" : "ABORTED",
    message: timedOut
      ? "후보 경로 생성 시간이 초과되었습니다."
      : "후보 경로 생성이 취소되었습니다.",
    retryable: timedOut,
    cause: signal.reason,
  });
}

function withAbortSignal<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return operation;
  if (signal.aborted) return Promise.reject(abortedProviderError(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = () =>
      settle(() => reject(abortedProviderError(signal)));
    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

class RouteCallBudget {
  readonly #provider: MobilityProvider;
  readonly #limit: LimitFunction;
  #transitCalls = 0;
  #walkCalls = 0;
  #walkCandidates = 0;
  readonly #geometryProfile: RouteGeometryProfile | undefined;
  readonly #observeSubwayGeometry:
    | ((observation: SubwayGeometryObservation) => void)
    | undefined;
  readonly #observeRouteGeometry:
    | ((observation: RouteGeometryObservation) => void)
    | undefined;

  public constructor(
    provider: MobilityProvider,
    concurrency = 3,
    geometryProfile?: RouteGeometryProfile,
    observeSubwayGeometry?: (observation: SubwayGeometryObservation) => void,
    observeRouteGeometry?: (observation: RouteGeometryObservation) => void,
  ) {
    this.#provider = provider;
    this.#limit = pLimit(concurrency);
    this.#geometryProfile = geometryProfile;
    this.#observeSubwayGeometry = observeSubwayGeometry;
    this.#observeRouteGeometry = observeRouteGeometry;
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
        ...(this.#geometryProfile === undefined
          ? {}
          : { geometryProfile: this.#geometryProfile }),
        ...(this.#observeSubwayGeometry === undefined
          ? {}
          : { observeSubwayGeometry: this.#observeSubwayGeometry }),
        ...(this.#observeRouteGeometry === undefined
          ? {}
          : { observeRouteGeometry: this.#observeRouteGeometry }),
        ...(signal === undefined ? {} : { signal }),
      }),
    );
  }

  public walk(
    origin: Coordinate,
    destination: Coordinate,
    signal?: AbortSignal,
  ): Promise<NormalizedRoute> {
    this.#walkCandidates += 1;
    const callId = this.#walkCandidates;
    if (this.#geometryProfile === "TRANSIT_V2") {
      return Promise.resolve(
        approximateWalkingRoute(
          this.#provider.source,
          origin,
          destination,
          String(callId),
        ),
      );
    }
    if (this.#walkCalls >= 8) {
      return Promise.reject(
        new ProviderError({
          kind: "UPSTREAM",
          message: "도보 경로 호출 예산을 초과했습니다.",
        }),
      );
    }
    this.#walkCalls += 1;
    return this.#limit(() => this.#provider.getWalkingRoute({
      origin,
      destination,
      routeMode: "BROAD_FIRST",
      ...(signal === undefined ? {} : { signal }),
    }));
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

function lateBoardingConnectorOrigin(
  route: NormalizedRoute,
  firstBusIndex: number,
  request: RecommendationRequest,
): Coordinate {
  const previousLeg = route.legs[firstBusIndex - 1];
  if (previousLeg === undefined) return request.origin.location;
  return previousLeg.coordinates.at(-1) ??
    route.legs[firstBusIndex]?.coordinates[0] ??
    request.origin.location;
}

function earlyAlightingConnectorDestination(
  route: NormalizedRoute,
  lastBusIndex: number,
  request: RecommendationRequest,
): Coordinate {
  const nextLeg = route.legs[lastBusIndex + 1];
  if (nextLeg === undefined) return request.destination.location;
  return nextLeg.coordinates[0] ??
    route.legs[lastBusIndex]?.coordinates.at(-1) ??
    request.destination.location;
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
    const lateConnectorOrigin = lateBoardingConnectorOrigin(
      route,
      indexes.first,
      request,
    );
    const earlyConnectorDestination = earlyAlightingConnectorDestination(
      route,
      indexes.last,
      request,
    );

    for (
      let alightingIndex = 1;
      alightingIndex < lastBus.stops.length - 1;
      alightingIndex += 1
    ) {
      const stop = lastBus.stops[alightingIndex]!;
      const estimatedWalkDistanceMeters =
        route.walkDistanceMeters +
        haversineDistanceMeters(
          stopCoordinate(stop),
          earlyConnectorDestination,
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
        route.walkDistanceMeters +
        haversineDistanceMeters(
          lateConnectorOrigin,
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
          route.walkDistanceMeters +
          haversineDistanceMeters(
            lateConnectorOrigin,
            stopCoordinate(boardingStop),
          ) *
            1.25 +
          haversineDistanceMeters(
            stopCoordinate(alightingStop),
            earlyConnectorDestination,
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

export function adjustedBusLeg(
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
  const polyline = stops.map(stopCoordinate);
  const distanceMeters = Math.max(1, polylineDistanceMeters(polyline));
  const fullStopDistanceMeters = Math.max(
    1,
    polylineDistanceMeters(bus.stops.map(stopCoordinate)),
  );
  const distanceRatio = distanceMeters / fullStopDistanceMeters;
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
    ...(leg.geometryQuality === undefined
      ? {}
      : { geometryQuality: "APPROXIMATE" as const }),
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
          lateBoardingConnectorOrigin(
            spec.route,
            spec.firstBusIndex,
            request,
          ),
          stopCoordinate(boardingStop),
          signal,
        ),
    alightingStop === undefined
      ? Promise.resolve(undefined)
      : budget.walk(
          stopCoordinate(alightingStop),
          earlyAlightingConnectorDestination(
            spec.route,
            spec.lastBusIndex,
            request,
          ),
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

  const startWalkingLegs =
    startWalkingRoute === undefined || boardingStop === undefined
      ? []
      : walkingLegs(
          startWalkingRoute,
          `${spec.route.id}-late-board-walk`,
          "GOAL_LATE_BOARDING",
          `${boardingStop.stopName} 정류장까지 더 걸어가 탑승`,
        );
  const endWalkingLegs =
    endWalkingRoute === undefined || alightingStop === undefined
      ? []
      : walkingLegs(
          endWalkingRoute,
          `${spec.route.id}-early-alight-walk`,
          "GOAL_EARLY_ALIGHTING",
          `${alightingStop.stopName} 정류장에서 미리 내려 기존 경로 합류 지점까지 걷기`,
        );
  if (startWalkingLegs.length > 0 || endWalkingLegs.length > 0) {
    const connected: RouteLeg[] = [];
    for (const [index, leg] of legs.entries()) {
      if (index === spec.firstBusIndex) connected.push(...startWalkingLegs);
      connected.push(leg);
      if (index === spec.lastBusIndex) connected.push(...endWalkingLegs);
    }
    legs = connected;
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
  readonly #selectedRouteGeometry: SelectedRouteGeometryService;

  public constructor(provider: MobilityProvider) {
    this.#provider = provider;
    this.#selectedRouteGeometry = new SelectedRouteGeometryService(provider);
  }

  public enrichSelectedRouteGeometry(
    recommendations: readonly Recommendation[],
    signal?: AbortSignal,
    observe?: (observation: RouteGeometryObservation) => void,
    observeSkipped?: (observation: GeometrySkippedObservation) => void,
  ): Promise<Recommendation[]> {
    return this.#selectedRouteGeometry.enrich(
      recommendations,
      signal,
      observe,
      observeSkipped === undefined ? {} : { observeSkipped },
    );
  }

  public prepareSelectedRouteGeometry(
    recommendations: readonly Recommendation[],
    signal?: AbortSignal,
    observe?: (observation: RouteGeometryObservation) => void,
    observeSkipped?: (observation: GeometrySkippedObservation) => void,
  ): SelectedRouteGeometryPlan {
    return this.#selectedRouteGeometry.prepare(
      recommendations,
      signal,
      observe,
      observeSkipped === undefined ? {} : { observeSkipped },
    );
  }

  public enrichWalkingGeometry(
    recommendations: readonly Recommendation[],
    signal?: AbortSignal,
    observe?: (observation: RouteGeometryObservation) => void,
    observeSkipped?: (observation: GeometrySkippedObservation) => void,
  ): Promise<Recommendation[]> {
    const budgetSignal = AbortSignal.timeout(8_000);
    const walkingSignal = signal === undefined
      ? budgetSignal
      : AbortSignal.any([signal, budgetSignal]);
    return this.#selectedRouteGeometry.enrich(
      recommendations,
      walkingSignal,
      observe,
      {
        includeBus: false,
        ...(observeSkipped === undefined ? {} : { observeSkipped }),
      },
    );
  }

  public async generate(
    request: RecommendationRequest,
    signal?: AbortSignal,
    options: {
      geometryProfile?: RouteGeometryProfile;
      allowPartialOnTimeout?: boolean;
      observeSubwayGeometry?: (
        observation: SubwayGeometryObservation,
      ) => void;
      observeRouteGeometry?: (
        observation: RouteGeometryObservation,
      ) => void;
    } = {},
  ): Promise<CandidateGenerationResult> {
    const budget = new RouteCallBudget(
      this.#provider,
      3,
      options.geometryProfile,
      options.observeSubwayGeometry,
      options.observeRouteGeometry,
    );
    const baselineRoutes = await withAbortSignal(
      budget.transit(
        request.origin,
        request.destination,
        signal,
      ),
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
    const allowPartialOnTimeout = options.allowPartialOnTimeout === true;
    let candidateFailureCount = 0;
    const result = (): CandidateGenerationResult => ({
      baseline,
      candidates,
      candidateFailureCount,
      routeApiCallCount: budget.totalCalls,
      ...(allowPartialOnTimeout && isDeadlineAbort(signal)
        ? { planningTimedOut: true }
        : {}),
    });
    if (signal?.aborted === true) {
      if (allowPartialOnTimeout && isDeadlineAbort(signal)) return result();
      throw abortedProviderError(signal);
    }
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
    const buildBatch = async (batch: AdjustmentSpec[]) => {
      const settled = await Promise.allSettled(
        batch.map((spec) =>
          withAbortSignal(
            buildAdjustedCandidate(spec, request, budget, signal),
            signal,
          ),
        ),
      );
      const built = settled.flatMap((result) => {
        if (result.status === "fulfilled") {
          return [result.value];
        }
        candidateFailureCount += 1;
        if (
          result.reason instanceof ProviderError &&
          (result.reason.kind === "ABORTED" ||
            result.reason.kind === "TIMEOUT") &&
          !(allowPartialOnTimeout && isDeadlineAbort(signal))
        ) {
          throw result.reason;
        }
        return [];
      });
      candidates.push(...built);
      return {
        built,
        deadlineExpired:
          allowPartialOnTimeout && isDeadlineAbort(signal),
      };
    };

    const early = await buildBatch(specs.early.slice(0, 4));
    if (early.deadlineExpired) return result();
    if (
      !early.built.some((candidate) =>
        withinGoalTolerance(candidate.route, targetWalkDistanceMeters),
      )
    ) {
      const late = await buildBatch(specs.late.slice(0, 2));
      if (late.deadlineExpired) return result();
      if (
        !late.built.some((candidate) =>
          withinGoalTolerance(candidate.route, targetWalkDistanceMeters),
        )
      ) {
        const combined = await buildBatch(specs.combined.slice(0, 1));
        if (combined.deadlineExpired) return result();
      }
    }

    return result();
  }
}
