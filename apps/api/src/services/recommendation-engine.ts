import type {
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
  RecommendationType,
} from "@chimap/contracts";

import {
  calculateRemainingSteps,
  evaluateCandidate,
  type EvaluatedCandidate,
  type RecommendationPolicy,
} from "./calculations.js";
import type { RouteCandidate } from "./candidate-generator.js";
import { deduplicateRoutes } from "./route-deduplicator.js";

export type RecommendationSelection = {
  recommendations: Recommendation[];
  primaryRecommendationId?: string;
  validCandidateCount: number;
  goalReachable: boolean;
  diversityReduced: boolean;
};

const TYPE_COPY: Record<
  RecommendationType,
  { title: string; reason: string }
> = {
  FAST: {
    title: "빠른 경로",
    reason: "지금 출발 기준 가장 빠르게 도착해요.",
  },
  BALANCED: {
    title: "균형 경로",
    reason: "추가시간과 부족한 걸음을 균형 있게 맞췄어요.",
  },
  GOAL: {
    title: "목표 달성 경로",
    reason: "남은 걸음 수에 가장 가까운 경로예요.",
  },
};

function byFastest(
  first: EvaluatedCandidate,
  second: EvaluatedCandidate,
): number {
  return (
    first.route.durationSeconds - second.route.durationSeconds ||
    first.route.walkDistanceMeters - second.route.walkDistanceMeters
  );
}

function byGoal(
  remainingSteps: number,
): (first: EvaluatedCandidate, second: EvaluatedCandidate) => number {
  return (first, second) =>
    Math.abs(first.estimatedSteps - remainingSteps) -
      Math.abs(second.estimatedSteps - remainingSteps) ||
    byFastest(first, second);
}

function byBalanced(
  first: EvaluatedCandidate,
  second: EvaluatedCandidate,
): number {
  return first.balancedScore - second.balancedScore || byFastest(first, second);
}

function toRecommendation(
  candidate: EvaluatedCandidate,
  type: RecommendationType,
  remainingSteps: number,
): Recommendation {
  const copy = TYPE_COPY[type];
  const stepDifference =
    remainingSteps === 0 ? 0 : candidate.estimatedSteps - remainingSteps;
  const toleranceSteps = Math.round(remainingSteps * 0.05);
  return {
    id: candidate.route.id,
    type,
    title: copy.title,
    reason: copy.reason,
    durationSeconds: candidate.route.durationSeconds,
    arrivalAt: candidate.arrivalAt.toISOString(),
    extraMinutes: Math.max(0, Math.round(candidate.extraMinutesRaw)),
    walkDistanceMeters: candidate.route.walkDistanceMeters,
    estimatedSteps: candidate.estimatedSteps,
    stepDifference,
    goalFit:
      Math.abs(stepDifference) <= toleranceSteps
        ? "WITHIN_TOLERANCE"
        : stepDifference < 0
          ? "UNDER"
          : "OVER",
    expectedTotalSteps: candidate.expectedTotalSteps,
    dailyGoalCompletionRate: candidate.dailyGoalCompletionRate,
    shortfallCoverageRate: candidate.shortfallCoverageRate,
    transferCount: candidate.route.transferCount,
    ...(candidate.route.fareWon === undefined
      ? {}
      : { fareWon: candidate.route.fareWon }),
    ...(candidate.route.waitingDurationSeconds === undefined
      ? {}
      : {
          waitingDurationSeconds:
            candidate.route.waitingDurationSeconds,
        }),
    ...(candidate.route.ridingDurationSeconds === undefined
      ? {}
      : {
          ridingDurationSeconds:
            candidate.route.ridingDurationSeconds,
        }),
    ...(candidate.route.isRealtime === undefined
      ? {}
      : { isRealtime: candidate.route.isRealtime }),
    ...(candidate.route.isPartial === undefined
      ? {}
      : { isPartial: candidate.route.isPartial }),
    ...(candidate.route.estimationNotes === undefined
      ? {}
      : { estimationNotes: candidate.route.estimationNotes }),
    legs: candidate.route.legs,
  };
}

export function selectRecommendations(input: {
  candidates: RouteCandidate[];
  baseline: NormalizedRoute;
  request: RecommendationRequest;
  departureAt: Date;
  policy: RecommendationPolicy;
}): RecommendationSelection {
  const evaluated = input.candidates
    .map((candidate) =>
      evaluateCandidate(
        candidate,
        input.baseline,
        input.request,
        input.departureAt,
        input.policy,
      ),
    )
    .filter(
      (candidate) =>
        candidate.deadlineSatisfied && candidate.extraTimeSatisfied,
    )
    .sort(byFastest);
  const unique = deduplicateRoutes(evaluated);
  const remainingSteps = calculateRemainingSteps(
    input.request.currentSteps,
    input.request.goalSteps,
  );
  const toleranceSteps = Math.round(remainingSteps * 0.05);
  const goalReachable =
    remainingSteps === 0 ||
    unique.some(
      (candidate) =>
        Math.abs(candidate.estimatedSteps - remainingSteps) <=
        toleranceSteps,
    );

  if (unique.length === 0) {
    return {
      recommendations: [],
      validCandidateCount: 0,
      goalReachable: false,
      diversityReduced: false,
    };
  }

  const selected = new Map<RecommendationType, EvaluatedCandidate>();
  const usedIds = new Set<string>();

  const fast = [...unique].sort(byFastest)[0]!;
  selected.set("FAST", fast);
  usedIds.add(fast.route.id);

  if (remainingSteps > 0) {
    const goal = [...unique]
      .sort(byGoal(remainingSteps))
      .find((candidate) => !usedIds.has(candidate.route.id));
    if (goal !== undefined) {
      selected.set("GOAL", goal);
      usedIds.add(goal.route.id);
    }

    const balanced = [...unique]
      .sort(byBalanced)
      .find((candidate) => !usedIds.has(candidate.route.id));
    if (balanced !== undefined) {
      selected.set("BALANCED", balanced);
      usedIds.add(balanced.route.id);
    }
  }

  const typeOrder: RecommendationType[] = ["FAST", "BALANCED", "GOAL"];
  const recommendations = typeOrder.flatMap((type) => {
    const candidate = selected.get(type);
    return candidate === undefined
      ? []
      : [toRecommendation(candidate, type, remainingSteps)];
  });
  const primaryRecommendationId =
    recommendations.find((item) => item.type === "GOAL")?.id ??
    recommendations.find((item) => item.type === "BALANCED")?.id ??
    recommendations[0]?.id;

  return {
    recommendations,
    ...(primaryRecommendationId === undefined
      ? {}
      : { primaryRecommendationId }),
    validCandidateCount: unique.length,
    goalReachable,
    diversityReduced: recommendations.length < Math.min(3, unique.length),
  };
}
