import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type Coordinate,
  type NormalizedRoute,
  type Place,
  type RecommendationRequest,
} from "@chimap/contracts";
import pLimit, { type LimitFunction } from "p-limit";

import { ProviderError } from "../errors.js";
import type { MobilityProvider } from "../providers/types.js";
import {
  coordinateCacheKey,
  MemoryCache,
  normalizeSearchTerm,
} from "./cache.js";
import {
  calculateRemainingSteps,
  calculateTargetWalkDistanceMeters,
} from "./calculations.js";
import {
  distanceToPolylineMeters,
  firstRouteCoordinate,
  lastRouteCoordinate,
} from "./geometry.js";

export type CandidateKind = "BASE" | "EARLY_EXIT" | "POI_FALLBACK";

export type RouteCandidate = {
  route: NormalizedRoute;
  kind: CandidateKind;
  connectionPenalty: number;
  connectionGapMeters: number;
  resolutionConfidence?: number;
  sourcePlace?: Place;
  failedChecks: string[];
};

export type CandidateGenerationResult = {
  baseline: NormalizedRoute;
  candidates: RouteCandidate[];
  candidateFailureCount: number;
  routeApiCallCount: number;
};

type ResolvedPlace = {
  place: Place;
  confidence: number;
  distanceToRouteMeters: number;
};

type RankedPlace = ResolvedPlace & {
  directDistanceToDestination: number;
  distanceFit: number;
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

  public get remainingCandidatePairs(): number {
    return Math.max(
      0,
      Math.min(5 - this.#transitCalls, 4 - this.#walkCalls),
    );
  }

  public transit(
    origin: Place,
    destination: Place,
    signal?: AbortSignal,
  ): Promise<NormalizedRoute[]> {
    if (this.#transitCalls >= 5) {
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
    if (this.#walkCalls >= 4) {
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

  public placeSearch<T>(operation: () => Promise<T>): Promise<T> {
    return this.#limit(operation);
  }
}

function normalizePlaceName(value: string): string {
  return normalizeSearchTerm(value).replace(/[^\p{L}\p{N}]/gu, "");
}

function bigrams(value: string): Set<string> {
  if (value.length <= 1) {
    return new Set([value]);
  }
  return new Set(
    Array.from({ length: value.length - 1 }, (_, index) =>
      value.slice(index, index + 2),
    ),
  );
}

export function nameSimilarity(first: string, second: string): number {
  const normalizedFirst = normalizePlaceName(first);
  const normalizedSecond = normalizePlaceName(second);
  if (normalizedFirst === normalizedSecond) {
    return 1;
  }
  if (
    normalizedFirst.includes(normalizedSecond) ||
    normalizedSecond.includes(normalizedFirst)
  ) {
    return 0.88;
  }

  const firstBigrams = bigrams(normalizedFirst);
  const secondBigrams = bigrams(normalizedSecond);
  const intersection = [...firstBigrams].filter((value) =>
    secondBigrams.has(value),
  ).length;
  const union = new Set([...firstBigrams, ...secondBigrams]).size;
  return union === 0 ? 0 : intersection / union;
}

class StopResolver {
  readonly #provider: MobilityProvider;
  readonly #cache: MemoryCache;
  readonly #budget: RouteCallBudget;

  public constructor(
    provider: MobilityProvider,
    budget: RouteCallBudget,
    cache: MemoryCache,
  ) {
    this.#provider = provider;
    this.#budget = budget;
    this.#cache = cache;
  }

  public resolve(
    stopName: string,
    destination: Coordinate,
    routeLine: Coordinate[],
    signal?: AbortSignal,
  ): Promise<ResolvedPlace | null> {
    const routeStart = routeLine[0];
    const routeEnd = routeLine[routeLine.length - 1];
    const routeSignature =
      routeStart === undefined || routeEnd === undefined
        ? "empty"
        : `${coordinateCacheKey(routeStart)}-${coordinateCacheKey(routeEnd)}`;
    const key = [
      "resolved-stop",
      normalizePlaceName(stopName),
      coordinateCacheKey(destination),
      routeSignature,
    ].join(":");

    return this.#cache.getOrLoad(key, 6 * 60 * 60 * 1000, async () => {
      const places = await this.#budget.placeSearch(() =>
        this.#provider.searchPlaces(stopName, {
          center: destination,
          limit: 5,
          radiusMeters: 10_000,
          ...(signal === undefined ? {} : { signal }),
        }),
      );

      const ranked = places
        .map((place) => {
          const nameScore = nameSimilarity(stopName, place.name);
          const transportScore =
            /교통|지하철|기차|버스|정류장|역/u.test(
              `${place.category} ${place.name}`,
            )
              ? 1
              : 0;
          const distanceToRouteMeters = distanceToPolylineMeters(
            place.location,
            routeLine,
          );
          const routeScore = Number.isFinite(distanceToRouteMeters)
            ? Math.max(0, 1 - distanceToRouteMeters / 1000)
            : 0;
          const confidence =
            0.55 * nameScore + 0.2 * transportScore + 0.25 * routeScore;
          return { place, confidence, distanceToRouteMeters };
        })
        .sort(
          (first, second) =>
            second.confidence - first.confidence ||
            first.distanceToRouteMeters - second.distanceToRouteMeters,
        );
      const best = ranked[0];
      if (
        best === undefined ||
        best.confidence < 0.58 ||
        best.distanceToRouteMeters > 1500
      ) {
        return null;
      }
      return best;
    });
  }
}

