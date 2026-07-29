import { describe, expect, it } from "vitest";

import {
  bearingDegrees,
  resolveVehicleHeading,
  routeHeadingAtCoordinate,
} from "./vehicle-heading.js";

describe("vehicle heading", () => {
  it("북·동·남·서 이동을 0·90·180·270도로 계산한다", () => {
    const center = { lat: 36.35, lng: 127.38 };
    expect(bearingDegrees(center, { lat: 36.36, lng: 127.38 })).toBeCloseTo(0, 1);
    expect(bearingDegrees(center, { lat: 36.35, lng: 127.39 })).toBeCloseTo(90, 1);
    expect(bearingDegrees(center, { lat: 36.34, lng: 127.38 })).toBeCloseTo(180, 1);
    expect(bearingDegrees(center, { lat: 36.35, lng: 127.37 })).toBeCloseTo(270, 1);
  });

  it("첫 위치와 정차 상태에서는 가장 가까운 경로 구간 방향을 사용한다", () => {
    const route = [[
      { lat: 36.35, lng: 127.38 },
      { lat: 36.36, lng: 127.39 },
    ]];
    const heading = routeHeadingAtCoordinate(
      { lat: 36.355, lng: 127.385 },
      route,
    );
    expect(heading).toBeGreaterThan(35);
    expect(heading).toBeLessThan(45);
    expect(
      resolveVehicleHeading({
        current: { lat: 36.355, lng: 127.385 },
        routeSegments: route,
      }),
    ).toBeCloseTo(heading!, 6);
  });

  it("실시간 위치가 충분히 이동하면 대각선 진행방향으로 갱신한다", () => {
    const heading = resolveVehicleHeading({
      previous: { lat: 36.35, lng: 127.38 },
      current: { lat: 36.351, lng: 127.381 },
      previousHeading: 90,
    });
    expect(heading).toBeGreaterThan(35);
    expect(heading).toBeLessThan(45);
  });

  it("GPS 미세 흔들림은 직전 방향을 뒤집지 않는다", () => {
    expect(
      resolveVehicleHeading({
        previous: { lat: 36.35, lng: 127.38 },
        current: { lat: 36.350001, lng: 127.379999 },
        previousHeading: 132,
      }),
    ).toBe(132);
  });
});
