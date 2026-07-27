import { describe, expect, it } from "vitest";

import {
  isPlausibleRoadSection,
  roadGeometryForWaypoints,
} from "./kakao-provider.js";

const emart = { lat: 36.355156, lng: 127.37922 };
const galleria = { lat: 36.35272, lng: 127.37907 };

describe("Kakao 버스 도로 구간 검증", () => {
  it("가까운 정류장 사이의 과도한 블록 우회를 거부한다", () => {
    const detour = [
      emart,
      { lat: 36.3551, lng: 127.375 },
      { lat: 36.3527, lng: 127.375 },
      galleria,
    ];

    expect(isPlausibleRoadSection(detour, emart, galleria)).toBe(false);
    expect(roadGeometryForWaypoints([detour], [emart, galleria])).toEqual([
      emart,
      galleria,
    ]);
  });

  it("정류장 사이의 정상적인 도로 곡선은 유지한다", () => {
    const road = [
      { lat: 36.35514, lng: 127.37921 },
      { lat: 36.3539, lng: 127.37913 },
      { lat: 36.35274, lng: 127.37908 },
    ];

    expect(isPlausibleRoadSection(road, emart, galleria)).toBe(true);
    expect(roadGeometryForWaypoints([road], [emart, galleria])).toEqual([
      emart,
      ...road,
      galleria,
    ]);
  });

  it("응답 구간 수와 경유지 수가 다르면 정류장 순서로 안전하게 대체한다", () => {
    expect(
      roadGeometryForWaypoints([], [
        emart,
        galleria,
        { lat: 36.3509, lng: 127.37786 },
      ]),
    ).toEqual([
      emart,
      galleria,
      { lat: 36.3509, lng: 127.37786 },
    ]);
  });
});