function getLastTransitLeg(route: NormalizedRoute) {
  for (let index = route.legs.length - 1; index >= 0; index -= 1) {
    const leg = route.legs[index];
    if (leg?.mode === "BUS" || leg?.mode === "SUBWAY") {
      return leg;
    }
  }
  return undefined;
}

function extractStopTasks(routes: NormalizedRoute[]): Array<{
  stopName: string;
  routeLine: Coordinate[];
}> {
  const seen = new Set<string>();
  const tasks: Array<{ stopName: string; routeLine: Coordinate[] }> = [];
  for (const route of routes) {
    const leg = getLastTransitLeg(route);
    const stops = leg?.stops;
    if (leg === undefined || stops === undefined || stops.length <= 1) {
      continue;
    }
    const nearbyStops = stops.slice(Math.max(0, stops.length - 7), -1);
    for (const stopName of nearbyStops) {
      const normalized = normalizePlaceName(stopName);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        tasks.push({ stopName, routeLine: leg.coordinates });
      }
    }
  }
  return tasks.slice(-12);
}

function rankResolvedPlaces(
  places: Array<ResolvedPlace | null>,
  destination: Coordinate,
  desiredDirectDistance: number,
): RankedPlace[] {
  const unique = new Map<string, ResolvedPlace>();
  for (const place of places) {
    if (place !== null) {
      const existing = unique.get(place.place.id);
      if (existing === undefined || existing.confidence < place.confidence) {
        unique.set(place.place.id, place);
      }
    }
  }

  return [...unique.values()]
    .map((resolved) => {
      const directDistanceToDestination = haversineDistanceMeters(
        resolved.place.location,
        destination,
      );
      const distanceFit =
        Math.abs(directDistanceToDestination - desiredDirectDistance) /
        Math.max(desiredDirectDistance, 300);
      return {
        ...resolved,
        directDistanceToDestination,
        distanceFit,
      };
    })
    .filter((place) => place.directDistanceToDestination >= 50)
    .sort(
      (first, second) =>
        first.distanceFit - second.distanceFit ||
        second.confidence - first.confidence,
    );
}

