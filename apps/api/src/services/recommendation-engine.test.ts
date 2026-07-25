import type {
  NormalizedRoute,
  RecommendationRequest,
} from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import type { RouteCandidate } from "./candidate-generator.js";
import {
  areRoutesEquivalent,
  deduplicateRoutes,
} from "./route-deduplicator.js";
import { selectRecommendations } from "./recommendation-engine.js";

const request: RecommendationRequest = {
  origin: {
    id: "origin",
    name: "KAIST",
    address: "",
    roadAddress: "",
    category: "교육",
    location: { lng: 127.3604, lat: 36.3723 },
  },
  destination: {
    id: "destination",
    name: "대전역",
    address: "",
    roadAddress: "",
    category: "교통",
    location: { lng: 127.4342, lat: 36.3321 },
  },
  deadline: "2026-07-24T09:30:00.000Z",
  currentSteps: 5200,
  goalSteps: 8000,
  maxExtraMinutes: 30,
  strideLengthMeters: 0.7,
  safetyBufferMinutes: 3,
};

function route(input: {
  id: string;
  duration: number;
  walk: number;
  line: string;
  offset?: number;
}): NormalizedRoute {
  const offset = input.offset ?? 0;
  return {
    id: input.id,
    source: "MOCK",
    durationSeconds: input.duration,
    distanceMeters: 7000 + input.walk,
    walkDistanceMeters: input.walk,
    transitDistanceMeters: 7000,
    transferCount: 1,
    fareWon: 1550,
    legs: [
      {
        id: `${input.id}-transit`,
        mode: "BUS",
        name: input.line,
        distanceMeters: 7000,
        durationSeconds: input.duration - 300,
        coordinates: [
          { lng: 127.36 + offset, lat: 36.37 },
          { lng: 127.434 + offset, lat: 36.332 },
        ],
        isExerciseSegment: false,
      },
      {
        id: `${input.id}-walk`,
        mode: "WALK",
        distanceMeters: input.walk,
        durationSeconds: 300,
        coordinates: [
          { lng: 127.434 + offset, lat: 36.332 },
          { lng: 127.4342, lat: 36.3321 },
        ],
        isExerciseSegment: input.walk > 1000,
      },
    ],
  };
}

function candidate(value: NormalizedRoute): RouteCandidate {
  return {
    route: value,
    kind: "BASE",
    connectionPenalty: 0,
    connectionGapMeters: 0,
    failedChecks: [],
  };
}

describe("추천 선정과 중복 제거", () => {
  const routes = [
    route({ id: "fast", duration: 2400, walk: 430, line: "104" }),
    route({
      id: "balanced",
      duration: 2850,
      walk: 1700,
      line: "705",
      offset: 0.002,
    }),
    route({
      id: "goal",
      duration: 3200,
      walk: 1960,
      line: "1호선",
      offset: 0.004,
    }),
  ];

  it("FAST, BALANCED, GOAL에 서로 다른 경로를 선택한다", () => {
    const result = selectRecommendations({
      candidates: routes.map(candidate),
      baseline: routes[0]!,
      request,
      departureAt: new Date("2026-07-24T08:00:00.000Z"),
    });

    expect(result.recommendations.map((item) => item.type)).toEqual([
      "FAST",
      "BALANCED",
      "GOAL",
    ]);
    expect(
      result.recommendations.find((item) => item.type === "FAST")?.id,
    ).toBe("fast");
    expect(
      result.recommendations.find((item) => item.type === "GOAL")?.id,
    ).toBe("goal");
  });

  it("후보가 1개 또는 2개뿐이면 중복 카드 없이 줄여서 반환한다", () => {
    const one = selectRecommendations({
      candidates: [candidate(routes[0]!)],
      baseline: routes[0]!,
      request,
      departureAt: new Date("2026-07-24T08:00:00.000Z"),
    });
    const two = selectRecommendations({
      candidates: routes.slice(0, 2).map(candidate),
      baseline: routes[0]!,
      request,
      departureAt: new Date("2026-07-24T08:00:00.000Z"),
    });
    expect(one.recommendations).toHaveLength(1);
    expect(two.recommendations).toHaveLength(2);
    expect(new Set(two.recommendations.map((item) => item.id)).size).toBe(2);
  });

  it("목표를 이미 달성하면 FAST만 반환한다", () => {
    const result = selectRecommendations({
      candidates: routes.map(candidate),
      baseline: routes[0]!,
      request: { ...request, currentSteps: 9000 },
      departureAt: new Date("2026-07-24T08:00:00.000Z"),
    });
    expect(result.recommendations.map((item) => item.type)).toEqual(["FAST"]);
  });

  it("노선/환승/도보/시간/형상이 모두 비슷한 경로를 중복으로 본다", () => {
    const first = route({
      id: "duplicate-a",
      duration: 2500,
      walk: 500,
      line: "104",
    });
    const second = route({
      id: "duplicate-b",
      duration: 2550,
      walk: 600,
      line: "104",
      offset: 0.0001,
    });
    expect(areRoutesEquivalent(first, second)).toBe(true);
    expect(
      deduplicateRoutes([candidate(first), candidate(second)]),
    ).toHaveLength(1);
  });
});
