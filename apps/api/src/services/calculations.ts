import type {
  NormalizedRoute,
  RecommendationRequest,
} from "@chimap/contracts";

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
  stepError: number;
  timePenalty: number;
  transferPenalty: number;
  balancedScore: number;
};

export function calculateRemainingSteps(
  currentSteps: number,
  goalSteps: number,
): number {
  return Math.max(goalSteps - currentSteps, 0);
}

export function calculateTargetWalkDistanceMeters(
  remainingSteps: number,
  strideLengthMeters: number,
): number {
  return (
    Math.round(remainingSteps * strideLengthMeters * 1_000_000) / 1_000_000
  );
}

export function estimateSteps(
  walkDistanceMeters: number,
  strideLengthMeters: number,
): number {
  if (strideLengthMeters <= 0 || !Number.isFinite(strideLengthMeters)) {
    throw new RangeError("보폭은 0보다 큰 유한한 값이어야 합니다.");
  }
  return Math.round(walkDistanceMeters / strideLengthMeters);
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
    request.strideLengthMeters,
  );
  const routeEstimatedSteps = estimateSteps(
    route.walkDistanceMeters,
    request.strideLengthMeters,
  );
  const baseEstimatedSteps = estimateSteps(
    baseline.walkDistanceMeters,
    request.strideLengthMeters,
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
): EvaluatedCandidate {
  const metrics = calculateStepMetrics(request, candidate.route, baseline);
  const arrivalAt = new Date(
    departureAt.getTime() + candidate.route.durationSeconds * 1000,
  );
  const effectiveDeadline = new Date(
    new Date(request.deadline).getTime() -
      request.safetyBufferMinutes * 60_000,
  );
  const extraMinutesRaw =
    (candidate.route.durationSeconds - baseline.durationSeconds) / 60;
  const deadlineSatisfied =
    arrivalAt.getTime() <= effectiveDeadline.getTime();
  const extraTimeSatisfied =
    candidate.route.durationSeconds <=
    baseline.durationSeconds + request.maxExtraMinutes * 60;
  const stepError = Math.min(
    Math.abs(metrics.routeEstimatedSteps - metrics.remainingSteps) /
      Math.max(metrics.remainingSteps, 1000),
    1,
  );
  const timePenalty = Math.min(
    Math.max(extraMinutesRaw, 0) / Math.max(request.maxExtraMinutes, 1),
    1,
  );
  const transferPenalty = Math.min(candidate.route.transferCount / 3, 1);
  const balancedScore =
    0.55 * stepError +
    0.3 * timePenalty +
    0.1 * transferPenalty +
    0.05 * Math.min(Math.max(candidate.connectionPenalty, 0), 1);

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
    stepError,
    timePenalty,
    transferPenalty,
    balancedScore,
  };
}
