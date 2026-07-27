import { describe, expect, it } from "vitest";

import { routeModeDistances } from "./route-mode-distance";

describe("route mode distance summary", () => {
  it("여러 leg를 이동수단별 거리로 합쳐 고정 순서와 정확한 비율을 만든다", () => {
    expect(
      routeModeDistances([
        { mode: "WALK", distanceMeters: 100 },
        { mode: "BUS", distanceMeters: 600 },
        { mode: "WALK", distanceMeters: 200 },
        { mode: "SUBWAY", distanceMeters: 100 },
      ]),
    ).toEqual([
      { mode: "WALK", distanceMeters: 300, percent: 30 },
      { mode: "BUS", distanceMeters: 600, percent: 60 },
      { mode: "SUBWAY", distanceMeters: 100, percent: 10 },
    ]);
  });

  it("반올림 뒤에도 표시 비율의 합이 100이 되며 0m 수단은 제외한다", () => {
    const summary = routeModeDistances([
      { mode: "WALK", distanceMeters: 1 },
      { mode: "BUS", distanceMeters: 1 },
      { mode: "SUBWAY", distanceMeters: 1 },
      { mode: "WALK", distanceMeters: 0 },
    ]);

    expect(summary.map((item) => item.percent)).toEqual([34, 33, 33]);
    expect(summary.reduce((total, item) => total + item.percent, 0)).toBe(100);
  });

  it("거리 데이터가 모두 0이면 빈 요약을 반환한다", () => {
    expect(routeModeDistances([{ mode: "WALK", distanceMeters: 0 }])).toEqual([]);
  });
});
