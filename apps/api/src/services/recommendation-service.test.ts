import type {
  NormalizedRoute,
  RecommendationRequest,
} from "@chimap/contracts";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import type { CandidateGenerator } from "./candidate-generator.js";
import { RecommendationService } from "./recommendation-service.js";

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

describe("자동 추천 서비스 경고", () => {
  it("자동 범위에서 목표에 못 미치면 전용 warning을 반환한다", async () => {
    const candidateGenerator = {
      generate: vi.fn().mockResolvedValue({
        baseline,
        candidates: [{ route: baseline, kind: "BASE" }],
        candidateFailureCount: 0,
        routeApiCallCount: 1,
      }),
    } as unknown as CandidateGenerator;
    const logger = { info: vi.fn() } as unknown as Logger;
    const service = new RecommendationService({
      candidateGenerator,
      logger,
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
  });
});
