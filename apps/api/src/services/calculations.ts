import type {
  LegacyRecommendationRequest,
  NormalizedRoute,
  RecommendationRequest,
} from "@chimap/contracts";
import { HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND } from "@chimap/contracts";

import type { RouteCandidate } from "./candidate-generator.js";

export type StepMetrics = {
  remainingSteps: number;
  targetTripWalkDistanceMeters: number;
  routeEstimatedSteps: number;
  baseEstimatedSteps: number;
  additionalNeededDistanceMeters: number;
  shortfallCoverageRate: number;
  expectedTotalStepsAfterTrip: number;
  dailyGoalCompletionRate: number;
};

export type EvaluatedCandidate = RouteCandidate & {
  arrivalAt: Date;
  extraMinutesRaw: number;
  estimatedSteps: number;
  expectedTotalSteps: number;
  dailyGoalCompletionRate: number;
  shortfallCoverageRate: number;
  deadlineSatisfied: boolean;
  extraTimeSatisfied: boolean;
};

export type RecommendationPolicy = {
  mode: "AUTO" | "LEGACY";
  maxExtraMinutes: number;
  effectiveDeadline?: Date;
};

export function isLegacyRecommendationRequest(
  request: RecommendationRequest,
): request is LegacyRecommendationRequest {
  return "deadline" in request;
}

export function calculateAutomaticMaxExtraMinutes(
  request: RecommendationRequest,
  baseline: NormalizedRoute,
): number {
  const remainingSteps = calculateRemainingSteps(
    request.currentSteps,
    request.goalSteps,
  );
  const targetWalkDistanceMeters = calculateTargetWalkDistanceMeters(
    remainingSteps,
    request.walkingMetric.stepLengthMeters,
  );
  const missingWalkDistanceMeters = Math.max(
    targetWalkDistanceMeters - baseline.walkDistanceMeters,
    0,
  );
  const walkingSpeedMetersPerSecond =
    HEALTHY_STEP_LENGTH_STUDY_SPEED_CM_PER_SECOND / 100;
  const missingWalkMinutes =
    missingWalkDistanceMeters / walkingSpeedMetersPerSecond / 60;
  const calculatedMinutes = Math.ceil(missingWalkMinutes * 1.25 + 5);
  return Math.min(90, Math.max(15, calculatedMinutes));
}

export function resolveRecommendationPolicy(
  request: RecommendationRequest,
  baseline: NormalizedRoute,
): RecommendationPolicy {
  if (isLegacyRecommendationRequest(request)) {
    return {
      mode: "LEGACY",
      maxExtraMinutes: request.maxExtraMinutes,
      effectiveDeadline: new Date(
        new Date(request.deadline).getTime() -
          request.safetyBufferMinutes * 60_000,
      ),
    };
  }
  return {
    mode: "AUTO",
    maxExtraMinutes: calculateAutomaticMaxExtraMinutes(request, baseline),
  };
}

export function calculateRemainingSteps(
  currentSteps: number,
  goalSteps: number,
): number {
  return Math.max(goalSteps - currentSteps, 0);
}

export function calculateTargetWalkDistanceMeters(
  remainingSteps: number,
  stepLengthMeters: number,
): number {
  return (
    Math.round(remainingSteps * stepLengthMeters * 1_000_000) / 1_000_000
  );
}

export function estimateSteps(
  walkDistanceMeters: number,
  stepLengthMeters: number,
): number {
  if (stepLengthMeters <= 0 || !Number.isFinite(stepLengthMeters)) {
    throw new RangeError("보폭은 0보다 큰 유한한 값이어야 합니다.");
  }
  return Math.round(walkDistanceMeters / stepLengthMeters);
}

export function calculateStepMetrics(
  request: RecommendationRequest,
  route: NormalizedRoute,
  baseline: NormalizedRoute,
): StepMetrics {
  const remainingSteps = calculateRemainingSteps(
    request.currentSteps,
    request.goalSteps,
  );
  const targetTripWalkDistanceMeters = calculateTargetWalkDistanceMeters(
    remainingSteps,
    request.walkingMetric.stepLengthMeters,
  );
  const routeEstimatedSteps = estimateSteps(
    route.walkDistanceMeters,
    request.walkingMetric.stepLengthMeters,
  );
  const baseEstimatedSteps = estimateSteps(
    baseline.walkDistanceMeters,
    request.walkingMetric.stepLengthMeters,
  );
  const additionalNeededDistanceMeters = Math.max(
    targetTripWalkDistanceMeters - baseline.walkDistanceMeters,
    0,
  );
  const shortfallCoverageRate =
    remainingSteps === 0
      ? 1
      : Math.min(routeEstimatedSteps / remainingSteps, 1);
  const expectedTotalStepsAfterTrip =
    request.currentSteps + routeEstimatedSteps;
  const dailyGoalCompletionRate = Math.min(
    expectedTotalStepsAfterTrip / request.goalSteps,
    1,
  );

  return {
    remainingSteps,
    targetTripWalkDistanceMeters,
    routeEstimatedSteps,
    baseEstimatedSteps,
    additionalNeededDistanceMeters,
    shortfallCoverageRate,
    expectedTotalStepsAfterTrip,
    dailyGoalCompletionRate,
  };
}

export function evaluateCandidate(
  candidate: RouteCandidate,
  baseline: NormalizedRoute,
  request: RecommendationRequest,
  departureAt: Date,
  policy: RecommendationPolicy,
): EvaluatedCandidate {
  const metrics = calculateStepMetrics(request, candidate.route, baseline);
  const arrivalAt = new Date(
    departureAt.getTime() + candidate.route.durationSeconds * 1000,
  );
  const extraMinutesRaw =
    (candidate.route.durationSeconds - baseline.durationSeconds) / 60;
  const deadlineSatisfied =
    policy.effectiveDeadline === undefined ||
    arrivalAt.getTime() <= policy.effectiveDeadline.getTime();
  const extraTimeSatisfied =
    candidate.route.durationSeconds <=
    baseline.durationSeconds + policy.maxExtraMinutes * 60;
  return {
    ...candidate,
    arrivalAt,
    extraMinutesRaw,
    estimatedSteps: metrics.routeEstimatedSteps,
    expectedTotalSteps: metrics.expectedTotalStepsAfterTrip,
    dailyGoalCompletionRate: metrics.dailyGoalCompletionRate,
    shortfallCoverageRate: metrics.shortfallCoverageRate,
    deadlineSatisfied,
    extraTimeSatisfied,
  };
}