function combineRoutes(input: {
  transitRoute: NormalizedRoute;
  walkingRoute: NormalizedRoute;
  destination: Coordinate;
  sourcePlace: Place;
  kind: "EARLY_EXIT" | "POI_FALLBACK";
  confidence: number;
}): RouteCandidate | null {
  const transitEnd = lastRouteCoordinate(input.transitRoute);
  const walkStart = firstRouteCoordinate(input.walkingRoute);
  const walkEnd = lastRouteCoordinate(input.walkingRoute);
  if (
    transitEnd === undefined ||
    walkStart === undefined ||
    walkEnd === undefined
  ) {
    return null;
  }

  const connectionGapMeters = haversineDistanceMeters(transitEnd, walkStart);
  const destinationGapMeters = haversineDistanceMeters(
    walkEnd,
    input.destination,
  );
  if (connectionGapMeters > 120 || destinationGapMeters > 250) {
    return null;
  }

  const exerciseLegs = input.walkingRoute.legs.map((leg, index) => ({
    ...leg,
    id: `${input.kind.toLocaleLowerCase()}-${input.sourcePlace.id}-exercise-${index}`,
    isExerciseSegment: true,
  }));
  const legs = [...input.transitRoute.legs, ...exerciseLegs];
  const walkDistanceMeters = legs
    .filter((leg) => leg.mode === "WALK")
    .reduce((total, leg) => total + leg.distanceMeters, 0);
  const transitDistanceMeters = legs
    .filter((leg) => leg.mode !== "WALK")
    .reduce((total, leg) => total + leg.distanceMeters, 0);
  const route = normalizedRouteSchema.parse({
    id: `${input.kind.toLocaleLowerCase()}-${input.sourcePlace.id}`,
    source: input.transitRoute.source,
    durationSeconds:
      input.transitRoute.durationSeconds + input.walkingRoute.durationSeconds,
    distanceMeters: walkDistanceMeters + transitDistanceMeters,
    walkDistanceMeters,
    transitDistanceMeters,
    transferCount: input.transitRoute.transferCount,
    ...(input.transitRoute.fareWon === undefined
      ? {}
      : { fareWon: input.transitRoute.fareWon }),
    ...(input.transitRoute.waitingDurationSeconds === undefined
      ? {}
      : {
          waitingDurationSeconds:
            input.transitRoute.waitingDurationSeconds,
        }),
    ...(input.transitRoute.ridingDurationSeconds === undefined
      ? {}
      : {
          ridingDurationSeconds:
            input.transitRoute.ridingDurationSeconds,
        }),
    ...(input.transitRoute.isRealtime === undefined
      ? {}
      : { isRealtime: input.transitRoute.isRealtime }),
    ...(input.transitRoute.isPartial === undefined
      ? {}
      : { isPartial: input.transitRoute.isPartial }),
    ...(input.transitRoute.estimationNotes === undefined
      ? {}
      : { estimationNotes: input.transitRoute.estimationNotes }),
    legs,
  });

  return {
    route,
    kind: input.kind,
    connectionPenalty: Math.min(
      1,
      0.3 +
        connectionGapMeters / 500 +
        (1 - Math.min(Math.max(input.confidence, 0), 1)) * 0.2,
    ),
    connectionGapMeters,
    resolutionConfidence: input.confidence,
    sourcePlace: input.sourcePlace,
    failedChecks: [],
  };
}

export class CandidateGenerator {
  readonly #provider: MobilityProvider;
  readonly #resolutionCache: MemoryCache;

