import type {
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
  RecommendationType,
} from "@chimap/contracts";

import {
  calculateRemainingSteps,
  estimateSteps,
  evaluateCandidate,
  type EvaluatedCandidate,
  type RecommendationPolicy,
} from "./calculations.js";
import type {
  CandidateKind,
  RouteCandidate,
} from "./candidate-generator.js";
import { deduplicateRoutes } from "./route-deduplicator.js";

export type RecommendationSelection = {
  recommendations: Recommendation[];
  primaryRecommendationId?: string;
  validCandidateCount: number;
  goalReachable: boolean;
  diversityReduced: boolean;
};

export type FinalizedRecommendationSelection = {
  recommendations: Recommendation[];
  primaryRecommendationId?: string;
  goalReachable: boolean;
  goalDecision: GoalFinalizationDecision;
};

export type GoalValidationFailureReason =
  | "GOAL_ALREADY_REACHED"
  | "OUTSIDE_STEP_TOLERANCE"
  | "OUTSIDE_POLICY"
  | "NO_EXERCISE_WALK"
  | "EXERCISE_WALK_ROLE_INVALID"
  | "NO_SUBSTANTIAL_EXERCISE_WALK"
  | "EXERCISE_WALK_NOT_DETAILED"
  | "EXERCISE_WALK_DOES_NOT_COVER_INCREMENT";

export type GoalFinalizationDecision =
  | {
      outcome: "KEPT";
      originalGoalRecommendationId: string;
      finalGoalRecommendationId: string;
    }
  | {
      outcome: "PROMOTED";
      originalGoalRecommendationId?: string;
      finalGoalRecommendationId: string;
      promotedFromType: "BALANCED";
      rejectionReason?: GoalValidationFailureReason;
    }
  | {
      outcome: "REMOVED";
      originalGoalRecommendationId: string;
      rejectionReason: GoalValidationFailureReason;
    }
  | {
      outcome: "NOT_REQUIRED";
      originalGoalRecommendationId?: string;
      rejectionReason: "GOAL_ALREADY_REACHED";
    }
  | { outcome: "ABSENT" };

const TYPE_COPY: Record<
  RecommendationType,
  { title: string; reason: string }
