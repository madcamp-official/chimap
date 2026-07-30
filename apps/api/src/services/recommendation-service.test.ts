import type {
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
} from "@chimap/contracts";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import {
  currentRequestLogContext,
  runWithRecommendationContext,
  runWithRequestContext,
} from "../monitoring/request-context.js";
import type { RouteGeometryObservation } from "../providers/route-geometry.js";
import type { CandidateGenerator } from "./candidate-generator.js";
import {
  overlaySelectedRouteGeometry,
  RecommendationService,
} from "./recommendation-service.js";
import type { ParkRouteCandidateService } from "../parks/park-route-candidate-service.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

function rejectOnAbort<T>(signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

const request: RecommendationRequest = {
  origin: {
    id: "origin",
    name: "한국과학기술원",
    address: "대전 유성구 구성동 23",
    roadAddress: "대전 유성구 대학로 291",
    category: "대학교",
    location: { lng: 127.359293, lat: 36.369725 },
  },
  destination: {
    id: "destination",
    name: "대전역",
    address: "대전 동구 정동 1-1",
    roadAddress: "대전 동구 중앙로 215",
    category: "기차역",
    location: { lng: 127.434217, lat: 36.332338 },
  },
  currentSteps: 5200,
  goalSteps: 8000,
  walkingMetric: {
    stepLengthMeters: 0.7,
    source: "RESEARCH_ESTIMATE",
    modelVersion: "HAN_2026_V1",
  },
};

const baseline: NormalizedRoute = {
  id: "baseline",
  source: "TAGO",
  durationSeconds: 3600,
  distanceMeters: 10_500,
  walkDistanceMeters: 700,
  transitDistanceMeters: 9800,
  transferCount: 0,
  legs: [
    {
      id: "baseline-walk",
      mode: "WALK",
      guidance: "정류장까지 걷기",
      distanceMeters: 700,
      durationSeconds: 560,
      coordinates: [
        { lng: 127.359293, lat: 36.369725 },
        { lng: 127.36063, lat: 36.369938 },
      ],
      isExerciseSegment: false,
    },
    {
      id: "baseline-bus",
      mode: "BUS",
      name: "108",
      guidance: "108번 버스로 이동",
      distanceMeters: 9800,
      durationSeconds: 3040,
      stops: ["한국과학기술원본관", "대전역"],
      coordinates: [
        { lng: 127.36063, lat: 36.369938 },
        { lng: 127.434217, lat: 36.332338 },
      ],
      isExerciseSegment: false,
      bus: {
        routeId: "route-108",
        cityCode: "25",
        routeNo: "108",
        routeType: null,
        boardingStop: {
          id: "stop-1", cityCode: "25", nodeId: "node-1",
          sourceStopNo: null, arsId: null, name: "한국과학기술원본관",
          latitude: 36.369938, longitude: 127.36063, source: "database",
        },
        alightingStop: {
          id: "stop-2", cityCode: "25", nodeId: "node-2",
          sourceStopNo: null, arsId: null, name: "대전역",
          latitude: 36.332338, longitude: 127.434217, source: "database",
        },
        stopCount: 1,
        boardingNodeOrder: 1,
        alightingNodeOrder: 2,
        expectedArrivalSeconds: 300,
        expectedRideSeconds: 2740,
        vehicleNo: null,
        vehicleType: null,
        isArrivalRealtime: false,
        polyline: [
          { lng: 127.36063, lat: 36.369938 },
          { lng: 127.434217, lat: 36.332338 },
        ],
        stops: [
          { routeId: "route-108", stopId: "stop-1", nodeId: "node-1", cityCode: "25", stopName: "한국과학기술원본관", latitude: 36.369938, longitude: 127.36063, nodeOrder: 1, direction: null },
          { routeId: "route-108", stopId: "stop-2", nodeId: "node-2", cityCode: "25", stopName: "대전역", latitude: 36.332338, longitude: 127.434217, nodeOrder: 2, direction: null },
        ],
      },
    },
  ],
};

function routeVariant(input: {
  id: string;
  routeNo: string;
  durationSeconds: number;
  walkDistanceMeters: number;
  exerciseWalk?: boolean;
}): NormalizedRoute {
  const walkDurationSeconds = Math.round(input.walkDistanceMeters / 1.25);
  const walk = {
    ...baseline.legs[0]!,
    id: `${input.id}-walk`,
    distanceMeters: input.walkDistanceMeters,
    durationSeconds: walkDurationSeconds,
    ...(input.exerciseWalk === true
      ? {
          geometryQuality: "APPROXIMATE" as const,
          isExerciseSegment: true,
          walkingRole: "GOAL_EARLY_ALIGHTING" as const,
        }
      : {}),
  };
  const bus = {
    ...baseline.legs[1]!,
    id: `${input.id}-bus`,
    name: input.routeNo,
    durationSeconds: input.durationSeconds - walkDurationSeconds,
    bus: {
      ...baseline.legs[1]!.bus!,
      routeId: `route-${input.routeNo}`,
      routeNo: input.routeNo,
      stops: baseline.legs[1]!.bus!.stops.map((stop) => ({
        ...stop,
        routeId: `route-${input.routeNo}`,
      })),
    },
  };
  return {
    ...baseline,
    id: input.id,
    durationSeconds: input.durationSeconds,
    distanceMeters: 9_800 + input.walkDistanceMeters,
    walkDistanceMeters: input.walkDistanceMeters,
    legs: [walk, bus],
  };
}

const fastRoute = routeVariant({
  id: "fast-route",
  routeNo: "108",
  durationSeconds: 3_600,
  walkDistanceMeters: 700,
});
const balancedRoute = routeVariant({
  id: "balanced-route",
  routeNo: "102",
  durationSeconds: 3_900,
  walkDistanceMeters: 1_400,
});
const goalRoute = routeVariant({
  id: "goal-route",
  routeNo: "511",
  durationSeconds: 4_200,
  walkDistanceMeters: 1_960,
  exerciseWalk: true,
});

function detailGoalWalking(
  recommendations: readonly Recommendation[],
  distanceMeters = 1_890,
  durationSeconds = 1_800,
): Recommendation[] {
  return recommendations.map((recommendation) =>
    recommendation.type !== "GOAL"
      ? recommendation
      : {
          ...recommendation,
          legs: recommendation.legs.map((leg) =>
            leg.mode !== "WALK" || !leg.isExerciseSegment
              ? leg
              : {
                  ...leg,
                  distanceMeters,
                  durationSeconds,
                  geometryQuality: "DETAILED" as const,
                }
          ),
        }
  );
}

function goalRecommendation(
  id: string,
  legs: Recommendation["legs"],
): Recommendation {
  return {
    id,
    type: "GOAL",
    title: "목표 경로",
    reason: "test",
    durationSeconds: 3_600,
    arrivalAt: "2026-07-26T04:00:00.000Z",
    extraMinutes: 0,
    walkDistanceMeters: 700,
    estimatedSteps: 1_000,
    stepDifference: -1_800,
    goalFit: "UNDER",
    expectedTotalSteps: 6_200,
    dailyGoalCompletionRate: 0.78,
    shortfallCoverageRate: 0.36,
    transferCount: 0,
    legs,
  };
}

describe("자동 추천 서비스 경고", () => {
  it("자동 범위에서 목표에 못 미치면 전용 warning을 반환한다", async () => {
    const loggerInfo = vi.fn();
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: loggerInfo } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000001",
    });

    expect(response.warnings).toContainEqual(
      expect.objectContaining({
        code: "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET",
      }),
    );
    expect(response.warnings).not.toContainEqual(
      expect.objectContaining({
        code: "GOAL_UNREACHABLE_WITHIN_CONSTRAINTS",
      }),
    );
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_decision",
      outcome: "ABSENT",
      reason: "NO_GOAL_CANDIDATE",
      originalGoalRecommendationId: null,
      finalGoalRecommendationId: null,
    }));
  });

  it("transit-v2는 추천을 선택한 뒤 선택 결과만 도보 형상으로 보강한다", async () => {
    const enrichWalkingGeometry = vi.fn(
      async (recommendations: readonly Recommendation[]) => [...recommendations],
    );
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichWalkingGeometry,
      enrichSelectedRouteGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000002",
      geometryProfile: "TRANSIT_V2",
    });

    expect(enrichWalkingGeometry).toHaveBeenCalledTimes(1);
    expect(candidateGenerator.enrichSelectedRouteGeometry).not.toHaveBeenCalled();
    expect(enrichWalkingGeometry.mock.calls[0]?.[0]).toHaveLength(1);
    expect(response.recommendations).toHaveLength(1);
  });

  it("transit-v2 상세 WALK 결과로 모든 추천 지표를 다시 계산하고 GOAL을 확정한다", async () => {
    const loggerInfo = vi.fn();
    const enrichSelectedRouteGeometry = vi.fn(
      async (recommendations: readonly Recommendation[]) =>
        detailGoalWalking(recommendations, 1_890, 2_168).map((recommendation) =>
          recommendation.type !== "FAST"
            ? recommendation
            : {
                ...recommendation,
                legs: recommendation.legs.map((leg, index) =>
                  index === 0
                    ? {
                        ...leg,
                        distanceMeters: 840,
                        durationSeconds: 920,
                        geometryQuality: "DETAILED" as const,
                      }
                    : leg
                ),
              }
        ),
    );
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline: fastRoute,
        candidates: [
          { route: fastRoute, kind: "BASE" },
          { route: balancedRoute, kind: "BASE" },
          { route: goalRoute, kind: "EARLY_ALIGHT" },
        ],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichSelectedRouteGeometry,
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: loggerInfo } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      selectedGeometryEnabled: true,
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000011",
      geometryProfile: "TRANSIT_V2",
    });
    const goal = response.recommendations.find((item) => item.type === "GOAL");
    const fast = response.recommendations.find((item) => item.type === "FAST");

    expect(response.baseline).toEqual({
      durationSeconds: 3_960,
      arrivalAt: "2026-07-26T04:06:00.000Z",
      walkDistanceMeters: 840,
      estimatedSteps: 1_200,
    });
    expect(fast).toMatchObject({
      durationSeconds: 3_960,
      arrivalAt: "2026-07-26T04:06:00.000Z",
      extraMinutes: 0,
      walkDistanceMeters: 840,
      estimatedSteps: 1_200,
    });
    expect(goal).toMatchObject({
      id: "goal-route",
      durationSeconds: 4_800,
      arrivalAt: "2026-07-26T04:20:00.000Z",
      extraMinutes: 14,
      walkDistanceMeters: 1_890,
      estimatedSteps: 2_700,
      stepDifference: -100,
      goalFit: "WITHIN_TOLERANCE",
      expectedTotalSteps: 7_900,
      dailyGoalCompletionRate: 0.9875,
      shortfallCoverageRate: 2_700 / 2_800,
    });
    expect(response.primaryRecommendationId).toBe("goal-route");
    expect(response.warnings).not.toContainEqual(expect.objectContaining({
      code: "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET",
    }));
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_decision",
      outcome: "KEPT",
      reason: "VALID",
      originalGoalRecommendationId: "goal-route",
      finalGoalRecommendationId: "goal-route",
    }));
  });

  it("transit-v2 상세 GOAL이 ±5% 밖이어도 카드와 도달 불가 warning을 함께 반환한다", async () => {
    const loggerInfo = vi.fn();
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline: fastRoute,
        candidates: [
          { route: fastRoute, kind: "BASE" },
          { route: balancedRoute, kind: "BASE" },
          { route: goalRoute, kind: "EARLY_ALIGHT" },
        ],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichSelectedRouteGeometry: vi.fn(
        async (recommendations: readonly Recommendation[]) =>
          detailGoalWalking(recommendations, 1_700, 1_600),
      ),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: loggerInfo } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      selectedGeometryEnabled: true,
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000017",
      geometryProfile: "TRANSIT_V2",
    });
    const goal = response.recommendations.find((item) => item.type === "GOAL");

    expect(goal).toMatchObject({
      id: "goal-route",
      estimatedSteps: 2_429,
      stepDifference: -371,
      goalFit: "UNDER",
    });
    expect(response.primaryRecommendationId).toBe("goal-route");
    expect(response.warnings).toContainEqual(expect.objectContaining({
      code: "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET",
    }));
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_decision",
      outcome: "KEPT",
      reason: "VALID",
      originalGoalRecommendationId: "goal-route",
      finalGoalRecommendationId: "goal-route",
    }));
  });

  it("transit-v2 운동 WALK 상세화 실패 시 GOAL을 제거하고 최종 warning을 다시 계산한다", async () => {
    const loggerInfo = vi.fn();
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline: fastRoute,
        candidates: [
          { route: fastRoute, kind: "BASE" },
          { route: balancedRoute, kind: "BASE" },
          { route: goalRoute, kind: "EARLY_ALIGHT" },
        ],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichSelectedRouteGeometry: vi.fn(
        async (recommendations: readonly Recommendation[]) => [
          ...recommendations,
        ],
      ),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: loggerInfo } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      selectedGeometryEnabled: true,
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000012",
      geometryProfile: "TRANSIT_V2",
    });

    expect(response.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
    ]);
    expect(response.primaryRecommendationId).toBe("fast-route");
    expect(response.warnings).toContainEqual(expect.objectContaining({
      code: "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET",
    }));
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_decision",
      outcome: "REMOVED",
      reason: "EXERCISE_WALK_NOT_DETAILED",
      originalGoalRecommendationId: "goal-route",
      finalGoalRecommendationId: null,
    }));
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_removed",
      requestId: "00000000-0000-4000-8000-000000000012",
      recommendationId: "goal-route",
      reason: "EXERCISE_WALK_NOT_DETAILED",
      recommendationTypeBefore: "GOAL",
      recommendationTypeAfter: null,
      goalDecisionOutcome: "REMOVED",
    }));
  });

  it("무효 GOAL을 제거하고 검증된 BALANCED를 승격하면 제거·승격 로그를 함께 기록한다", async () => {
    const loggerInfo = vi.fn();
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline: fastRoute,
        candidates: [
          { route: fastRoute, kind: "BASE" },
          { route: balancedRoute, kind: "EARLY_ALIGHT" },
          { route: goalRoute, kind: "EARLY_ALIGHT" },
        ],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichSelectedRouteGeometry: vi.fn(
        async (recommendations: readonly Recommendation[]) =>
          recommendations.map((recommendation) =>
            recommendation.type !== "BALANCED"
              ? recommendation
              : {
                  ...recommendation,
                  legs: recommendation.legs.map((leg) =>
                    leg.mode !== "WALK"
                      ? leg
                      : {
                          ...leg,
                          distanceMeters: 1_890,
                          durationSeconds: 1_800,
                          geometryQuality: "DETAILED" as const,
                          isExerciseSegment: true,
                          walkingRole: "GOAL_EARLY_ALIGHTING" as const,
                        }
                  ),
                }
          ),
      ),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: loggerInfo } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      selectedGeometryEnabled: true,
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000015",
      geometryProfile: "TRANSIT_V2",
    });

    expect(response.primaryRecommendationId).toBe("balanced-route");
    expect(response.recommendations.find((item) => item.id === "balanced-route"))
      .toMatchObject({ type: "GOAL" });
    expect(response.recommendations.some((item) => item.id === "goal-route"))
      .toBe(false);
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_removed",
      recommendationId: "goal-route",
      reason: "EXERCISE_WALK_NOT_DETAILED",
      recommendationTypeBefore: "GOAL",
      recommendationTypeAfter: null,
      goalDecisionOutcome: "PROMOTED",
      replacementRecommendationId: "balanced-route",
      replacementRecommendationType: "GOAL",
    }));
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_promoted",
      recommendationId: "balanced-route",
      recommendationTypeBefore: "BALANCED",
      recommendationTypeAfter: "GOAL",
      replacedGoalRecommendationId: "goal-route",
    }));
  });

  it("이미 목표를 달성해 기존 GOAL이 불필요해지면 제거 사유를 기록한다", async () => {
    const loggerInfo = vi.fn();
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
    } as unknown as CandidateGenerator;
    const improveGoal = vi.fn(async (input: {
      recommendations: Recommendation[];
    }) => {
      const fast = input.recommendations[0]!;
      return [
        ...input.recommendations,
        {
          ...fast,
          id: "not-required-goal",
          type: "GOAL" as const,
          title: "목표 경로",
        },
      ];
    });
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: loggerInfo } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      parkRoutes: { improveGoal } as unknown as ParkRouteCandidateService,
    });

    const response = await service.createRecommendations({
      request: { ...request, currentSteps: request.goalSteps },
      requestId: "00000000-0000-4000-8000-000000000016",
    });

    expect(response.recommendations.some((item) => item.type === "GOAL"))
      .toBe(false);
    expect(loggerInfo).toHaveBeenCalledWith(expect.objectContaining({
      event: "recommendation.goal_removed",
      recommendationId: "not-required-goal",
      reason: "GOAL_ALREADY_REACHED",
      recommendationTypeBefore: "GOAL",
      recommendationTypeAfter: null,
      goalDecisionOutcome: "NOT_REQUIRED",
    }));
  });

  it("기존 후보가 9회 호출을 써도 GOAL 공원 연결용 2회를 별도로 보장한다", async () => {
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 9,
      }),
    } as unknown as CandidateGenerator;
    const improveGoal = vi.fn(
      async (input: { recommendations: Recommendation[] }) =>
        input.recommendations,
    );
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      parkRoutes: { improveGoal } as unknown as ParkRouteCandidateService,
    });

    await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000003",
    });

    expect(improveGoal).toHaveBeenCalledWith(
      expect.objectContaining({ remainingRouteApiCalls: 2 }),
    );
  });

  it("phase flag가 켜지면 planning과 final signal을 분리하고 geometry 뒤 park에 같은 signal을 전달한다", async () => {
    const callOrder: string[] = [];
    const scopedPhases: string[] = [];
    let planningSignal: AbortSignal | undefined;
    let geometrySignal: AbortSignal | undefined;
    let parkSignal: AbortSignal | undefined;
    const candidateGenerator = {
      generate: vi.fn(async (
        _request: RecommendationRequest,
        signal?: AbortSignal,
      ) => {
        planningSignal = signal;
        callOrder.push("generate");
        scopedPhases.push(currentRequestLogContext()?.phase ?? "missing");
        return {
          baseline,
          candidates: [{ route: baseline, kind: "BASE" as const }],
          candidateFailureCount: 0,
          routeApiCallCount: 1,
        };
      }),
      prepareSelectedRouteGeometry: vi.fn((
        recommendations: readonly Recommendation[],
        signal?: AbortSignal,
      ) => {
        geometrySignal = signal;
        callOrder.push("geometry");
        scopedPhases.push(currentRequestLogContext()?.phase ?? "missing");
        const enriched = Promise.resolve([...recommendations]);
        return { goalWalking: enriched, complete: enriched };
      }),
      enrichSelectedRouteGeometry: vi.fn(),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const improveGoal = vi.fn(async (input: {
      recommendations: Recommendation[];
      signal?: AbortSignal;
    }) => {
      parkSignal = input.signal;
      callOrder.push("park");
      scopedPhases.push(currentRequestLogContext()?.phase ?? "missing");
      return input.recommendations;
    });
    const phases: unknown[] = [];
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      parkRoutes: { improveGoal } as unknown as ParkRouteCandidateService,
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
      observePhase: (observation) => phases.push(observation),
    });

    const requestId = "00000000-0000-4000-8000-000000000004";
    const startedAt = performance.now();
    await runWithRequestContext(
      { requestId, startedAtMilliseconds: startedAt },
      () => runWithRecommendationContext(
        { requestId, startedAtMilliseconds: startedAt, budgetMilliseconds: 20_000 },
        () => service.createRecommendations({
          request,
          requestId,
          geometryProfile: "TRANSIT_V2",
        }),
      ),
    );

    expect(callOrder).toEqual(["generate", "geometry", "park"]);
    expect(scopedPhases).toEqual([
      "CANDIDATE_GENERATION",
      "SELECTED_GEOMETRY",
      "PARK_ROUTE",
    ]);
    expect(planningSignal).toBeDefined();
    expect(geometrySignal).toBeDefined();
    expect(geometrySignal).not.toBe(planningSignal);
    expect(parkSignal).toBe(geometrySignal);
    expect(candidateGenerator.enrichWalkingGeometry).not.toHaveBeenCalled();
    expect(phases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: "CANDIDATE_GENERATION",
        outcome: "SUCCESS",
      }),
      expect.objectContaining({
        phase: "SELECTED_GEOMETRY",
        outcome: "SUCCESS",
      }),
      expect.objectContaining({ phase: "PARK_ROUTE", outcome: "SUCCESS" }),
    ]));
  });

  it("client abort는 planning 단계를 중단한다", async () => {
    let planningSignal: AbortSignal | undefined;
    const candidateGenerator = {
      generate: vi.fn((
        _request: RecommendationRequest,
        signal?: AbortSignal,
      ) => {
        planningSignal = signal;
        return rejectOnAbort(signal!);
      }),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      phasedTimeoutsEnabled: true,
    });
    const controller = new AbortController();
    const pending = service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000008",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(planningSignal).toBeDefined());

    controller.abort(new DOMException("client disconnected", "AbortError"));

    await expect(pending).rejects.toBeDefined();
    expect(planningSignal?.aborted).toBe(true);
  });

  it("client abort는 selected geometry 단계를 중단한다", async () => {
    let geometrySignal: AbortSignal | undefined;
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichSelectedRouteGeometry: vi.fn((
        _recommendations: readonly Recommendation[],
        signal?: AbortSignal,
      ) => {
        geometrySignal = signal;
        return rejectOnAbort(signal!);
      }),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
    });
    const controller = new AbortController();
    const pending = service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000009",
      signal: controller.signal,
      geometryProfile: "TRANSIT_V2",
    });
    await vi.waitFor(() => expect(geometrySignal).toBeDefined());

    controller.abort(new DOMException("client disconnected", "AbortError"));

    await expect(pending).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(geometrySignal?.aborted).toBe(true);
  });

  it("client abort는 park 단계에 전달된 geometry signal을 중단한다", async () => {
    let parkSignal: AbortSignal | undefined;
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      prepareSelectedRouteGeometry: vi.fn(
        (recommendations: readonly Recommendation[]) => ({
          goalWalking: Promise.resolve([...recommendations]),
          complete: Promise.resolve([...recommendations]),
        }),
      ),
      enrichSelectedRouteGeometry: vi.fn(),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const improveGoal = vi.fn((input: { signal?: AbortSignal }) => {
      parkSignal = input.signal;
      return rejectOnAbort<Recommendation[]>(input.signal!);
    });
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      parkRoutes: { improveGoal } as unknown as ParkRouteCandidateService,
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
    });
    const controller = new AbortController();
    const pending = service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000010",
      signal: controller.signal,
      geometryProfile: "TRANSIT_V2",
    });
    await vi.waitFor(() => expect(parkSignal).toBeDefined());

    controller.abort(new DOMException("client disconnected", "AbortError"));

    await expect(pending).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(parkSignal?.aborted).toBe(true);
  });

  it("GOAL WALK barrier가 끝나면 나머지 geometry와 병렬로 park를 시작한다", async () => {
    const goalWalkingGate = deferred<Recommendation[]>();
    const completeGate = deferred<Recommendation[]>();
    const parkGate = deferred<void>();
    let selected: Recommendation[] = [];
    let completeSettled = false;
    const prepareSelectedRouteGeometry = vi.fn(
      (recommendations: readonly Recommendation[]) => {
        selected = [...recommendations];
        return {
          goalWalking: goalWalkingGate.promise,
          complete: completeGate.promise.then((value) => {
            completeSettled = true;
            return value;
          }),
        };
      },
    );
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      prepareSelectedRouteGeometry,
      enrichSelectedRouteGeometry: vi.fn(),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const improveGoal = vi.fn(async (input: {
      recommendations: Recommendation[];
    }) => {
      await parkGate.promise;
      return input.recommendations;
    });
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      parkRoutes: { improveGoal } as unknown as ParkRouteCandidateService,
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
    });

    const pending = service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000007",
      geometryProfile: "TRANSIT_V2",
    });
    await vi.waitFor(() => {
      expect(prepareSelectedRouteGeometry).toHaveBeenCalledOnce();
    });
    expect(improveGoal).not.toHaveBeenCalled();

    goalWalkingGate.resolve(selected);
    await vi.waitFor(() => {
      expect(improveGoal).toHaveBeenCalledOnce();
    });
    expect(completeSettled).toBe(false);

    completeGate.resolve(selected);
    parkGate.resolve(undefined);
    await pending;

    expect(completeSettled).toBe(true);
    expect(candidateGenerator.enrichSelectedRouteGeometry).not.toHaveBeenCalled();
  });

  it("GOAL WALK barrier 결과를 aggregate 재계산한 뒤 park에 전달한다", async () => {
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline: fastRoute,
        candidates: [
          { route: fastRoute, kind: "BASE" },
          { route: balancedRoute, kind: "BASE" },
          { route: goalRoute, kind: "EARLY_ALIGHT" },
        ],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      prepareSelectedRouteGeometry: vi.fn(
        (recommendations: readonly Recommendation[]) => {
          const detailed = Promise.resolve(
            detailGoalWalking(recommendations),
          );
          return { goalWalking: detailed, complete: detailed };
        },
      ),
      enrichSelectedRouteGeometry: vi.fn(),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const improveGoal = vi.fn(async (input: {
      recommendations: Recommendation[];
    }) => input.recommendations);
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      parkRoutes: { improveGoal } as unknown as ParkRouteCandidateService,
      selectedGeometryEnabled: true,
    });

    await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000013",
      geometryProfile: "TRANSIT_V2",
    });
    const goalAtPark = improveGoal.mock.calls[0]?.[0].recommendations.find(
      (item) => item.type === "GOAL",
    );

    expect(goalAtPark).toMatchObject({
      durationSeconds: 4_432,
      arrivalAt: "2026-07-26T04:13:52.000Z",
      walkDistanceMeters: 1_890,
      estimatedSteps: 2_700,
      goalFit: "WITHIN_TOLERANCE",
    });
  });

  it("park가 교체한 GOAL에는 보존된 WALK의 상세 geometry와 지표를 덮어쓴다", () => {
    const approximateWalk = {
      ...baseline.legs[0]!,
      id: "preserved-walk",
      distanceMeters: 111,
      durationSeconds: 222,
      coordinates: [
        { lng: 127.35, lat: 36.35 },
        { lng: 127.36, lat: 36.36 },
      ],
      geometryQuality: "APPROXIMATE" as const,
    };
    const approximateBusCoordinates = [
      { lng: 127.36, lat: 36.36 },
      { lng: 127.43, lat: 36.33 },
    ];
    const approximateBus = {
      ...baseline.legs[1]!,
      id: "preserved-bus",
      distanceMeters: 7_777,
      durationSeconds: 888,
      coordinates: approximateBusCoordinates,
      geometryQuality: "APPROXIMATE" as const,
      bus: {
        ...baseline.legs[1]!.bus!,
        polyline: approximateBusCoordinates,
      },
    };
    const connector = {
      ...baseline.legs[0]!,
      id: "park-connector",
      distanceMeters: 333,
      durationSeconds: 444,
      coordinates: [
        { lng: 127.40, lat: 36.34 },
        { lng: 127.41, lat: 36.345 },
      ],
      geometryQuality: "DETAILED" as const,
      walkingRole: "PARK_CONNECTOR" as const,
    };
    const parkGoal = {
      ...goalRecommendation("park-goal", [
        approximateWalk,
        connector,
        approximateBus,
      ]),
      durationSeconds: 4_321,
      walkDistanceMeters: 1_234,
      estimatedSteps: 1_763,
    };
    const detailedWalkCoordinates = [
      approximateWalk.coordinates[0]!,
      { lng: 127.355, lat: 36.355 },
      approximateWalk.coordinates[1]!,
    ];
    const detailedBusCoordinates = [
      approximateBusCoordinates[0]!,
      { lng: 127.39, lat: 36.345 },
      approximateBusCoordinates[1]!,
    ];
    const detailedGoal = goalRecommendation("selected-goal", [
      {
        ...approximateWalk,
        distanceMeters: 9_999,
        durationSeconds: 9_999,
        coordinates: detailedWalkCoordinates,
        geometryQuality: "DETAILED",
      },
      {
        ...approximateBus,
        distanceMeters: 9_999,
        durationSeconds: 9_999,
        coordinates: detailedBusCoordinates,
        geometryQuality: "DETAILED",
        bus: {
          ...approximateBus.bus,
          polyline: detailedBusCoordinates,
        },
      },
    ]);

    const [result] = overlaySelectedRouteGeometry([parkGoal], [detailedGoal]);

    expect(result).toMatchObject({
      id: "park-goal",
      durationSeconds: 4_321,
      walkDistanceMeters: 1_234,
      estimatedSteps: 1_763,
    });
    expect(result?.legs.map((leg) => leg.id)).toEqual([
      "preserved-walk",
      "park-connector",
      "preserved-bus",
    ]);
    expect(result?.legs[0]).toMatchObject({
      distanceMeters: 9_999,
      durationSeconds: 9_999,
      coordinates: detailedWalkCoordinates,
      geometryQuality: "DETAILED",
    });
    expect(result?.legs[1]).toBe(connector);
    expect(result?.legs[2]).toMatchObject({
      distanceMeters: 7_777,
      durationSeconds: 888,
      coordinates: detailedBusCoordinates,
      geometryQuality: "DETAILED",
      bus: { polyline: detailedBusCoordinates },
    });
  });

  it("baseline 이후 planning timeout partial은 선택과 최종 geometry를 계속 진행한다", async () => {
    const enrichSelectedRouteGeometry = vi.fn(
      async (recommendations: readonly Recommendation[]) => [...recommendations],
    );
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 1,
        routeApiCallCount: 1,
        planningTimedOut: true,
      }),
      enrichSelectedRouteGeometry,
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const phases: Array<{ phase: string; outcome: string }> = [];
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
      observePhase: (observation) => phases.push(observation),
    });

    const response = await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000005",
      geometryProfile: "TRANSIT_V2",
    });

    expect(response.recommendations).toHaveLength(1);
    expect(enrichSelectedRouteGeometry).toHaveBeenCalledTimes(1);
    expect(phases).toContainEqual(expect.objectContaining({
      phase: "CANDIDATE_GENERATION",
      outcome: "TIMEOUT",
    }));
    expect(phases).toContainEqual(expect.objectContaining({
      phase: "SELECTED_GEOMETRY",
      outcome: "SUCCESS",
    }));
  });

  it("selected geometry leg가 하나라도 근사로 강등되면 phase를 DEGRADED로 기록한다", async () => {
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      prepareSelectedRouteGeometry: vi.fn((
        recommendations: readonly Recommendation[],
        _signal?: AbortSignal,
        observe?: (observation: RouteGeometryObservation) => void,
      ) => {
        observe?.({
          mode: "WALK",
          outcome: "APPROXIMATE",
          reason: "UPSTREAM",
          source: "FALLBACK",
          cacheState: "NONE",
          durationMilliseconds: 12,
          inputVertexCount: 2,
          outputVertexCount: 2,
          successfulSectionCount: 0,
          failedSectionCount: 1,
        });
        const enriched = Promise.resolve([...recommendations]);
        return { goalWalking: enriched, complete: enriched };
      }),
      enrichSelectedRouteGeometry: vi.fn(),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const phases: Array<{ phase: string; outcome: string }> = [];
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      parkRoutes: {
        improveGoal: vi.fn(async (input: {
          recommendations: Recommendation[];
        }) => input.recommendations),
      } as unknown as ParkRouteCandidateService,
      selectedGeometryEnabled: true,
      observePhase: (observation) => phases.push(observation),
    });

    await service.createRecommendations({
      request,
      requestId: "00000000-0000-4000-8000-000000000014",
      geometryProfile: "TRANSIT_V2",
    });

    expect(phases).toContainEqual(expect.objectContaining({
      phase: "SELECTED_GEOMETRY",
      outcome: "DEGRADED",
      timeoutOrigin: "NONE",
    }));
    expect(phases).not.toContainEqual(expect.objectContaining({
      phase: "SELECTED_GEOMETRY",
      outcome: "SUCCESS",
    }));
  });

  it("final phase deadline은 시작 후 8초와 요청 시작 후 18초 중 이른 시각을 사용한다", async () => {
    const dateNow = vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(12_000);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
      enrichSelectedRouteGeometry: vi.fn(
        async (recommendations: readonly Recommendation[]) => [
          ...recommendations,
        ],
      ),
      enrichWalkingGeometry: vi.fn(),
    } as unknown as CandidateGenerator;
    const service = new RecommendationService({
      candidateGenerator,
      logger: { info: vi.fn() } as unknown as Logger,
      clock: () => new Date("2026-07-26T03:00:00.000Z"),
      phasedTimeoutsEnabled: true,
      selectedGeometryEnabled: true,
    });

    try {
      await service.createRecommendations({
        request,
        requestId: "00000000-0000-4000-8000-000000000006",
        geometryProfile: "TRANSIT_V2",
      });

      expect(timeout.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
        20_000,
        8_000,
        6_000,
      ]);
    } finally {
      timeout.mockRestore();
      dateNow.mockRestore();
    }
  });
});
