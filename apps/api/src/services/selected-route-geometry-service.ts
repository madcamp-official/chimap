import type {
  BusRouteStop,
  Coordinate,
  NormalizedRoute,
  Recommendation,
  RouteGeometryQuality,
  WalkingRole,
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

function observeRouteGeometry(
  observer: ((observation: RouteGeometryObservation) => void) | undefined,
  observation: RouteGeometryObservation,
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

type ResolvedWalkingGeometry = ({
  coordinates: Coordinate[];
  distanceMeters: number;
  durationSeconds: number;
} | {
  coordinates: null;
}) & {
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
      {
        from: Coordinate;
        to: Coordinate;
        fallbackVertexCount: number;
        walkingRole?: WalkingRole;
      }
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
            const existing = walkingTargets.get(key);
            if (existing === undefined) {
              walkingTargets.set(key, {
                from,
                to,
                fallbackVertexCount: leg.coordinates.length,
                ...(leg.walkingRole === undefined
                  ? {}
                  : { walkingRole: leg.walkingRole }),
              });
            } else {
              existing.fallbackVertexCount = Math.max(
                existing.fallbackVertexCount,
                leg.coordinates.length,
              );
              if (existing.walkingRole !== leg.walkingRole) {
                delete existing.walkingRole;
              }
            }
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
          const resolved: ResolvedWalkingGeometry = coordinates.length >= 2
            ? {
                coordinates,
                distanceMeters: route.walkDistanceMeters,
                durationSeconds: route.durationSeconds,
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
          observeRouteGeometry(
            observe,
            {
              mode: "WALK",
              outcome: resolved.coordinates === null
                ? "APPROXIMATE"
                : "DETAILED",
              reason: resolved.reason,
              source: resolved.coordinates === null
                ? "FALLBACK"
                : "KAKAO_WALK",
              cacheState: "NONE",
              durationMilliseconds: resolved.durationMilliseconds,
              inputVertexCount: 2,
              outputVertexCount:
                resolved.coordinates?.length ?? target.fallbackVertexCount,
              successfulSectionCount: resolved.coordinates === null ? 0 : 1,
              failedSectionCount: resolved.coordinates === null ? 1 : 0,
              queueWaitMilliseconds: resolved.queueWaitMilliseconds,
              queueStartedCount: resolved.queueStartedCount,
              queueAbortedBeforeStartCount:
                resolved.queueAbortedBeforeStartCount,
              ...(target.walkingRole === undefined
                ? {}
                : { walkingRole: target.walkingRole }),
            },
          );
          return resolved;
        }).catch((error: unknown): ResolvedWalkingGeometry => {
          const resolved: ResolvedWalkingGeometry = {
            coordinates: null,
            reason: classifyGeometryError(error),
            durationMilliseconds: performance.now() - startedAt,
            queueWaitMilliseconds,
            queueStartedCount,
            queueAbortedBeforeStartCount,
          };
          observeRouteGeometry(
            observe,
            {
              mode: "WALK",
              outcome: "APPROXIMATE",
              reason: resolved.reason,
              source: "FALLBACK",
              cacheState: "NONE",
              durationMilliseconds: resolved.durationMilliseconds,
              inputVertexCount: 2,
              outputVertexCount: target.fallbackVertexCount,
              successfulSectionCount: 0,
              failedSectionCount: 1,
              queueWaitMilliseconds: resolved.queueWaitMilliseconds,
              queueStartedCount: resolved.queueStartedCount,
              queueAbortedBeforeStartCount:
                resolved.queueAbortedBeforeStartCount,
              ...(target.walkingRole === undefined
                ? {}
                : { walkingRole: target.walkingRole }),
            },
          );
          return resolved;
        }),
      );
    }

    const busResolutions = new Map<
      string,
      Promise<ResolvedBusGeometryTask>
    >();
    for (const [key, stops] of busTargets) {
      const startedAt = performance.now();
      let observed = false;
      const observeBusOnce = (observation: RouteGeometryObservation): void => {
        if (observed) return;
        observed = true;
        observeRouteGeometry(observe, observation);
      };
      busResolutions.set(
        key,
        this.provider.resolveBusGeometry!({
          stops,
          ...(signal === undefined ? {} : { signal }),
          ...(observe === undefined ? {} : { observe: observeBusOnce }),
        }).then((geometry): ResolvedBusGeometryTask => {
          const durationMilliseconds = performance.now() - startedAt;
          observeBusOnce({
            mode: "BUS",
            outcome: geometry.quality,
            reason: geometry.reason,
            source: geometry.quality === "DETAILED"
              ? "KAKAO_ROAD"
              : "FALLBACK",
            cacheState: "NONE",
            durationMilliseconds,
            inputVertexCount: stops.length,
            outputVertexCount: geometry.coordinates.length,
            successfulSectionCount: geometry.quality === "DETAILED"
              ? Math.max(1, stops.length - 1)
              : 0,
            failedSectionCount: geometry.quality === "DETAILED"
              ? 0
              : Math.max(1, stops.length - 1),
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
            geometry,
            reason: geometry.reason,
            durationMilliseconds,
          };
        }).catch((error: unknown): ResolvedBusGeometryTask => {
          const reason = classifyGeometryError(error);
          observeBusOnce({
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
            return detailed
              ? {
                  ...leg,
                  distanceMeters: geometry.distanceMeters,
                  durationSeconds: geometry.durationSeconds,
                  coordinates: geometry.coordinates,
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
      });
    })();
    return { goalWalking, complete };
  }
}