> = {
  FAST: {
    title: "빠른 경로",
    reason: "지금 출발 기준 가장 빠르게 도착해요.",
  },
  BALANCED: {
    title: "2배 걸음 경로",
    reason: "가장 빠른 경로의 예상 걸음 수 약 두 배에 가장 가까워요.",
  },
  GOAL: {
    title: "목표 근접 경로",
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

function byDoubleSteps(
  fastEstimatedSteps: number,
): (first: EvaluatedCandidate, second: EvaluatedCandidate) => number {
  const targetSteps = fastEstimatedSteps * 2;
  return (first, second) =>
    Math.abs(first.estimatedSteps - targetSteps) -
      Math.abs(second.estimatedSteps - targetSteps) ||
    byFastest(first, second);
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

export function recalculateRecommendations(input: {
  recommendations: readonly Recommendation[];
  request: RecommendationRequest;
  departureAt: Date;
  baselineDurationSeconds: number;
}): Recommendation[] {
  const remainingSteps = calculateRemainingSteps(
    input.request.currentSteps,
    input.request.goalSteps,
  );
  const toleranceSteps = Math.round(remainingSteps * 0.05);
  return input.recommendations.map((recommendation) => {
    const durationSeconds = recommendation.legs.reduce(
      (total, leg) => total + leg.durationSeconds,
      0,
    );
    const walkDistanceMeters = recommendation.legs
      .filter((leg) => leg.mode === "WALK")
      .reduce((total, leg) => total + leg.distanceMeters, 0);
    const estimatedSteps = estimateSteps(
      walkDistanceMeters,
      input.request.walkingMetric.stepLengthMeters,
    );
    const stepDifference =
      remainingSteps === 0 ? 0 : estimatedSteps - remainingSteps;
    const expectedTotalSteps = input.request.currentSteps + estimatedSteps;
    return {
      ...recommendation,
      durationSeconds,
      arrivalAt: new Date(
        input.departureAt.getTime() + durationSeconds * 1_000,
      ).toISOString(),
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
          ? "WITHIN_TOLERANCE" as const
          : stepDifference < 0
            ? "UNDER" as const
            : "OVER" as const,
      expectedTotalSteps,
      dailyGoalCompletionRate: Math.min(
        expectedTotalSteps / input.request.goalSteps,
        1,
      ),
      shortfallCoverageRate:
        remainingSteps === 0
          ? 1
          : Math.min(estimatedSteps / remainingSteps, 1),
    };
  });
}

function satisfiesRecommendationPolicy(input: {
  recommendation: Recommendation;
  departureAt: Date;
  baselineDurationSeconds: number;
  policy: RecommendationPolicy;
}): boolean {
  const arrivalAt = new Date(
    input.departureAt.getTime() +
      input.recommendation.durationSeconds * 1_000,
  );
  return (
    input.recommendation.durationSeconds <=
      input.baselineDurationSeconds + input.policy.maxExtraMinutes * 60 &&
    (input.policy.effectiveDeadline === undefined ||
      arrivalAt.getTime() <= input.policy.effectiveDeadline.getTime())
  );
}

const SHORT_EXERCISE_WALK_METERS = 20;

function isGoalExerciseWalkingRole(
  role: Recommendation["legs"][number]["walkingRole"],
): boolean {
  return role === "GOAL_LATE_BOARDING" ||
    role === "GOAL_EARLY_ALIGHTING" ||
    role === "PARK_CONNECTOR" ||
    role === "PARK_DETOUR";
}

function inferCandidateKind(
  recommendation: Recommendation,
): CandidateKind {
  const roles = new Set(
    recommendation.legs.flatMap((leg) =>
      leg.mode === "WALK" && leg.walkingRole !== undefined
        ? [leg.walkingRole]
        : [],
    ),
  );
  const hasEarly = roles.has("GOAL_EARLY_ALIGHTING");
  const hasLate = roles.has("GOAL_LATE_BOARDING");
  if (hasEarly && hasLate) return "BOTH_ENDS";
  if (hasEarly) return "EARLY_ALIGHT";
  if (hasLate) return "LATE_BOARD";
  return "BASE";
}

function validateGoalCandidate(input: {
  recommendation: Recommendation;
  candidateKind?: CandidateKind;
  departureAt: Date;
  baselineDurationSeconds: number;
  policy: RecommendationPolicy;
  requireDetailedExerciseWalking: boolean;
}): GoalValidationFailureReason | undefined {
  const candidateKind =
    input.candidateKind ?? inferCandidateKind(input.recommendation);
  const intentionalWalking = input.recommendation.legs.filter(
    (leg) =>
      leg.mode === "WALK" &&
      (isGoalExerciseWalkingRole(leg.walkingRole) ||
        leg.parkRoute !== undefined),
  );
  if (intentionalWalking.some((leg) => !leg.isExerciseSegment)) {
    return "NO_EXERCISE_WALK";
  }

  // Keep causal exercise failures ahead of aggregate fit/policy failures so
  // provider degradation is not hidden by the numbers it made inaccurate.
  const markedExerciseWalking = input.recommendation.legs.filter(
    (leg) =>
      leg.mode === "WALK" &&
      leg.isExerciseSegment &&
      leg.distanceMeters > 0,
  );
  const requiresAdjustedExercise = candidateKind !== "BASE";
  const hasParkDetour = markedExerciseWalking.some(
    (leg) => leg.walkingRole === "PARK_DETOUR",
  );
  if (
    markedExerciseWalking.length === 0 &&
    (requiresAdjustedExercise || intentionalWalking.length > 0)
  ) {
    return "NO_EXERCISE_WALK";
  }
  if (markedExerciseWalking.some(
    (leg) => !isGoalExerciseWalkingRole(leg.walkingRole),
  )) {
    return "EXERCISE_WALK_ROLE_INVALID";
  }
  const roles = new Set(
    markedExerciseWalking.flatMap((leg) =>
      leg.walkingRole === undefined ? [] : [leg.walkingRole],
    ),
  );
  if (
    (candidateKind === "EARLY_ALIGHT" &&
      !roles.has("GOAL_EARLY_ALIGHTING")) ||
    (candidateKind === "LATE_BOARD" &&
      !roles.has("GOAL_LATE_BOARDING")) ||
    (candidateKind === "BOTH_ENDS" &&
      (!roles.has("GOAL_EARLY_ALIGHTING") ||
        !roles.has("GOAL_LATE_BOARDING"))) ||
    (candidateKind === "BASE" &&
      (roles.has("GOAL_EARLY_ALIGHTING") ||
        roles.has("GOAL_LATE_BOARDING"))) ||
    (roles.has("PARK_CONNECTOR") && !hasParkDetour)
  ) {
    return "EXERCISE_WALK_ROLE_INVALID";
  }

  const exerciseWalking = markedExerciseWalking;
  if (
    exerciseWalking.length > 0 &&
    !exerciseWalking.some(
      (leg) => leg.distanceMeters > SHORT_EXERCISE_WALK_METERS,
    )
  ) {
    return "NO_SUBSTANTIAL_EXERCISE_WALK";
  }
  if (
    input.requireDetailedExerciseWalking &&
    exerciseWalking.some(
      (leg) =>
        leg.distanceMeters > SHORT_EXERCISE_WALK_METERS &&
        leg.geometryQuality !== "DETAILED",
    )
  ) {
    return "EXERCISE_WALK_NOT_DETAILED";
  }

  if (!satisfiesRecommendationPolicy(input)) {
    return "OUTSIDE_POLICY";
  }
  return undefined;
}

function withRecommendationType(
  recommendation: Recommendation,
  type: RecommendationType,
): Recommendation {
  const copy = TYPE_COPY[type];
  return {
    ...recommendation,
    type,
    title: copy.title,
    reason: copy.reason,
  };
}

export function finalizeRecommendations(input: {
  recommendations: readonly Recommendation[];
  request: RecommendationRequest;
  departureAt: Date;
  baselineDurationSeconds: number;
  policy: RecommendationPolicy;
  requireDetailedExerciseWalking: boolean;
  candidateKindByRecommendationId?: ReadonlyMap<string, CandidateKind>;
}): FinalizedRecommendationSelection {
  const recalculated = recalculateRecommendations(input);
  const remainingSteps = calculateRemainingSteps(
    input.request.currentSteps,
    input.request.goalSteps,
  );
  const goalValidationFailure = (
    recommendation: Recommendation,
  ): GoalValidationFailureReason | undefined => {
    const candidateKind =
      input.candidateKindByRecommendationId?.get(recommendation.id);
    return validateGoalCandidate({
      recommendation,
      ...(candidateKind === undefined ? {} : { candidateKind }),
      departureAt: input.departureAt,
      baselineDurationSeconds: input.baselineDurationSeconds,
      policy: input.policy,
      requireDetailedExerciseWalking:
        input.requireDetailedExerciseWalking,
    });
  };
  const originalGoal = recalculated.find(
    (recommendation) => recommendation.type === "GOAL",
  );
  const originalGoalRejectionReason =
    originalGoal === undefined
      ? undefined
      : goalValidationFailure(originalGoal);
  const keepOriginalGoal =
    remainingSteps > 0 &&
    originalGoal !== undefined &&
    originalGoalRejectionReason === undefined;

  // FAST is the stable fallback and is never relabelled. If detailed geometry
  // makes the selected GOAL invalid, only an already-selected BALANCED route
  // with verified exercise walking may take the GOAL label.
  const promotableBalanced =
    remainingSteps <= 0 || keepOriginalGoal
      ? undefined
      : recalculated.find(
          (recommendation) =>
            recommendation.type === "BALANCED" &&
            goalValidationFailure(recommendation) === undefined,
        );
  const finalGoal = keepOriginalGoal ? originalGoal : promotableBalanced;
  const recommendations = recalculated.flatMap((recommendation) => {
    if (
      recommendation.type === "GOAL" &&
      recommendation.id !== finalGoal?.id
    ) {
      return [];
    }
    if (
      promotableBalanced !== undefined &&
      recommendation.id === promotableBalanced.id
    ) {
      return [withRecommendationType(recommendation, "GOAL")];
    }
    return [recommendation];
  });
  const primaryRecommendationId =
    remainingSteps > 0 && finalGoal !== undefined
      ? finalGoal.id
      : (recommendations.find(
          (recommendation) => recommendation.type === "FAST",
        )?.id ?? recommendations[0]?.id);
  const goalReachable =
    remainingSteps === 0 || finalGoal?.goalFit === "WITHIN_TOLERANCE";
  let goalDecision: GoalFinalizationDecision;
  if (remainingSteps === 0) {
    goalDecision = {
      outcome: "NOT_REQUIRED",
      ...(originalGoal === undefined
        ? {}
        : { originalGoalRecommendationId: originalGoal.id }),
      rejectionReason: "GOAL_ALREADY_REACHED",
    };
  } else if (
    originalGoal !== undefined &&
    originalGoalRejectionReason === undefined
  ) {
    goalDecision = {
      outcome: "KEPT",
      originalGoalRecommendationId: originalGoal.id,
      finalGoalRecommendationId: originalGoal.id,
    };
  } else if (promotableBalanced !== undefined) {
    goalDecision = {
      outcome: "PROMOTED",
      ...(originalGoal === undefined
        ? {}
        : {
            originalGoalRecommendationId: originalGoal.id,
            ...(originalGoalRejectionReason === undefined
              ? {}
              : { rejectionReason: originalGoalRejectionReason }),
          }),
      finalGoalRecommendationId: promotableBalanced.id,
      promotedFromType: "BALANCED",
    };
  } else if (originalGoal === undefined) {
    goalDecision = { outcome: "ABSENT" };
  } else {
    if (originalGoalRejectionReason === undefined) {
      throw new TypeError("제거할 GOAL의 검증 실패 사유가 없습니다.");
    }
    goalDecision = {
      outcome: "REMOVED",
      originalGoalRecommendationId: originalGoal.id,
      rejectionReason: originalGoalRejectionReason,
    };
  }
  return {
    recommendations,
    ...(primaryRecommendationId === undefined
      ? {}
      : { primaryRecommendationId }),
    goalReachable,
    goalDecision,
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

  const doubleSteps = [...unique]
    .sort(byDoubleSteps(fast.estimatedSteps))
    .find((candidate) => !usedIds.has(candidate.route.id));
  if (doubleSteps !== undefined) {
    selected.set("BALANCED", doubleSteps);
    usedIds.add(doubleSteps.route.id);
  }

  const goal = [...unique]
    .sort(byGoal(remainingSteps))
    .find((candidate) => !usedIds.has(candidate.route.id));
  if (goal !== undefined) {
    selected.set("GOAL", goal);
    usedIds.add(goal.route.id);
  }

  const typeOrder: RecommendationType[] = ["FAST", "BALANCED", "GOAL"];
  const recommendations = typeOrder.flatMap((type) => {
    const candidate = selected.get(type);
    return candidate === undefined
      ? []
      : [toRecommendation(candidate, type, remainingSteps)];
  });
  const primaryRecommendationId =
    remainingSteps === 0
      ? recommendations.find((item) => item.type === "FAST")?.id
      : (recommendations.find((item) => item.type === "GOAL")?.id ??
        recommendations.find((item) => item.type === "BALANCED")?.id ??
        recommendations[0]?.id);

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
