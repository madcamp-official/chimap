import type {
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
} from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import type { RouteCandidate } from "./candidate-generator.js";
import {
  calculateAutomaticMaxExtraMinutes,
  resolveRecommendationPolicy,
} from "./calculations.js";
import {
  finalizeRecommendations,
  selectRecommendations,
} from "./recommendation-engine.js";
import { deduplicateRoutes } from "./route-deduplicator.js";

const request: RecommendationRequest = {
  origin: {
    id: "kakao:place:26964230",
    name: "한국과학기술원",
    address: "대전 유성구 구성동 23",
    roadAddress: "대전 유성구 대학로 291",
    category: "교육,학문 > 학교 > 대학교",
    location: {
      lng: 127.359293,
      lat: 36.369725,
    },
  },
  destination: {
    id: "kakao:place:9113903",
    name: "대전역",
    address: "대전 동구 정동 1-1",
    roadAddress: "대전 동구 중앙로 215",
    category: "교통,수송 > 기차,철도 > 기차역",
    location: {
      lng: 127.434217,
      lat: 36.332338,
    },
  },
  currentSteps: 5200,
  goalSteps: 8000,
  walkingMetric: {
    stepLengthMeters: 0.7,
    source: "RESEARCH_ESTIMATE",
    modelVersion: "HAN_2026_V1",
  },
};

function actualRoute(input: {
  id: string;
  routeNo: string;
  durationSeconds: number;
  walkDistanceMeters: number;
}): NormalizedRoute {
  return {
    id: input.id,
    source: "TAGO",
    durationSeconds: input.durationSeconds,
    distanceMeters: input.walkDistanceMeters + 9_800,
    walkDistanceMeters: input.walkDistanceMeters,
    transitDistanceMeters: 9_800,
    transferCount: 0,
    legs: [
      {
        id: `${input.id}-walk`,
        mode: "WALK",
        guidance: "한국과학기술원 정류장까지 이동",
        distanceMeters: input.walkDistanceMeters,
        durationSeconds: Math.round(input.walkDistanceMeters / 1.25),
        coordinates: [
          { lng: 127.359293, lat: 36.369725 },
          { lng: 127.36063, lat: 36.369938 },
        ],
        isExerciseSegment: false,
      },
      {
        id: `${input.id}-bus`,
        mode: "BUS",
        name: input.routeNo,
        guidance: `${input.routeNo}번 버스로 대전역까지 이동`,
        distanceMeters: 9_800,
        durationSeconds: Math.max(
          1,
          input.durationSeconds -
            Math.round(input.walkDistanceMeters / 1.25),
        ),
        stops: ["한국과학기술원본관", "대전역"],
        coordinates: [
          { lng: 127.36063, lat: 36.369938 },
          { lng: 127.434217, lat: 36.332338 },
        ],
        isExerciseSegment: false,
      },
    ],
  };
}

function candidate(
  route: NormalizedRoute,
  kind: RouteCandidate["kind"] = "BASE",
): RouteCandidate {
  return {
    route,
    kind,
  };
}

