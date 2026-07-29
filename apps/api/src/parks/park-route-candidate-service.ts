import {
  haversineDistanceMeters,
  type Coordinate,
  type Recommendation,
  type RecommendationRequest,
  type RouteLeg,
} from "@chimap/contracts";
import type { Logger } from "pino";

import type { MobilityProvider } from "../providers/types.js";
import type { RecommendationPolicy } from "../services/calculations.js";
import { ParkRouteRepository } from "./park-route-repository.js";

function legEndpoints(leg: RouteLeg): [Coordinate, Coordinate] | null {
  const start = leg.coordinates[0];
  const end = leg.coordinates.at(-1);
  return start === undefined || end === undefined ? null : [start, end];
}

function connectorLegs(
  route: Awaited<ReturnType<MobilityProvider["getWalkingRoute"]>>,
  prefix: string,
): RouteLeg[] {
  return route.legs.map((leg, index) => ({
    ...leg,
    id: `${prefix}-${index}`,
    walkingRole: "ACCESS" as const,
    isExerciseSegment: false,
  }));
}

export class ParkRouteCandidateService {
  public constructor(
    private readonly options: {
      enabled: boolean;
      radiusMeters: number;
      maxCandidates: number;
      repository: ParkRouteRepository;
      provider: MobilityProvider;
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

    const eligible = goal.legs
      .map((leg, index) => ({ leg, index, endpoints: legEndpoints(leg) }))
      .filter(
        (item) =>
          item.leg.mode === "WALK" &&
          item.leg.walkingRole !== "TRANSFER" &&
          item.endpoints !== null,
      );
    if (eligible.length === 0) return input.recommendations;

    try {
      const searched = await Promise.all(
        eligible.map(async ({ endpoints, index }) => ({
          index,
          directions: await this.options.repository.findNearSegment({
            start: endpoints![0],
            end: endpoints![1],
            radiusMeters: this.options.radiusMeters,
            limit: this.options.maxCandidates,
          }),
        })),
      );
      const ranked = searched
        .flatMap(({ index, directions }) =>
          directions.map((direction) => {
            const endpoints = eligible.find(
              (item) => item.index === index,
            )!.endpoints!;
            return {
              index,
              direction,
              approximateDistance:
                haversineDistanceMeters(endpoints[0], direction.entry) *
                  1.25 +
                direction.distanceMeters +
                haversineDistanceMeters(direction.exit, endpoints[1]) *
                  1.25,
            };
          }),
        )
        .sort((left, right) => {
          const fixedWalk =
            goal.walkDistanceMeters -
            goal.legs[left.index]!.distanceMeters;
          const remaining = Math.max(
            input.request.goalSteps - input.request.currentSteps,
            0,
          );
          const target = remaining * input.request.walkingMetric.stepLengthMeters;
          return (
            Math.abs(fixedWalk + left.approximateDistance - target) -
            Math.abs(fixedWalk + right.approximateDistance - target)
          );
        });
      this.options.logger.info({
        event: "park-route.candidates",
        requestId: input.requestId,
        candidateCount: ranked.length,
      });
      const selected = ranked[0];
      if (selected === undefined) return input.recommendations;
      const originalLeg = goal.legs[selected.index]!;
      const endpoints = legEndpoints(originalLeg)!;
      const [access, egress] = await Promise.all([
        this.options.provider.getWalkingRoute({
          origin: endpoints[0],
          destination: selected.direction.entry,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
        this.options.provider.getWalkingRoute({
          origin: selected.direction.exit,
          destination: endpoints[1],
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        }),
      ]);
      const parkLeg: RouteLeg = {
        id: `park-${selected.direction.routeId}${selected.direction.reversed ? "-reverse" : ""}`,
        mode: "WALK",
        name: `${selected.direction.parkName} 운동 경로`,
        guidance: `${selected.direction.parkName} 내부 산책로를 따라 이동하세요.`,
        distanceMeters: selected.direction.distanceMeters,
        durationSeconds: selected.direction.durationSeconds,
        coordinates: selected.direction.coordinates,
        geometryQuality: "DETAILED",
        isExerciseSegment: true,
        walkingRole: "PARK_DETOUR",
        parkRoute: {
          routeId: selected.direction.routeId,
          officialParkId: selected.direction.officialParkId,
          parkName: selected.direction.parkName,
          datasetId: selected.direction.datasetId,
        },
      };
      const replacement = [
        ...connectorLegs(access, `${parkLeg.id}-access`),
        parkLeg,
        ...connectorLegs(egress, `${parkLeg.id}-egress`),
      ];
      const legs = [
        ...goal.legs.slice(0, selected.index),
        ...replacement,
        ...goal.legs.slice(selected.index + 1),
      ];
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
      const remainingSteps = Math.max(
        input.request.goalSteps - input.request.currentSteps,
        0,
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
        reason: "공원 산책을 포함해 남은 걸음 수에 더 가까운 경로예요.",
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
      });
      return result;
    } catch {
      this.options.logger.info({
        event: "park-route.goal",
        requestId: input.requestId,
        candidateBuilt: false,
        included: false,
      });
      return input.recommendations;
    }
  }
}
