import type { Recommendation } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import {
  formatClockTime,
  formatMeters,
  formatMinutes,
  formatRouteSequence,
  formatStepDifference,
  summarizeModeDistances,
  summarizeOrderedModeDistances,
} from "./recommendation-presentation";

const route = {
  stepDifference: -840,
  goalFit: "UNDER",
  legs: [
    { mode: "WALK" },
    { mode: "BUS", bus: { routeNo: "604" } },
    { mode: "WALK" },
  ],
} as Recommendation;

describe("recommendation presentation", () => {
  it("시간과 거리를 모바일 카드 형식으로 표시한다", () => {
    expect(formatMinutes(1_560)).toBe("26분");
    expect(formatMeters(850)).toBe("850m");
    expect(formatMeters(1_250)).toBe("1.3km");
    const koreanTime = formatClockTime("2026-07-28T10:25:00+09:00");
    expect(koreanTime).toMatch(/10:25/u);
    expect(formatClockTime("2026-07-28T01:25:00Z")).toBe(koreanTime);
  });

  it("이동 순서와 목표 걸음 차이를 표시한다", () => {
    expect(formatRouteSequence(route)).toBe("도보 → 604번 버스 → 도보");
    expect(formatStepDifference(route)).toBe("목표보다 840걸음 부족");
  });

  it("연속된 도보 구간은 하나로 합치고 이동수단별 거리를 합산한다", () => {
    const fragmentedRoute = {
      legs: [
        { mode: "WALK", distanceMeters: 120 },
        { mode: "WALK", distanceMeters: 180 },
        { mode: "WALK", distanceMeters: 200 },
        {
          mode: "SUBWAY",
          distanceMeters: 8_100,
          subway: { lineName: "1호선" },
        },
        { mode: "WALK", distanceMeters: 300 },
        { mode: "WALK", distanceMeters: 400 },
      ],
    } as Recommendation;

    expect(formatRouteSequence(fragmentedRoute)).toBe("도보 → 1호선 → 도보");
    expect(summarizeModeDistances(fragmentedRoute)).toEqual([
      { mode: "WALK", meters: 1_200 },
      { mode: "SUBWAY", meters: 8_100 },
    ]);
    expect(summarizeOrderedModeDistances(fragmentedRoute)).toEqual([
      { mode: "WALK", meters: 500 },
      { mode: "SUBWAY", meters: 8_100 },
      { mode: "WALK", meters: 700 },
    ]);
  });
});
