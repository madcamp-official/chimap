import type {
  BusRouteStop,
  Coordinate,
  NormalizedRoute,
  Recommendation,
  RouteGeometryQuality,
} from "@chimap/contracts";

import type { MobilityProvider } from "../providers/types.js";
import {
  classifyGeometryError,
  withWalkingGeometryLimit,
  type ResolvedBusGeometry,
  type RouteGeometryObservation,
  type RouteGeometryReason,
} from "../providers/route-geometry.js";

const MAX_SELECTED_RECOMMENDATIONS = 3;
const MAX_WALK_GEOMETRY_CALLS = 8;

export type GeometrySkippedObservation = {
  mode: "BUS" | "WALK";
  stage: "SELECTED";
  reason:
    | "BUDGET_EXHAUSTED_BEFORE_START"
    | "CALL_LIMIT_REACHED"
    | "REQUEST_ABORTED";
};

type GeometrySkippedObserver = (
  observation: GeometrySkippedObservation,
) => void;

export type SelectedRouteGeometryOptions = {
  includeBus?: boolean;
  includeWalk?: boolean;
  observeSkipped?: GeometrySkippedObserver;
};

export type SelectedRouteGeometryPlan = {
  goalWalking: Promise<Recommendation[]>;
  complete: Promise<Recommendation[]>;
};

function observeGeometrySkipped(
  observer: GeometrySkippedObserver | undefined,
  observation: GeometrySkippedObservation,
): void {
  try {
    observer?.(observation);
  } catch {
    // Observability must never change geometry enrichment.
  }
}

function abortedBeforeStartReason(
  signal: AbortSignal,
): GeometrySkippedObservation["reason"] {
  return signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError"
    ? "BUDGET_EXHAUSTED_BEFORE_START"
    : "REQUEST_ABORTED";
}

type ResolvedWalkingGeometry = {
  coordinates: Coordinate[] | null;
  reason: RouteGeometryReason;
  durationMilliseconds: number;
  queueWaitMilliseconds: number;
  queueStartedCount: number;
  queueAbortedBeforeStartCount: number;
};

type ResolvedBusGeometryTask = {
  geometry: ResolvedBusGeometry | null;
  reason: RouteGeometryReason;
  durationMilliseconds: number;
};

function walkingGeometryKey(from: Coordinate, to: Coordinate): string {
  return [
    from.lng.toFixed(5),
    from.lat.toFixed(5),
    to.lng.toFixed(5),
    to.lat.toFixed(5),
  ].join(":");
}

function busGeometryKey(stops: readonly BusRouteStop[]): string {
  const first = stops[0];
  if (first === undefined) return "empty";
  return [
    first.cityCode,
    first.routeId,
    ...stops.map((stop) => [
      stop.nodeOrder,
      stop.nodeId,
      stop.latitude.toFixed(7),
      stop.longitude.toFixed(7),
    ].join("@")),
  ].join(":");
}

function joinedWalkingCoordinates(route: NormalizedRoute): Coordinate[] {
  const coordinates: Coordinate[] = [];
  for (const leg of route.legs) {
    for (const point of leg.coordinates) {
      const previous = coordinates.at(-1);
      if (
        previous === undefined ||
        previous.lat !== point.lat ||
        previous.lng !== point.lng
      ) {
        coordinates.push(point);
      }
    }
  }
  return coordinates;
}

function usableBusGeometry(
  geometry: ResolvedBusGeometry | null,
): geometry is ResolvedBusGeometry {
  return geometry !== null && geometry.coordinates.length >= 2;
}

export class SelectedRouteGeometryService {
  public constructor(private readonly provider: MobilityProvider) {}

  public enrich(
    recommendations: readonly Recommendation[],
    signal?: AbortSignal,
    observe?: (observation: RouteGeometryObservation) => void,
    options: SelectedRouteGeometryOptions = {},
  ): Promise<Recommendation[]> {
    return this.prepare(recommendations, signal, observe, options).complete;
  }

