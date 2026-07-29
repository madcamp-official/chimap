import type {
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
} from "@chimap/contracts";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { MobilityProvider } from "../providers/types.js";
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

function walking(id: string): NormalizedRoute {
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
        coordinates: [
          { lng: 127.3, lat: 36.3 },
          { lng: 127.301, lat: 36.301 },
        ],
        geometryQuality: "DETAILED",
        isExerciseSegment: false,
      },
    ],
  };
}

describe("ParkRouteCandidateService", () => {
  it("목표 적합도가 개선될 때 GOAL만 PARK_DETOUR로 교체하고 geometry를 보존한다", async () => {
    const coordinates = [
      { lng: 127.301, lat: 36.301 },
      { lng: 127.305, lat: 36.305 },
      { lng: 127.31, lat: 36.31 },
    ];
    const repository = {
      findNearSegment: vi.fn().mockResolvedValue([
        {
          datasetId: "dataset-1",
          routeId: "park-route:1",
          officialParkId: "park-1",
          parkName: "공원",
          entry: coordinates[0],
          exit: coordinates[2],
          coordinates,
          pathWaypointIds: ["A", "W1", "B"],
          distanceMeters: 800,
          durationSeconds: 500,
          reversed: false,
        },
      ]),
    } as unknown as ParkRouteRepository;
    const provider = {
      source: "KAKAO",
      getWalkingRoute: vi
        .fn()
        .mockResolvedValueOnce(walking("access"))
        .mockResolvedValueOnce(walking("egress")),
    } as unknown as MobilityProvider;
    const service = new ParkRouteCandidateService({
      enabled: true,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider,
      logger: pino({ enabled: false }),
    });
    const result = await service.improveGoal({
      recommendations: [goal],
      request,
      requestId: "request-1",
      baselineDurationSeconds: 600,
      policy: { mode: "AUTO", maxExtraMinutes: 30 },
      departureAt: new Date("2026-07-29T00:00:00Z"),
      remainingRouteApiCalls: 2,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("GOAL");
    expect(result[0]?.estimatedSteps).toBe(900);
    expect(
      result[0]?.legs.find((leg) => leg.walkingRole === "PARK_DETOUR"),
    ).toMatchObject({
      coordinates,
      geometryQuality: "DETAILED",
      isExerciseSegment: true,
      parkRoute: { datasetId: "dataset-1", routeId: "park-route:1" },
    });
  });

  it("flag off, 호출 예산 부족, 연결 실패 시 기존 추천을 유지한다", async () => {
    const repository = {
      findNearSegment: vi.fn(),
    } as unknown as ParkRouteRepository;
    const provider = {
      source: "KAKAO",
      getWalkingRoute: vi.fn(),
    } as unknown as MobilityProvider;
    const service = new ParkRouteCandidateService({
      enabled: false,
      radiusMeters: 800,
      maxCandidates: 3,
      repository,
      provider,
      logger: pino({ enabled: false }),
    });
    await expect(
      service.improveGoal({
        recommendations: [goal],
        request,
        requestId: "request-1",
        baselineDurationSeconds: 600,
        policy: { mode: "AUTO", maxExtraMinutes: 30 },
        departureAt: new Date("2026-07-29T00:00:00Z"),
        remainingRouteApiCalls: 2,
      }),
    ).resolves.toEqual([goal]);
    expect(repository.findNearSegment).not.toHaveBeenCalled();
  });
});
