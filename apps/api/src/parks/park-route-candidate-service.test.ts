import type {
  Coordinate,
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
} from "@chimap/contracts";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type {
  MobilityProvider,
  WalkRouteRequest,
} from "../providers/types.js";
import { ParkRouteCandidateService } from "./park-route-candidate-service.js";
import type { ParkRouteRepository } from "./park-route-repository.js";

const request: RecommendationRequest = {
  origin: {
    id: "origin",
    name: "출발",
    address: "",
    roadAddress: "",
    category: "",
    location: { lng: 127.3, lat: 36.3 },
  },
  destination: {
    id: "destination",
    name: "도착",
    address: "",
    roadAddress: "",
    category: "",
    location: { lng: 127.32, lat: 36.32 },
  },
  currentSteps: 0,
  goalSteps: 1000,
  walkingMetric: {
    stepLengthMeters: 1,
    source: "RESEARCH_ESTIMATE",
    modelVersion: "HAN_2026_V1",
  },
};

const goal: Recommendation = {
  id: "goal",
  type: "GOAL",
  title: "목표",
  reason: "기존",
  durationSeconds: 600,
  arrivalAt: "2026-07-29T00:10:00.000Z",
  extraMinutes: 0,
  walkDistanceMeters: 200,
  estimatedSteps: 200,
  stepDifference: -800,
  goalFit: "UNDER",
  expectedTotalSteps: 200,
  dailyGoalCompletionRate: 0.2,
  shortfallCoverageRate: 0.2,
  transferCount: 0,
  legs: [
    {
      id: "walk",
      mode: "WALK",
      distanceMeters: 200,
      durationSeconds: 600,
      coordinates: [
        { lng: 127.3, lat: 36.3 },
        { lng: 127.32, lat: 36.32 },
      ],
      isExerciseSegment: false,
      walkingRole: "ACCESS",
    },
  ],
};

function walking(
  id: string,
  origin: Coordinate,
  destination: Coordinate,
): NormalizedRoute {
  return {
    id,
    source: "KAKAO",
    durationSeconds: 60,
    distanceMeters: 50,
    walkDistanceMeters: 50,
    transitDistanceMeters: 0,
    transferCount: 0,
    legs: [
      {
        id: `${id}-leg`,
        mode: "WALK",
        distanceMeters: 50,
        durationSeconds: 60,
        coordinates: [origin, destination],
        geometryQuality: "DETAILED",
        isExerciseSegment: false,
      },
    ],
  };
}

function direction(input: {
  routeId: string;
  parkName: string;
  entry: Coordinate;
  exit: Coordinate;
}) {
  return {
    datasetId: "dataset-1",
    routeId: input.routeId,
    officialParkId: input.routeId,
    parkName: input.parkName,
    entry: input.entry,
    exit: input.exit,
    coordinates: [
      input.entry,
      {
        lng: (input.entry.lng + input.exit.lng) / 2 + 0.001,
        lat: (input.entry.lat + input.exit.lat) / 2,
      },
      input.exit,
    ],
    pathWaypointIds: ["A", "W1", "B"],
    distanceMeters: 800,
    durationSeconds: 500,
    reversed: false,
  };
}