  public prepare(
    recommendations: readonly Recommendation[],
    signal?: AbortSignal,
    observe?: (observation: RouteGeometryObservation) => void,
    options: SelectedRouteGeometryOptions = {},
  ): SelectedRouteGeometryPlan {
    const selected = recommendations.slice(0, MAX_SELECTED_RECOMMENDATIONS);
    const walkingTargets = new Map<
      string,
      { from: Coordinate; to: Coordinate }
    >();
    const busTargets = new Map<string, BusRouteStop[]>();

    for (const recommendation of selected) {
      for (const leg of recommendation.legs) {
        if (
          leg.mode === "WALK" &&
          options.includeWalk !== false &&
          leg.geometryQuality !== "DETAILED" &&
          leg.distanceMeters > 20
        ) {
          const from = leg.coordinates[0];
          const to = leg.coordinates.at(-1);
          if (from !== undefined && to !== undefined) {
            const key = walkingGeometryKey(from, to);
            if (!walkingTargets.has(key)) walkingTargets.set(key, { from, to });
          }
        }
        if (
          leg.mode === "BUS" &&
          leg.geometryQuality !== "DETAILED" &&
          leg.bus !== undefined &&
          leg.bus.stops.length >= 2 &&
          options.includeBus !== false &&
          this.provider.resolveBusGeometry !== undefined
        ) {
          const key = busGeometryKey(leg.bus.stops);
          if (!busTargets.has(key)) busTargets.set(key, leg.bus.stops);
        }
      }
    }

    if (signal?.aborted === true) {
      const reason = abortedBeforeStartReason(signal);
      for (const _target of walkingTargets.values()) {
        observeGeometrySkipped(options.observeSkipped, {
          mode: "WALK",
          stage: "SELECTED",
          reason,
        });
      }
      for (const _target of busTargets.values()) {
        observeGeometrySkipped(options.observeSkipped, {
          mode: "BUS",
          stage: "SELECTED",
          reason,
        });
      }
      const result = Promise.resolve([...recommendations]);
      return { goalWalking: result, complete: result };
    }

    const walkingResolutions = new Map<
      string,
      Promise<ResolvedWalkingGeometry>
    >();
    let walkingCallCount = 0;
    for (const [key, target] of walkingTargets) {
      if (walkingCallCount >= MAX_WALK_GEOMETRY_CALLS) {
        observeGeometrySkipped(options.observeSkipped, {
          mode: "WALK",
          stage: "SELECTED",
          reason: "CALL_LIMIT_REACHED",
        });
        walkingResolutions.set(key, Promise.resolve({
          coordinates: null,
          reason: "UPSTREAM",
          durationMilliseconds: 0,
          queueWaitMilliseconds: 0,
          queueStartedCount: 0,
          queueAbortedBeforeStartCount: 0,
        }));
        continue;
      }
      walkingCallCount += 1;
      const startedAt = performance.now();
      let queueWaitMilliseconds = 0;
      let queueStartedCount = 0;
      let queueAbortedBeforeStartCount = 0;
      walkingResolutions.set(
        key,
        withWalkingGeometryLimit(
          () => this.provider.getWalkingRoute({
            origin: target.from,
            destination: target.to,
            routeMode: "BROAD_FIRST",
            ...(signal === undefined ? {} : { signal }),
          }),
          signal,
          (observation) => {
            queueWaitMilliseconds = observation.queueWaitMilliseconds;
            queueStartedCount = observation.started ? 1 : 0;
            queueAbortedBeforeStartCount = observation.abortedBeforeStart
              ? 1
              : 0;
          },
        ).then((route): ResolvedWalkingGeometry => {
          const coordinates = joinedWalkingCoordinates(route);
          return coordinates.length >= 2
            ? {
                coordinates,
                reason: "NONE",
                durationMilliseconds: performance.now() - startedAt,
                queueWaitMilliseconds,
                queueStartedCount,
                queueAbortedBeforeStartCount,
              }
            : {
                coordinates: null,
                reason: "EMPTY_PATH",
                durationMilliseconds: performance.now() - startedAt,
                queueWaitMilliseconds,
                queueStartedCount,
                queueAbortedBeforeStartCount,
              };
        }).catch((error: unknown): ResolvedWalkingGeometry => ({
          coordinates: null,
          reason: classifyGeometryError(error),
          durationMilliseconds: performance.now() - startedAt,
          queueWaitMilliseconds,
          queueStartedCount,
          queueAbortedBeforeStartCount,
        })),
      );
    }

    const busResolutions = new Map<
      string,
      Promise<ResolvedBusGeometryTask>
    >();
    for (const [key, stops] of busTargets) {
      const startedAt = performance.now();
      busResolutions.set(
        key,
        this.provider.resolveBusGeometry!({
          stops,
          ...(signal === undefined ? {} : { signal }),
          ...(observe === undefined ? {} : { observe }),
        }).then((geometry): ResolvedBusGeometryTask => ({
          geometry,
          reason: geometry.reason,
          durationMilliseconds: performance.now() - startedAt,
        })).catch((error: unknown): ResolvedBusGeometryTask => {
          const reason = classifyGeometryError(error);
          observe?.({
            mode: "BUS",
            outcome: "APPROXIMATE",
            reason,
            source: "FALLBACK",
            cacheState: "NONE",
            durationMilliseconds: performance.now() - startedAt,
            inputVertexCount: stops.length,
            outputVertexCount: stops.length,
            successfulSectionCount: 0,
            failedSectionCount: Math.max(1, stops.length - 1),
            ...(stops[0] === undefined
              ? {}
              : {
                  routeId: stops[0].routeId,
                  fromNodeOrder: stops[0].nodeOrder,
                }),
            ...(stops.at(-1) === undefined
              ? {}
              : { toNodeOrder: stops.at(-1)!.nodeOrder }),
          });
          return {
            geometry: null,
            reason,
            durationMilliseconds: performance.now() - startedAt,
          };
        }),
      );
    }

    const resolveWalking = async (
      keys: ReadonlySet<string> | undefined,
    ): Promise<Map<string, ResolvedWalkingGeometry>> => {
      const entries = [...walkingResolutions].filter(
        ([key]) => keys === undefined || keys.has(key),
      );
      return new Map(await Promise.all(entries.map(async ([key, resolution]) =>
        [key, await resolution] as const
      )));
    };
    const resolveBus = async (): Promise<Map<string, ResolvedBusGeometryTask>> =>
      new Map(await Promise.all(
        [...busResolutions].map(async ([key, resolution]) =>
          [key, await resolution] as const
        ),
      ));
    const applyResolved = (input: {
      resolvedWalking: ReadonlyMap<string, ResolvedWalkingGeometry>;
      resolvedBus: ReadonlyMap<string, ResolvedBusGeometryTask>;
      recommendationIndexes?: ReadonlySet<number>;
      includeBus: boolean;
      observeWalking: boolean;
    }): Recommendation[] => recommendations.map(
      (recommendation, recommendationIndex) => {
        if (
          recommendationIndex >= MAX_SELECTED_RECOMMENDATIONS ||
          (input.recommendationIndexes !== undefined &&
            !input.recommendationIndexes.has(recommendationIndex))
        ) {
          return recommendation;
        }
        return {
          ...recommendation,
          legs: recommendation.legs.map((leg) => {
          const from = leg.coordinates[0];
          const to = leg.coordinates.at(-1);
          if (
            leg.mode === "WALK" &&
            options.includeWalk !== false &&
            leg.geometryQuality !== "DETAILED" &&
            leg.distanceMeters > 20 &&
            from !== undefined &&
            to !== undefined
          ) {
            const geometry = input.resolvedWalking.get(
              walkingGeometryKey(from, to),
            );
            if (geometry === undefined) return leg;
            const detailed = geometry.coordinates !== null;
            if (input.observeWalking) {
              observe?.({
                mode: "WALK",
                outcome: detailed ? "DETAILED" : "APPROXIMATE",
                reason: detailed ? "NONE" : geometry.reason,
                source: detailed ? "KAKAO_WALK" : "FALLBACK",
                cacheState: "NONE",
                durationMilliseconds: geometry.durationMilliseconds,
                inputVertexCount: 2,
                outputVertexCount:
                  geometry.coordinates?.length ?? leg.coordinates.length,
                successfulSectionCount: detailed ? 1 : 0,
                failedSectionCount: detailed ? 0 : 1,
                queueWaitMilliseconds: geometry.queueWaitMilliseconds,
                queueStartedCount: geometry.queueStartedCount,
                queueAbortedBeforeStartCount:
                  geometry.queueAbortedBeforeStartCount,
                ...(leg.walkingRole === undefined
                  ? {}
                  : { walkingRole: leg.walkingRole }),
              });
            }
            return detailed
              ? {
                  ...leg,
                  coordinates: geometry.coordinates!,
                  geometryQuality: "DETAILED" as const,
                }
              : leg;
          }
          if (
            leg.mode === "BUS" &&
            leg.geometryQuality !== "DETAILED" &&
            leg.bus !== undefined &&
            leg.bus.stops.length >= 2 &&
            input.includeBus
          ) {
            const resolved = input.resolvedBus.get(
              busGeometryKey(leg.bus.stops),
            );
            if (resolved === undefined || !usableBusGeometry(resolved.geometry)) {
              return leg;
            }
            const quality: RouteGeometryQuality = resolved.geometry.quality;
            return {
              ...leg,
              coordinates: resolved.geometry.coordinates,
              geometryQuality: quality,
              bus: {
                ...leg.bus,
                polyline: resolved.geometry.coordinates,
              },
            };
          }
          return leg;
          }),
        };
      },
    );

    const goalIndex = selected.findIndex(
      (recommendation) => recommendation.type === "GOAL",
    );
    const goalWalkingKeys = new Set<string>();
    const goal = selected[goalIndex];
    if (goal !== undefined && options.includeWalk !== false) {
      for (const leg of goal.legs) {
        const from = leg.coordinates[0];
        const to = leg.coordinates.at(-1);
        if (
          leg.mode === "WALK" &&
          leg.geometryQuality !== "DETAILED" &&
          leg.distanceMeters > 20 &&
          from !== undefined &&
          to !== undefined
        ) {
          goalWalkingKeys.add(walkingGeometryKey(from, to));
        }
      }
    }

    const goalWalking = (async (): Promise<Recommendation[]> => {
      if (goalIndex < 0 || goalWalkingKeys.size === 0) {
        return [...recommendations];
      }
      const resolvedWalking = await resolveWalking(goalWalkingKeys);
      return applyResolved({
        resolvedWalking,
        resolvedBus: new Map(),
        recommendationIndexes: new Set([goalIndex]),
        includeBus: false,
        observeWalking: false,
      });
    })();
    const complete = (async (): Promise<Recommendation[]> => {
      const [resolvedWalking, resolvedBus] = await Promise.all([
        resolveWalking(undefined),
        resolveBus(),
      ]);
      return applyResolved({
        resolvedWalking,
        resolvedBus,
        includeBus: options.includeBus !== false,
        observeWalking: true,
      });
    })();
    return { goalWalking, complete };
  }
}