describe("건강 경로 추천 선정", () => {
  const fast = actualRoute({
    id: "actual-fast-108",
    routeNo: "108",
    durationSeconds: 3600,
    walkDistanceMeters: 700,
  });
  const doubleSteps = actualRoute({
    id: "actual-double-102",
    routeNo: "102",
    durationSeconds: 3900,
    walkDistanceMeters: 1600,
  });
  const goal = actualRoute({
    id: "actual-goal-511",
    routeNo: "511",
    durationSeconds: 4200,
    walkDistanceMeters: 1960,
  });

  it("빠른·약 2배 걸음·목표 근접 경로를 중복 없이 제공한다", () => {
    const result = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      policy: resolveRecommendationPolicy(request, fast),
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
      "GOAL",
    ]);
    expect(new Set(result.recommendations.map((item) => item.id)).size).toBe(3);
    expect(result.recommendations[1]).toMatchObject({
      id: "actual-double-102",
      type: "BALANCED",
      title: "2배 걸음 경로",
      reason: "가장 빠른 경로의 예상 걸음 수 약 두 배에 가장 가까워요.",
    });
    expect(result.recommendations[2]).toMatchObject({
      id: "actual-goal-511",
      type: "GOAL",
      title: "목표 근접 경로",
    });
    expect(result.goalReachable).toBe(true);
    expect(result.primaryRecommendationId).toBe("actual-goal-511");
    expect(
      result.recommendations.find((item) => item.type === "GOAL")
        ?.expectedTotalSteps,
    ).toBe(8000);
  });

  it("이미 목표를 달성했으면 최종 GOAL 라벨을 제거하고 빠른 경로를 기본 선택한다", () => {
    const completedRequest: RecommendationRequest = {
      ...request,
      currentSteps: 8100,
    };
    const result = selectRecommendations({
      candidates: [candidate(fast), candidate(doubleSteps), candidate(goal)],
      baseline: fast,
      request: completedRequest,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      policy: resolveRecommendationPolicy(completedRequest, fast),
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
      "GOAL",
    ]);
    expect(new Set(result.recommendations.map((item) => item.id)).size).toBe(3);
    expect(result.primaryRecommendationId).toBe("actual-fast-108");

    const finalized = finalizeRecommendations({
      recommendations: result.recommendations,
      request: completedRequest,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(completedRequest, fast),
      requireDetailedExerciseWalking: true,
    });
    expect(finalized.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
    ]);
    expect(finalized.primaryRecommendationId).toBe("actual-fast-108");
    expect(finalized.goalReachable).toBe(true);
    expect(finalized.goalDecision).toEqual({
      outcome: "NOT_REQUIRED",
      originalGoalRecommendationId: "actual-goal-511",
      rejectionReason: "GOAL_ALREADY_REACHED",
    });
  });

  it("2배 걸음 경로는 빠른 경로 예상 걸음의 정확한 두 배에 가장 가까운 후보를 고른다", () => {
    const exactDouble = actualRoute({
      id: "exact-double",
      routeNo: "705",
      durationSeconds: 4500,
      walkDistanceMeters: 1400,
    });
    const nearDoubleButFaster = actualRoute({
      id: "near-double-faster",
      routeNo: "706",
      durationSeconds: 3700,
      walkDistanceMeters: 1260,
    });

    const result = selectRecommendations({
      candidates: [
        candidate(goal),
        candidate(nearDoubleButFaster),
        candidate(exactDouble),
        candidate(fast),
      ],
      baseline: fast,
      request,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      policy: resolveRecommendationPolicy(request, fast),
    });

    expect(
      result.recommendations.find((item) => item.type === "FAST"),
    ).toMatchObject({
      id: "actual-fast-108",
      estimatedSteps: 1000,
    });
    expect(
      result.recommendations.find((item) => item.type === "BALANCED"),
    ).toMatchObject({
      id: "exact-double",
      estimatedSteps: 2000,
    });
  });

  it("GOAL은 더 가까운 BASE보다 실제 운동 조정 후보를 우선한다", () => {
    const adjustedGoalBase = actualRoute({
      id: "adjusted-goal",
      routeNo: "604",
      durationSeconds: 4_100,
      walkDistanceMeters: 1_890,
    });
    const adjustedGoal: NormalizedRoute = {
      ...adjustedGoalBase,
      legs: [
        {
          ...adjustedGoalBase.legs[0]!,
          geometryQuality: "DETAILED",
          isExerciseSegment: true,
          walkingRole: "GOAL_EARLY_ALIGHTING",
        },
        ...adjustedGoalBase.legs.slice(1),
      ],
    };

    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const policy = resolveRecommendationPolicy(request, fast);
    const selected = selectRecommendations({
      candidates: [
        candidate(fast),
        candidate(doubleSteps),
        candidate(goal),
        candidate(adjustedGoal, "EARLY_ALIGHT"),
      ],
      baseline: fast,
      request,
      departureAt,
      policy,
    });

    expect(selected.recommendations.find((item) => item.type === "BALANCED"))
      .toMatchObject({ id: "actual-double-102" });
    expect(selected.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        id: "adjusted-goal",
        estimatedSteps: 2_700,
        stepDifference: -100,
      });
    expect(selected.primaryRecommendationId).toBe("adjusted-goal");

    const finalized = finalizeRecommendations({
      recommendations: selected.recommendations,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy,
      requireDetailedExerciseWalking: true,
      candidateKindByRecommendationId: new Map([
        ["actual-fast-108", "BASE"],
        ["actual-double-102", "BASE"],
        ["actual-goal-511", "BASE"],
        ["adjusted-goal", "EARLY_ALIGHT"],
      ]),
    });

    expect(finalized.goalDecision).toEqual({
      outcome: "KEPT",
      originalGoalRecommendationId: "adjusted-goal",
      finalGoalRecommendationId: "adjusted-goal",
    });
    expect(finalized.primaryRecommendationId).toBe("adjusted-goal");
  });

  it("실제 고유 후보가 세 개보다 적으면 같은 경로를 복제하지 않는다", () => {
    const result = selectRecommendations({
      candidates: [candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      policy: resolveRecommendationPolicy(request, fast),
    });

    expect(result.recommendations).toHaveLength(2);
    expect(new Set(result.recommendations.map((item) => item.id))).toEqual(
      new Set(["actual-fast-108", "actual-double-102"]),
    );
  });

  it("추가 허용시간을 넘는 경로를 카드 후보에서 제외한다", () => {
    const legacyRequest: RecommendationRequest = {
      ...request,
      deadline: "2026-07-25T15:00:00.000Z",
      maxExtraMinutes: 0,
      safetyBufferMinutes: 3,
    };
    const result = selectRecommendations({
      candidates: [candidate(fast), candidate(doubleSteps), candidate(goal)],
      baseline: fast,
      request: legacyRequest,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      policy: resolveRecommendationPolicy(legacyRequest, fast),
    });

    expect(result.recommendations.map((item) => item.id)).toEqual([
      "actual-fast-108",
    ]);
  });

  it("자동 추천 범위를 넘는 운동 후보를 카드에서 제외한다", () => {
    const outsideAutomaticBudget = actualRoute({
      id: "outside-auto-budget",
      routeNo: "999",
      durationSeconds: fast.durationSeconds + 27 * 60,
      walkDistanceMeters: 1960,
    });
    const result = selectRecommendations({
      candidates: [candidate(fast), candidate(outsideAutomaticBudget)],
      baseline: fast,
      request,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
      policy: resolveRecommendationPolicy(request, fast),
    });

    expect(result.recommendations.map((item) => item.id)).toEqual([
      "actual-fast-108",
    ]);
    expect(result.goalReachable).toBe(false);
  });

  it("상세 WALK 수치로 추천 지표와 ETA를 다시 계산한 뒤 검증된 GOAL을 primary로 확정한다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations;
    const detailed = selected.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: recommendation.legs.map((leg, index) =>
              index !== 0
                ? leg
                : {
                    ...leg,
                    distanceMeters: 1_890,
                    durationSeconds: 1_800,
                    geometryQuality: "DETAILED",
                    isExerciseSegment: true,
                    walkingRole: "GOAL_EARLY_ALIGHTING",
                  }
            ),
          }
    );

    const result = finalizeRecommendations({
      recommendations: detailed,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        id: "actual-goal-511",
        durationSeconds: 4_432,
        arrivalAt: "2026-07-25T13:13:52.000Z",
        extraMinutes: 14,
        walkDistanceMeters: 1_890,
        estimatedSteps: 2_700,
        stepDifference: -100,
        goalFit: "WITHIN_TOLERANCE",
        expectedTotalSteps: 7_900,
        dailyGoalCompletionRate: 0.9875,
        shortfallCoverageRate: 2_700 / 2_800,
      });
    expect(result.primaryRecommendationId).toBe("actual-goal-511");
    expect(result.goalReachable).toBe(true);
  });

  it("운동 WALK 상세화가 실패한 GOAL은 제거하고 FAST를 primary로 되돌린다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: recommendation.legs.map((leg, index) =>
              index !== 0
                ? leg
                : {
                    ...leg,
                    geometryQuality: "APPROXIMATE",
                    isExerciseSegment: true,
                    walkingRole: "GOAL_EARLY_ALIGHTING",
                  }
            ),
          }
    );

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
    ]);
    expect(result.primaryRecommendationId).toBe("actual-fast-108");
    expect(result.goalReachable).toBe(false);
    expect(result.goalDecision).toEqual({
      outcome: "REMOVED",
      originalGoalRecommendationId: "actual-goal-511",
      rejectionReason: "EXERCISE_WALK_NOT_DETAILED",
    });
  });

  it("주 운동 WALK가 검증되면 20m 이하 connector는 상세화 없이도 GOAL 검증을 막지 않는다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: [
              {
                ...recommendation.legs[0]!,
                distanceMeters: 1_880,
                durationSeconds: 1_790,
                geometryQuality: "DETAILED",
                isExerciseSegment: true,
                walkingRole: "GOAL_EARLY_ALIGHTING",
              },
              {
                ...recommendation.legs[0]!,
                id: "short-exercise-connector",
                distanceMeters: 10,
                durationSeconds: 8,
                geometryQuality: "APPROXIMATE",
                isExerciseSegment: true,
                walkingRole: "GOAL_EARLY_ALIGHTING",
              },
              ...recommendation.legs.slice(1),
            ],
          }
    );

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        walkDistanceMeters: 1_890,
        goalFit: "WITHIN_TOLERANCE",
      });
    expect(result.primaryRecommendationId).toBe("actual-goal-511");
  });

  it("목표 범위여도 실제 운동 WALK가 하나도 없으면 GOAL로 인정하지 않는다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations;

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
    ]);
    expect(result.primaryRecommendationId).toBe("actual-fast-108");
    expect(result.goalReachable).toBe(false);
    expect(result.goalDecision).toEqual({
      outcome: "REMOVED",
      originalGoalRecommendationId: "actual-goal-511",
      rejectionReason: "NO_EXERCISE_WALK",
    });
  });

  it("ACCESS를 운동으로 잘못 표시해도 GOAL 운동 구간으로 인정하지 않는다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: recommendation.legs.map((leg, index) =>
              index !== 0
                ? leg
                : {
                    ...leg,
                    distanceMeters: 1_890,
                    geometryQuality: "DETAILED",
                    isExerciseSegment: true,
                    walkingRole: "ACCESS",
                  }
            ),
          }
    );

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.goalDecision).toEqual({
      outcome: "REMOVED",
      originalGoalRecommendationId: "actual-goal-511",
      rejectionReason: "EXERCISE_WALK_ROLE_INVALID",
    });
  });

  it("20m 이하 connector만 운동으로 표시된 경로는 GOAL로 인정하지 않는다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: [
              {
                ...recommendation.legs[0]!,
                distanceMeters: 1_880,
                geometryQuality: "DETAILED",
                isExerciseSegment: false,
                walkingRole: "ACCESS",
              },
              {
                ...recommendation.legs[0]!,
                id: "short-only-exercise-connector",
                distanceMeters: 10,
                durationSeconds: 8,
                geometryQuality: "APPROXIMATE",
                isExerciseSegment: true,
                walkingRole: "GOAL_EARLY_ALIGHTING",
              },
              ...recommendation.legs.slice(1),
            ],
          }
    );

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.goalDecision).toEqual({
      outcome: "REMOVED",
      originalGoalRecommendationId: "actual-goal-511",
      rejectionReason: "NO_SUBSTANTIAL_EXERCISE_WALK",
    });
  });

  it("다른 FAST itinerary의 ACCESS 차이를 운동 구간 검증에 섞지 않는다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: [
              {
                ...recommendation.legs[0]!,
                distanceMeters: 1_000,
                durationSeconds: 800,
                geometryQuality: "DETAILED",
                isExerciseSegment: false,
                walkingRole: "ACCESS",
              },
              {
                ...recommendation.legs[0]!,
                id: "valid-exercise-segment",
                distanceMeters: 960,
                durationSeconds: 768,
                geometryQuality: "DETAILED",
                isExerciseSegment: true,
                walkingRole: "GOAL_EARLY_ALIGHTING",
              },
              ...recommendation.legs.slice(1),
            ],
          }
    );

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      candidateKindByRecommendationId: new Map([
        ["actual-goal-511", "EARLY_ALIGHT"],
      ]),
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        id: "actual-goal-511",
        walkDistanceMeters: 1_960,
        estimatedSteps: 2_800,
        goalFit: "WITHIN_TOLERANCE",
      });
    expect(result.goalDecision).toEqual({
      outcome: "KEPT",
      originalGoalRecommendationId: "actual-goal-511",
      finalGoalRecommendationId: "actual-goal-511",
    });
  });

  it("공원 connector와 산책로에 운동 provenance가 있으면 topology가 다른 GOAL을 유지한다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation =>
      recommendation.type !== "GOAL"
        ? recommendation
        : {
            ...recommendation,
            legs: [
              {
                ...recommendation.legs[0]!,
                distanceMeters: 700,
                durationSeconds: 560,
                geometryQuality: "DETAILED",
                isExerciseSegment: false,
                walkingRole: "ACCESS",
              },
              {
                ...recommendation.legs[0]!,
                id: "park-access-connector",
                distanceMeters: 200,
                durationSeconds: 160,
                geometryQuality: "DETAILED",
                isExerciseSegment: true,
                walkingRole: "PARK_CONNECTOR",
              },
              {
                ...recommendation.legs[0]!,
                id: "park-detour",
                distanceMeters: 860,
                durationSeconds: 688,
                geometryQuality: "DETAILED",
                isExerciseSegment: true,
                walkingRole: "PARK_DETOUR",
                parkRoute: {
                  routeId: "park-route-1",
                  officialParkId: "park-1",
                  parkName: "샘머리공원",
                  datasetId: "park-dataset-1",
                },
              },
              {
                ...recommendation.legs[0]!,
                id: "park-egress-connector",
                distanceMeters: 200,
                durationSeconds: 160,
                geometryQuality: "DETAILED",
                isExerciseSegment: true,
                walkingRole: "PARK_CONNECTOR",
              },
              ...recommendation.legs.slice(1),
            ],
          }
    );

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        id: "actual-goal-511",
        walkDistanceMeters: 1_960,
        estimatedSteps: 2_800,
        goalFit: "WITHIN_TOLERANCE",
      });
    expect(result.goalDecision).toEqual({
      outcome: "KEPT",
      originalGoalRecommendationId: "actual-goal-511",
      finalGoalRecommendationId: "actual-goal-511",
    });
  });

  it("상세화 후 목표에 더 가까워진 검증된 BALANCED를 GOAL로 승격한다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    }).recommendations.map((recommendation): Recommendation => {
      if (recommendation.type === "FAST") return recommendation;
      const distanceMeters =
        recommendation.type === "BALANCED" ? 1_890 : 1_500;
      return {
        ...recommendation,
        legs: recommendation.legs.map((leg, index) =>
          index !== 0
            ? leg
            : {
                ...leg,
                distanceMeters,
                durationSeconds: Math.round(distanceMeters / 1.05),
                geometryQuality: "DETAILED",
                isExerciseSegment: true,
                walkingRole: "GOAL_EARLY_ALIGHTING",
              }
        ),
      };
    });

    const result = finalizeRecommendations({
      recommendations: selected,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "GOAL",
    ]);
    expect(result.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        id: "actual-double-102",
        title: "목표 근접 경로",
        reason: "남은 걸음 수에 가장 가까운 경로예요.",
        goalFit: "WITHIN_TOLERANCE",
      });
    expect(result.primaryRecommendationId).toBe("actual-double-102");
    expect(result.goalReachable).toBe(true);
    expect(result.goalDecision).toEqual({
      outcome: "PROMOTED",
      originalGoalRecommendationId: "actual-goal-511",
      finalGoalRecommendationId: "actual-double-102",
      promotedFromType: "BALANCED",
    });
  });

  it("검증할 GOAL 카드가 애초에 없으면 BALANCED 대신 FAST를 기본 선택한다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const selection = selectRecommendations({
      candidates: [candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy: resolveRecommendationPolicy(request, fast),
    });
    expect(selection.primaryRecommendationId).toBe("actual-double-102");

    const finalized = finalizeRecommendations({
      recommendations: selection.recommendations,
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(request, fast),
      requireDetailedExerciseWalking: true,
    });

    expect(finalized.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
    ]);
    expect(finalized.primaryRecommendationId).toBe("actual-fast-108");
  });

  it("상세 WALK가 ±5% 밖이어도 가장 가까운 GOAL은 유지하고 시간 정책은 지킨다", () => {
    const departureAt = new Date("2026-07-25T12:00:00.000Z");
    const policy = resolveRecommendationPolicy(request, fast);
    const selected = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(doubleSteps)],
      baseline: fast,
      request,
      departureAt,
      policy,
    }).recommendations;
    const detailedGoal = selected.find((item) => item.type === "GOAL")!;
    const finalizeGoal = (
      distanceMeters: number,
      durationSeconds: number,
    ) => finalizeRecommendations({
      recommendations: selected.map((recommendation): Recommendation =>
        recommendation.type !== "GOAL"
          ? recommendation
          : {
              ...recommendation,
              legs: recommendation.legs.map((leg, index) =>
                index !== 0
                  ? leg
                  : {
                      ...leg,
                      distanceMeters,
                      durationSeconds,
                      geometryQuality: "DETAILED",
                      isExerciseSegment: true,
                      walkingRole: "GOAL_EARLY_ALIGHTING",
                    }
              ),
            }
      ),
      request,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy,
      requireDetailedExerciseWalking: true,
    });

    const closestGoal = finalizeGoal(
      1_700,
      detailedGoal.legs[0]!.durationSeconds,
    );
    expect(closestGoal.recommendations.find((item) => item.type === "GOAL"))
      .toMatchObject({
        id: "actual-goal-511",
        estimatedSteps: 2_429,
        stepDifference: -371,
        goalFit: "UNDER",
      });
    expect(closestGoal.primaryRecommendationId).toBe("actual-goal-511");
    expect(closestGoal.goalReachable).toBe(false);
    expect(closestGoal.goalDecision).toEqual({
      outcome: "KEPT",
      originalGoalRecommendationId: "actual-goal-511",
      finalGoalRecommendationId: "actual-goal-511",
    });
    expect(finalizeGoal(1_960, 4_000)
      .recommendations.some((item) => item.type === "GOAL")).toBe(false);

    const deadlineRequest: RecommendationRequest = {
      ...request,
      deadline: "2026-07-25T13:15:00.000Z",
      maxExtraMinutes: 120,
      safetyBufferMinutes: 3,
    };
    const missedDeadline = finalizeRecommendations({
      recommendations: selected.map((recommendation): Recommendation =>
        recommendation.type !== "GOAL"
          ? recommendation
          : {
              ...recommendation,
              legs: recommendation.legs.map((leg, index) =>
                index !== 0
                  ? leg
                  : {
                      ...leg,
                      distanceMeters: 1_890,
                      durationSeconds: 1_800,
                      geometryQuality: "DETAILED",
                      isExerciseSegment: true,
                      walkingRole: "GOAL_EARLY_ALIGHTING",
                    }
              ),
            }
      ),
      request: deadlineRequest,
      departureAt,
      baselineDurationSeconds: fast.durationSeconds,
      policy: resolveRecommendationPolicy(deadlineRequest, fast),
      requireDetailedExerciseWalking: true,
    });
    expect(missedDeadline.recommendations.some(
      (item) => item.type === "GOAL",
    )).toBe(false);
  });

  it("부족한 도보거리로 자동 추가시간을 계산하고 15~90분으로 제한한다", () => {
    expect(
      calculateAutomaticMaxExtraMinutes(
        { ...request, currentSteps: 8000 },
        fast,
      ),
    ).toBe(15);
    expect(calculateAutomaticMaxExtraMinutes(request, fast)).toBe(26);
    expect(
      calculateAutomaticMaxExtraMinutes(
        { ...request, currentSteps: 0, goalSteps: 100_000 },
        fast,
      ),
    ).toBe(90);
  });

  it("노선 topology·시간·도보가 같은 경로는 표시 형상과 무관하게 하나만 유지한다", () => {
    const sameRoute = {
      ...fast,
      id: "actual-fast-108-nearby",
      durationSeconds: fast.durationSeconds + 60,
      walkDistanceMeters: fast.walkDistanceMeters + 100,
      legs: fast.legs.map((leg) => ({
        ...leg,
        coordinates:
          leg.mode === "BUS"
            ? [
                leg.coordinates[0]!,
                { lng: 127.39, lat: 36.35 },
                leg.coordinates.at(-1)!,
              ]
            : leg.coordinates,
      })),
    };

    expect(
      deduplicateRoutes([candidate(fast), candidate(sameRoute)]),
    ).toHaveLength(1);
    expect(
      deduplicateRoutes([candidate(fast), candidate(doubleSteps)]),
    ).toHaveLength(2);
  });
});
