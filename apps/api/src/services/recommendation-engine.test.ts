import type {
  NormalizedRoute,
  RecommendationRequest,
} from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import type { RouteCandidate } from "./candidate-generator.js";
import { selectRecommendations } from "./recommendation-engine.js";
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
  deadline: "2026-07-25T15:00:00.000Z",
  currentSteps: 5200,
  goalSteps: 8000,
  maxExtraMinutes: 30,
  strideLengthMeters: 0.7,
  safetyBufferMinutes: 3,
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

function candidate(route: NormalizedRoute): RouteCandidate {
  return {
    route,
    kind: "BASE",
    connectionPenalty: 0,
    connectionGapMeters: 0,
    failedChecks: [],
  };
}

describe("건강 경로 추천 선정", () => {
  const fast = actualRoute({
    id: "actual-fast-108",
    routeNo: "108",
    durationSeconds: 3600,
    walkDistanceMeters: 700,
  });
  const balanced = actualRoute({
    id: "actual-balanced-102",
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

  it("빠른·균형·목표 경로를 중복 없이 사용자 판단 순서로 제공한다", () => {
    const result = selectRecommendations({
      candidates: [candidate(goal), candidate(fast), candidate(balanced)],
      baseline: fast,
      request,
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
      "GOAL",
    ]);
    expect(new Set(result.recommendations.map((item) => item.id)).size).toBe(3);
    expect(result.goalReachable).toBe(true);
    expect(
      result.recommendations.find((item) => item.type === "GOAL")
        ?.expectedTotalSteps,
    ).toBe(8000);
  });

  it("이미 목표를 달성한 사용자는 불필요한 추가 도보 없이 빠른 경로만 본다", () => {
    const result = selectRecommendations({
      candidates: [candidate(fast), candidate(balanced), candidate(goal)],
      baseline: fast,
      request: {
        ...request,
        currentSteps: 8100,
      },
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      id: "actual-fast-108",
      type: "FAST",
    });
  });

  it("추가 허용시간을 넘는 경로를 카드 후보에서 제외한다", () => {
    const result = selectRecommendations({
      candidates: [candidate(fast), candidate(balanced), candidate(goal)],
      baseline: fast,
      request: {
        ...request,
        maxExtraMinutes: 0,
      },
      departureAt: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(result.recommendations.map((item) => item.id)).toEqual([
      "actual-fast-108",
    ]);
  });

  it("노선·시간·도보·형상이 같은 경로는 하나만 유지한다", () => {
    const sameRoute = {
      ...fast,
      id: "actual-fast-108-nearby",
      durationSeconds: fast.durationSeconds + 60,
      walkDistanceMeters: fast.walkDistanceMeters + 100,
    };

    expect(
      deduplicateRoutes([candidate(fast), candidate(sameRoute)]),
    ).toHaveLength(1);
    expect(
      deduplicateRoutes([candidate(fast), candidate(balanced)]),
    ).toHaveLength(2);
  });
});
