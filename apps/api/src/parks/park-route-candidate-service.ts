import {
  HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND,
  haversineDistanceMeters,
  type Coordinate,
  type Recommendation,
  type RecommendationRequest,
  type RouteLeg,
} from "@chimap/contracts";
import type { Logger } from "pino";

import type { WalkingRouteProvider } from "../providers/types.js";
import type { RecommendationPolicy } from "../services/calculations.js";
import { hasExactInsertedWalkingAttribution } from "../services/walking-attribution.js";
import {
  ParkRouteRepository,
  type ParkRouteDirection,
} from "./park-route-repository.js";

const MIN_ROUTE_PROGRESS = 0.1;
const MAX_ROUTE_PROGRESS = 0.9;
const DIRECT_CONNECTOR_METERS = 20;

type RouteAnchor = {
  coordinate: Coordinate;
  prefixCoordinates: Coordinate[];
  suffixCoordinates: Coordinate[];
  legRatio: number;
  routeProgress: number;
};

type EligibleWalkingLeg = {
  leg: RouteLeg;
  index: number;
  anchors: RouteAnchor[];
};

function pathDistanceMeters(coordinates: readonly Coordinate[]): number {
  let distance = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    distance += haversineDistanceMeters(
      coordinates[index - 1]!,
      coordinates[index]!,
    );
  }
  return distance;
}

function midpoint(start: Coordinate, end: Coordinate): Coordinate {
  return {
    lng: (start.lng + end.lng) / 2,
    lat: (start.lat + end.lat) / 2,
  };
}

function routeAnchors(input: {
  leg: RouteLeg;
  distanceBeforeLeg: number;
  totalRouteDistance: number;
}): RouteAnchor[] {
  const { leg, distanceBeforeLeg, totalRouteDistance } = input;
  const coordinates = leg.coordinates;
  if (coordinates.length < 2 || totalRouteDistance <= 0) return [];

  const candidates: Array<{
    coordinate: Coordinate;
    prefixCoordinates: Coordinate[];
    suffixCoordinates: Coordinate[];
    legRatio: number;
  }> = [];
  const geometryDistance = pathDistanceMeters(coordinates);

  if (coordinates.length === 2) {
    const anchor = midpoint(coordinates[0]!, coordinates[1]!);
    candidates.push({
      coordinate: anchor,
      prefixCoordinates: [coordinates[0]!, anchor],
      suffixCoordinates: [anchor, coordinates[1]!],
      legRatio: 0.5,
    });
  } else {
    let distanceAlongGeometry = 0;
    for (let index = 1; index < coordinates.length - 1; index += 1) {
      distanceAlongGeometry += haversineDistanceMeters(
        coordinates[index - 1]!,
        coordinates[index]!,
      );
      candidates.push({
        coordinate: coordinates[index]!,
        prefixCoordinates: coordinates.slice(0, index + 1),
        suffixCoordinates: coordinates.slice(index),
        legRatio:
          geometryDistance > 0
            ? distanceAlongGeometry / geometryDistance
            : index / (coordinates.length - 1),
      });
    }
  }

  return candidates.flatMap((candidate) => {
    const routeProgress =
      (distanceBeforeLeg + leg.distanceMeters * candidate.legRatio) /
      totalRouteDistance;
    return routeProgress >= MIN_ROUTE_PROGRESS &&
      routeProgress <= MAX_ROUTE_PROGRESS
      ? [{ ...candidate, routeProgress }]
      : [];
  });
}

function connectorLegs(
  route: Awaited<ReturnType<WalkingRouteProvider["getWalkingRoute"]>>,
  prefix: string,
): RouteLeg[] {
  return route.legs.map((leg, index) => ({
    ...leg,
    id: `${prefix}-${index}`,
    walkingRole: "PARK_CONNECTOR" as const,
    isExerciseSegment: true,
  }));
}

function approximateConnectorLeg(
  origin: Coordinate,
  destination: Coordinate,
  id: string,
): RouteLeg {
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
  return {
    id,
    mode: "WALK",
    guidance: "공원 연결 도보 이동 (근사 경로)",
    distanceMeters,
    durationSeconds,
    coordinates: [origin, destination],
    geometryQuality: "APPROXIMATE",
    walkingRole: "PARK_CONNECTOR",
    isExerciseSegment: true,
  };
}

function splitWalkingLeg(
  leg: RouteLeg,
  anchor: RouteAnchor,
): { prefix: RouteLeg; suffix: RouteLeg } {
  const prefixDistance = Math.round(leg.distanceMeters * anchor.legRatio);
  const prefixDuration = Math.round(leg.durationSeconds * anchor.legRatio);
  const idBase = leg.id.slice(0, 160);
  return {
    prefix: {
      ...leg,
      id: `${idBase}:park-prefix`,
      distanceMeters: prefixDistance,
      durationSeconds: prefixDuration,
      coordinates: anchor.prefixCoordinates,
    },
    suffix: {
      ...leg,
      id: `${idBase}:park-suffix`,
      distanceMeters: leg.distanceMeters - prefixDistance,
      durationSeconds: leg.durationSeconds - prefixDuration,
      coordinates: anchor.suffixCoordinates,
    },
  };
}

