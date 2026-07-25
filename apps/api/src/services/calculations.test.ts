import type {
  NormalizedRoute,
  RecommendationRequest,
} from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import {
  calculateRemainingSteps,
  calculateStepMetrics,
  calculateTargetWalkDistanceMeters,
  estimateSteps,
  evaluateCandidate,
} from "./calculations.js";
import type { RouteCandidate } from "./candidate-generator.js";

const baseline: NormalizedRoute = {
  id: "baseline",
  source: "MOCK",
  durationSeconds: 2400,
  distanceMeters: 5000,
  walkDistanceMeters: 430,
  transitDistanceMeters: 4570,
  transferCount: 1,
  legs: [
    {
      id: "baseline-walk",
      mode: "WALK",
      distanceMeters: 430,
      durationSeconds: 360,
      coordinates: [
        { lng: 127.36, lat: 36.37 },
        { lng: 127.434, lat: 36.332 },
      ],
      isExerciseSegment: false,
    },
  ],
};

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
  deadline: "2026-07-24T09:00:00.000Z",
  currentSteps: 5200,
  goalSteps: 8000,
  maxExtraMinutes: 25,
  strideLengthMeters: 0.7,
  safetyBufferMinutes: 3,
};

function candidate(route: NormalizedRoute): RouteCandidate {
  return {
    route,
    kind: "BASE",
    connectionPenalty: 0,
    connectionGapMeters: 0,
    failedChecks: [],
  };
}

describe("핵심 걸음 및 시간 계산", () => {
  it("남은 걸음과 목표 도보거리를 계산한다", () => {
    expect(calculateRemainingSteps(5200, 8000)).toBe(2800);
    expect(calculateTargetWalkDistanceMeters(2800, 0.7)).toBe(1960);
  });

  it("보폭에 따라 예상 걸음을 반올림한다", () => {
    expect(estimateSteps(430, 0.7)).toBe(614);
    expect(() => estimateSteps(430, 0)).toThrow(RangeError);
  });

  it("목표를 이미 달성하면 부족분 0, 충족률 1을 사용한다", () => {
    const metrics = calculateStepMetrics(
      { ...request, currentSteps: 9000 },
      baseline,
      baseline,
    );
    expect(metrics.remainingSteps).toBe(0);
    expect(metrics.shortfallCoverageRate).toBe(1);
    expect(metrics.expectedTotalStepsAfterTrip).toBeGreaterThan(9000);
    expect(metrics.dailyGoalCompletionRate).toBe(1);
  });

  it("안전 여유시간과 최대 추가시간을 모두 적용한다", () => {
    const departureAt = new Date("2026-07-24T08:00:00.000Z");
    const route: NormalizedRoute = {
      ...baseline,
      id: "candidate",
      durationSeconds: 3000,
      walkDistanceMeters: 1800,
    };
    const evaluated = evaluateCandidate(
      candidate(route),
      baseline,
      request,
      departureAt,
    );
    expect(evaluated.deadlineSatisfied).toBe(true);
    expect(evaluated.extraTimeSatisfied).toBe(true);

    const late = evaluateCandidate(
      candidate({ ...route, id: "late", durationSeconds: 3600 }),
      baseline,
      request,
      departureAt,
    );
    expect(late.deadlineSatisfied).toBe(false);
    expect(late.extraTimeSatisfied).toBe(true);

    const extra = evaluateCandidate(
      candidate({ ...route, id: "extra", durationSeconds: 3960 }),
      baseline,
      { ...request, deadline: "2026-07-24T10:00:00.000Z" },
      departureAt,
    );
    expect(extra.deadlineSatisfied).toBe(true);
    expect(extra.extraTimeSatisfied).toBe(false);
  });

  it("서로 다른 단위의 penalty를 0..1로 제한한다", () => {
    const evaluated = evaluateCandidate(
      candidate({
        ...baseline,
        id: "large",
        durationSeconds: 10_000,
        walkDistanceMeters: 50_000,
        transferCount: 10,
      }),
      baseline,
      { ...request, deadline: "2026-07-24T12:00:00.000Z" },
      new Date("2026-07-24T08:00:00.000Z"),
    );
    expect(evaluated.stepError).toBeLessThanOrEqual(1);
    expect(evaluated.timePenalty).toBe(1);
    expect(evaluated.transferPenalty).toBe(1);
    expect(Number.isFinite(evaluated.balancedScore)).toBe(true);
  });
});