describe("ParkRouteCandidateService", () => {
  it("출발지 공원은 제외하고 GOAL 도보 중간에 저장 공원 경로를 삽입한다", async () => {
    const startingPark = direction({
      routeId: "park-at-origin",
      parkName: "출발 공원",
      entry: request.origin.location,
      exit: request.origin.location,
    });
    const middlePark = direction({
      routeId: "park-in-middle",
      parkName: "중간 공원",
      entry: { lng: 127.309, lat: 36.309 },
      exit: { lng: 127.311, lat: 36.311 },
    });
    const repository = {
      findNearRoute: vi.fn().mockResolvedValue([startingPark, middlePark]),
    } as unknown as ParkRouteRepository;
    const getWalkingRoute = vi.fn(
      async ({ origin, destination }: WalkRouteRequest) =>
        walking(`connector-${origin.lng}-${destination.lng}`, origin, destination),
    );
    const provider = {
      source: "KAKAO",
      getWalkingRoute,
    } as unknown as MobilityProvider;
    const service = new ParkRouteCandidateService({
      enabled: true,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider,
      logger: pino({ enabled: false }),
    });
    const fast = { ...goal, id: "fast", type: "FAST" as const };
    const balanced = {
      ...goal,
      id: "balanced",
      type: "BALANCED" as const,
    };

    const result = await service.improveGoal({
      recommendations: [fast, balanced, goal],
      request,
      requestId: "request-1",
      baselineDurationSeconds: 600,
      policy: { mode: "AUTO", maxExtraMinutes: 30 },
      departureAt: new Date("2026-07-29T00:00:00Z"),
      remainingRouteApiCalls: 2,
    });

    expect(result[0]).toBe(fast);
    expect(result[1]).toBe(balanced);
    expect(repository.findNearRoute).toHaveBeenCalledWith({
      coordinates: goal.legs[0]?.coordinates,
      radiusMeters: 800,
      limit: 3,
    });
    expect(getWalkingRoute).toHaveBeenCalledTimes(2);
    expect(result[2]?.estimatedSteps).toBe(1100);
    expect(result[2]?.reason).toContain("경로 중간의 중간 공원");
    expect(result[2]?.legs.map((leg) => leg.distanceMeters)).toEqual([
      100,
      50,
      800,
      50,
      100,
    ]);
    expect(
      result[2]?.legs.filter(
        (leg) => leg.walkingRole === "PARK_CONNECTOR",
      ),
    ).toEqual([
      expect.objectContaining({
        distanceMeters: 50,
        geometryQuality: "DETAILED",
        isExerciseSegment: true,
      }),
      expect.objectContaining({
        distanceMeters: 50,
        geometryQuality: "DETAILED",
        isExerciseSegment: true,
      }),
    ]);
    expect(
      result[2]?.legs.find((leg) => leg.walkingRole === "PARK_DETOUR"),
    ).toMatchObject({
      coordinates: middlePark.coordinates,
      geometryQuality: "DETAILED",
      isExerciseSegment: true,
      parkRoute: {
        datasetId: "dataset-1",
        routeId: "park-in-middle",
      },
    });
    expect(
      result[2]?.legs.some(
        (leg) => leg.parkRoute?.routeId === "park-at-origin",
      ),
    ).toBe(false);
  });

  it("공원 연결 도보 API가 실패해도 근사 연결과 저장 공원 경로를 사용한다", async () => {
    const middlePark = direction({
      routeId: "park-with-fallback",
      parkName: "연결 공원",
      entry: { lng: 127.3095, lat: 36.3095 },
      exit: { lng: 127.3105, lat: 36.3105 },
    });
    const repository = {
      findNearRoute: vi.fn().mockResolvedValue([middlePark]),
    } as unknown as ParkRouteRepository;
    const getWalkingRoute = vi
      .fn<
        (request: WalkRouteRequest) => Promise<NormalizedRoute>
      >()
      .mockRejectedValue(new Error("endpoint mismatch"));
    const service = new ParkRouteCandidateService({
      enabled: true,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider: {
        source: "KAKAO",
        getWalkingRoute,
      } as unknown as MobilityProvider,
      logger: pino({ enabled: false }),
    });

    const [improved] = await service.improveGoal({
      recommendations: [goal],
      request,
      requestId: "request-fallback",
      baselineDurationSeconds: 600,
      policy: { mode: "AUTO", maxExtraMinutes: 30 },
      departureAt: new Date("2026-07-29T00:00:00Z"),
      remainingRouteApiCalls: 2,
    });

    expect(getWalkingRoute).toHaveBeenCalledTimes(2);
    expect(
      improved?.legs.filter((leg) => leg.geometryQuality === "APPROXIMATE"),
    ).toHaveLength(2);
    expect(
      improved?.legs.filter(
        (leg) => leg.walkingRole === "PARK_CONNECTOR",
      ),
    ).toEqual([
      expect.objectContaining({
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: true,
      }),
      expect.objectContaining({
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: true,
      }),
    ]);
    expect(
      improved?.legs.find((leg) => leg.walkingRole === "PARK_DETOUR"),
    ).toMatchObject({
      coordinates: middlePark.coordinates,
      geometryQuality: "DETAILED",
      parkRoute: { routeId: "park-with-fallback" },
    });
  });

  it("client abort는 병렬 공원 connector 요청을 모두 중단한다", async () => {
    const middlePark = direction({
      routeId: "park-client-abort",
      parkName: "취소 공원",
      entry: { lng: 127.3095, lat: 36.3095 },
      exit: { lng: 127.3105, lat: 36.3105 },
    });
    const repository = {
      findNearRoute: vi.fn().mockResolvedValue([middlePark]),
    } as unknown as ParkRouteRepository;
    const receivedSignals: AbortSignal[] = [];
    const getWalkingRoute = vi.fn(
      ({ signal }: WalkRouteRequest) => new Promise<NormalizedRoute>(
        (_resolve, reject) => {
          if (signal === undefined) {
            reject(new Error("abort signal is required"));
            return;
          }
          receivedSignals.push(signal);
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        },
      ),
    );
    const service = new ParkRouteCandidateService({
      enabled: true,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider: {
        source: "KAKAO",
        getWalkingRoute,
      } as unknown as MobilityProvider,
      logger: pino({ enabled: false }),
    });
    const controller = new AbortController();
    const reason = new DOMException("client disconnected", "AbortError");
    const pending = service.improveGoal({
      recommendations: [goal],
      request,
      requestId: "request-client-abort",
      baselineDurationSeconds: 600,
      policy: { mode: "AUTO", maxExtraMinutes: 30 },
      departureAt: new Date("2026-07-29T00:00:00Z"),
      remainingRouteApiCalls: 2,
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(getWalkingRoute).toHaveBeenCalledTimes(2));
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("flag off 또는 공원 연결 예산이 부족하면 기존 추천을 유지한다", async () => {
    const repository = {
      findNearRoute: vi.fn(),
    } as unknown as ParkRouteRepository;
    const provider = {
      source: "KAKAO",
      getWalkingRoute: vi.fn(),
    } as unknown as MobilityProvider;
    const disabled = new ParkRouteCandidateService({
      enabled: false,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider,
      logger: pino({ enabled: false }),
    });
    await expect(
      disabled.improveGoal({
        recommendations: [goal],
        request,
        requestId: "request-1",
        baselineDurationSeconds: 600,
        policy: { mode: "AUTO", maxExtraMinutes: 30 },
        departureAt: new Date("2026-07-29T00:00:00Z"),
        remainingRouteApiCalls: 2,
      }),
    ).resolves.toEqual([goal]);

    const noBudget = new ParkRouteCandidateService({
      enabled: true,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider,
      logger: pino({ enabled: false }),
    });
    await expect(
      noBudget.improveGoal({
        recommendations: [goal],
        request,
        requestId: "request-2",
        baselineDurationSeconds: 600,
        policy: { mode: "AUTO", maxExtraMinutes: 30 },
        departureAt: new Date("2026-07-29T00:00:00Z"),
        remainingRouteApiCalls: 1,
      }),
    ).resolves.toEqual([goal]);
    expect(repository.findNearRoute).not.toHaveBeenCalled();
  });
});