function endpointDistanceMeters(
  direction: ParkRouteDirection,
  point: Coordinate,
): number {
  return Math.min(
    haversineDistanceMeters(direction.entry, point),
    haversineDistanceMeters(direction.exit, point),
  );
}

function parkLeg(direction: ParkRouteDirection): RouteLeg {
  return {
    id: `park-${direction.routeId}${direction.reversed ? "-reverse" : ""}`,
    mode: "WALK",
    name: `${direction.parkName} 운동 경로`,
    guidance: `${direction.parkName} 내부 산책로를 따라 이동하세요.`,
    distanceMeters: direction.distanceMeters,
    durationSeconds: direction.durationSeconds,
    coordinates: direction.coordinates,
    geometryQuality: "DETAILED",
    isExerciseSegment: true,
    walkingRole: "PARK_DETOUR",
    parkRoute: {
      routeId: direction.routeId,
      officialParkId: direction.officialParkId,
      parkName: direction.parkName,
      datasetId: direction.datasetId,
    },
  };
}

export class ParkRouteCandidateService {
  public constructor(
    private readonly options: {
      enabled: boolean;
      radiusMeters: number;
      maxCandidates: number;
      repository: ParkRouteRepository;
      provider: WalkingRouteProvider;
      logger: Logger;
    },
  ) {}