  public constructor(
    provider: MobilityProvider,
    resolutionCache = new MemoryCache(16 * 1024 * 1024),
  ) {
    this.#provider = provider;
    this.#resolutionCache = resolutionCache;
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
      connectionPenalty: 0,
      connectionGapMeters: 0,
      failedChecks: [],
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

    const targetTripDistance = calculateTargetWalkDistanceMeters(
      remainingSteps,
      request.strideLengthMeters,
    );
    const additionalNeededDistance = Math.max(
      targetTripDistance - baseline.walkDistanceMeters,
      0,
    );
    const desiredDirectDistance = Math.max(
      300,
      additionalNeededDistance * 0.75,
    );
    const resolver = new StopResolver(
      this.#provider,
      budget,
      this.#resolutionCache,
    );
    const stopTasks = extractStopTasks(sortedBaselineRoutes);
    const resolvedStops = await Promise.all(
      stopTasks.map((task) =>
        resolver.resolve(
          task.stopName,
          request.destination.location,
          task.routeLine,
          signal,
        ),
      ),
    );
    const rankedStops = rankResolvedPlaces(
      resolvedStops,
      request.destination.location,
      desiredDirectDistance,
    ).slice(0, 4);

    let candidateFailureCount = 0;
    let exerciseCandidateCount = 0;

    const buildCandidate = async (
      place: Place,
      kind: "EARLY_EXIT" | "POI_FALLBACK",
      confidence: number,
    ): Promise<RouteCandidate | null> => {
      try {
        const [transitRoutes, walkingRoute] = await Promise.all([
          budget.transit(request.origin, place, signal),
          budget.walk(place.location, request.destination.location, signal),
        ]);
        const transitRoute = [...transitRoutes].sort(
          (first, second) => first.durationSeconds - second.durationSeconds,
        )[0];
        if (transitRoute === undefined) {
          candidateFailureCount += 1;
          return null;
        }
        const combined = combineRoutes({
          transitRoute,
          walkingRoute,
          destination: request.destination.location,
          sourcePlace: place,
          kind,
          confidence,
        });
        if (combined === null) {
          candidateFailureCount += 1;
        }
        return combined;
      } catch (error) {
        candidateFailureCount += 1;
        if (
          error instanceof ProviderError &&
          error.kind === "ABORTED"
        ) {
          throw error;
        }
        return null;
      }
    };

    const earlyCandidates = await Promise.all(
      rankedStops
        .slice(0, budget.remainingCandidatePairs)
        .map((stop) =>
          buildCandidate(stop.place, "EARLY_EXIT", stop.confidence),
        ),
    );
    for (const candidate of earlyCandidates) {
      if (candidate !== null) {
        candidates.push(candidate);
        exerciseCandidateCount += 1;
      }
    }

    if (
      exerciseCandidateCount < 2 &&
      budget.remainingCandidatePairs > 0
    ) {
      const poiSearches = ["공원", "광장", "역", "공공시설"].map((query) =>
        budget.placeSearch(() =>
          this.#provider.searchPlaces(query, {
            center: request.destination.location,
            limit: 5,
            radiusMeters: Math.min(
              20_000,
              Math.max(1000, desiredDirectDistance * 2),
            ),
            ...(signal === undefined ? {} : { signal }),
          }),
        ),
      );
      const poiResults = (await Promise.all(poiSearches)).flat();
      const uniquePois = new Map<string, Place>();
      for (const place of poiResults) {
        if (
          !/공원|광장|역|공공|수목원/u.test(
            `${place.name} ${place.category}`,
          ) ||
          /백화점|쇼핑|병원|학교|아파트/u.test(
            `${place.name} ${place.category}`,
          )
        ) {
          continue;
        }
        if (
          haversineDistanceMeters(
            place.location,
            request.destination.location,
          ) < 100
        ) {
          continue;
        }
        uniquePois.set(place.id, place);
      }
      const poiCandidates = [...uniquePois.values()]
        .map((place) => ({
          place,
          fit:
            Math.abs(
              haversineDistanceMeters(
                place.location,
                request.destination.location,
              ) - desiredDirectDistance,
            ) / Math.max(desiredDirectDistance, 300),
        }))
        .sort((first, second) => first.fit - second.fit)
        .slice(
          0,
          Math.min(
            2,
            budget.remainingCandidatePairs,
            4 - exerciseCandidateCount,
          ),
        );
      const fallbackCandidates = await Promise.all(
        poiCandidates.map(({ place }) =>
          buildCandidate(place, "POI_FALLBACK", 0.75),
        ),
      );
      for (const candidate of fallbackCandidates) {
        if (candidate !== null) {
          candidates.push(candidate);
        }
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