  public async improveGoal(input: {
    recommendations: Recommendation[];
    request: RecommendationRequest;
    requestId: string;
    baselineDurationSeconds: number;
    policy: RecommendationPolicy;
    departureAt: Date;
    remainingRouteApiCalls: number;
    signal?: AbortSignal;
  }): Promise<Recommendation[]> {
    if (!this.options.enabled || input.remainingRouteApiCalls < 2) {
      return input.recommendations;
    }
    const goalIndex = input.recommendations.findIndex(
      (recommendation) => recommendation.type === "GOAL",
    );
    const goal = input.recommendations[goalIndex];
    if (goal === undefined) return input.recommendations;

    const totalRouteDistance = goal.legs.reduce(
      (sum, leg) => sum + leg.distanceMeters,
      0,
    );
    let distanceBeforeLeg = 0;
    const eligible: EligibleWalkingLeg[] = [];
    goal.legs.forEach((leg, index) => {
      if (leg.mode === "WALK" && leg.walkingRole !== "TRANSFER") {
        const anchors = routeAnchors({
          leg,
          distanceBeforeLeg,
          totalRouteDistance,
        });
        if (anchors.length > 0) eligible.push({ leg, index, anchors });
      }
      distanceBeforeLeg += leg.distanceMeters;
    });
    if (eligible.length === 0) return input.recommendations;

    try {
      const searched = await Promise.all(
        eligible.map(async ({ leg, index, anchors }) => ({
          index,
          anchors,
          directions: await this.options.repository.findNearRoute({
            coordinates: leg.coordinates,
            radiusMeters: this.options.radiusMeters,
            limit: this.options.maxCandidates,
          }),
        })),
      );
      const remainingSteps = Math.max(
        input.request.goalSteps - input.request.currentSteps,
        0,
      );
      const targetWalkDistance =
        remainingSteps * input.request.walkingMetric.stepLengthMeters;
      const endpointExclusionMeters = Math.min(
        300,
        this.options.radiusMeters,
      );
      const ranked = searched
        .flatMap(({ index, anchors, directions }) =>
          directions.flatMap((direction) => {
            if (
              endpointDistanceMeters(direction, input.request.origin.location) <
                endpointExclusionMeters ||
              endpointDistanceMeters(
                direction,
                input.request.destination.location,
              ) < endpointExclusionMeters
            ) {
              return [];
            }
            const anchored = anchors
              .map((anchor) => {
                const approximateConnectorDistance =
                  (haversineDistanceMeters(anchor.coordinate, direction.entry) +
                    haversineDistanceMeters(
                      direction.exit,
                      anchor.coordinate,
                    )) *
                  1.25;
                const approximateAddedDistance =
                  approximateConnectorDistance + direction.distanceMeters;
                return {
                  index,
                  anchor,
                  direction,
                  approximateAddedDistance,
                  approximateDifference: Math.abs(
                    goal.walkDistanceMeters +
                      approximateAddedDistance -
                      targetWalkDistance,
                  ),
                };
              })
              .sort(
                (left, right) =>
                  left.approximateDifference - right.approximateDifference ||
                  left.approximateAddedDistance - right.approximateAddedDistance,
              )[0];
            return anchored === undefined ? [] : [anchored];
          }),
        )
        .filter(
          (candidate) =>
            candidate.approximateDifference <
            Math.abs(goal.walkDistanceMeters - targetWalkDistance),
        )
        .sort(
          (left, right) =>
            left.approximateDifference - right.approximateDifference ||
            left.approximateAddedDistance - right.approximateAddedDistance,
        );
      this.options.logger.info({
        event: "park-route.candidates",
        requestId: input.requestId,
        candidateCount: ranked.length,
      });
      const selected = ranked[0];
      if (selected === undefined) return input.recommendations;

      const connector = async (
        origin: Coordinate,
        destination: Coordinate,
        prefix: string,
      ): Promise<RouteLeg[]> => {
        if (
          haversineDistanceMeters(origin, destination) <=
          DIRECT_CONNECTOR_METERS
        ) {
          return [];
        }
        try {
          const route = await this.options.provider.getWalkingRoute({
            origin,
            destination,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          });
          return connectorLegs(route, prefix);
        } catch (error) {
          if (input.signal?.aborted === true) {
            throw error;
          }
          this.options.logger.info({
            event: "park-route.connector-fallback",
            requestId: input.requestId,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage:
              error instanceof Error
                ? error.message
                : "Unknown park connector error",
          });
          return [approximateConnectorLeg(origin, destination, prefix)];
        }
      };
      const park = parkLeg(selected.direction);
      const [access, egress] = await Promise.all([
        connector(
          selected.anchor.coordinate,
          selected.direction.entry,
          `${park.id}-access`,
        ),
        connector(
          selected.direction.exit,
          selected.anchor.coordinate,
          `${park.id}-egress`,
        ),
      ]);
      const originalLeg = goal.legs[selected.index]!;
      const split = splitWalkingLeg(originalLeg, selected.anchor);
      const legs = [
        ...goal.legs.slice(0, selected.index),
        split.prefix,
        ...access,
        park,
        ...egress,
        split.suffix,
        ...goal.legs.slice(selected.index + 1),
      ];
      if (!hasExactInsertedWalkingAttribution({
        parentLegs: goal.legs,
        childLegs: legs,
        insertedLegs: [...access, park, ...egress],
      })) {
        throw new TypeError(
          "공원 후보의 추가 도보 거리를 운동 구간에 정확히 귀속하지 못했습니다.",
        );
      }
      const walkDistanceMeters = legs
        .filter((leg) => leg.mode === "WALK")
        .reduce((sum, leg) => sum + leg.distanceMeters, 0);
      const durationSeconds = legs.reduce(
        (sum, leg) => sum + leg.durationSeconds,
        0,
      );
      const estimatedSteps = Math.round(
        walkDistanceMeters / input.request.walkingMetric.stepLengthMeters,
      );
      const oldDifference = Math.abs(goal.estimatedSteps - remainingSteps);
      const newDifference = Math.abs(estimatedSteps - remainingSteps);
      const arrivalAt = new Date(
        input.departureAt.getTime() + durationSeconds * 1000,
      );
      const extraTimeSatisfied =
        durationSeconds <=
        input.baselineDurationSeconds + input.policy.maxExtraMinutes * 60;
      const deadlineSatisfied =
        input.policy.effectiveDeadline === undefined ||
        arrivalAt <= input.policy.effectiveDeadline;
      if (
        newDifference >= oldDifference ||
        !extraTimeSatisfied ||
        !deadlineSatisfied
      ) {
        return input.recommendations;
      }

      const stepDifference =
        remainingSteps === 0 ? 0 : estimatedSteps - remainingSteps;
      const toleranceSteps = Math.round(remainingSteps * 0.05);
      const improved: Recommendation = {
        ...goal,
        id: `${goal.id}:park:${selected.direction.routeId}${selected.direction.reversed ? ":reverse" : ""}`,
        reason: `경로 중간의 ${selected.direction.parkName} 산책로를 지나 남은 걸음 수에 더 가까운 경로예요.`,
        durationSeconds,
        arrivalAt: arrivalAt.toISOString(),
        extraMinutes: Math.max(
          0,
          Math.round(
            (durationSeconds - input.baselineDurationSeconds) / 60,
          ),
        ),
        walkDistanceMeters,
        estimatedSteps,
        stepDifference,
        goalFit:
          Math.abs(stepDifference) <= toleranceSteps
            ? "WITHIN_TOLERANCE"
            : stepDifference < 0
              ? "UNDER"
              : "OVER",
        expectedTotalSteps: input.request.currentSteps + estimatedSteps,
        dailyGoalCompletionRate: Math.min(
          (input.request.currentSteps + estimatedSteps) /
            input.request.goalSteps,
          1,
        ),
        shortfallCoverageRate:
          remainingSteps === 0
            ? 1
            : Math.min(estimatedSteps / remainingSteps, 1),
        legs,
      };
      const result = [...input.recommendations];
      result[goalIndex] = improved;
      this.options.logger.info({
        event: "park-route.goal",
        requestId: input.requestId,
        candidateBuilt: true,
        included: true,
        parkRouteId: selected.direction.routeId,
        routeProgress: selected.anchor.routeProgress,
      });
      return result;
    } catch (error) {
      if (input.signal?.aborted === true) {
        throw error;
      }
      this.options.logger.info({
        event: "park-route.goal",
        requestId: input.requestId,
        candidateBuilt: false,
        included: false,
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage:
          error instanceof Error ? error.message : "Unknown park route error",
      });
      return input.recommendations;
    }
  }
}
