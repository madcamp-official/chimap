import { describe, expect, it } from "vitest";

import {
  assembleSubwayRideGeometry,
  type SubwayRideGeometryEdge,
} from "./subway-track-geometry.js";

const a = { lat: 36.35, lng: 127.38 };
const b = { lat: 36.35, lng: 127.39 };
const c = { lat: 36.35, lng: 127.4 };

function edge(
  input: Partial<SubwayRideGeometryEdge> &
    Pick<SubwayRideGeometryEdge, "from" | "to">,
): SubwayRideGeometryEdge {
  return {
    straightDistanceMeters: 900,
    trackCoordinates: [input.from, input.to],
    trackDistanceMeters: 1_000,
    geometrySource: "OpenStreetMap relation 1",
    ...input,
  };
}

describe("지하철 선로 geometry 결합", () => {
  it("track-v1이 없으면 기존 역 좌표와 직선거리를 유지한다", () => {
    const result = assembleSubwayRideGeometry({
      edges: [edge({ from: a, to: b })],
      stationCoordinates: [a, b],
    });

    expect(result).toMatchObject({
      coordinates: [a, b],
      distanceMeters: 900,
      usedTrackGeometry: false,
      observation: { reason: "PROFILE_DISABLED" },
    });
  });

  it("곡선 정점을 유지하고 접합 역의 중복 정점을 제거한다", () => {
    const curve1 = { lat: 36.354, lng: 127.385 };
    const curve2 = { lat: 36.346, lng: 127.395 };
    const result = assembleSubwayRideGeometry({
      profile: "TRACK_V1",
      edges: [
        edge({
          from: a,
          to: b,
          trackCoordinates: [a, curve1, b],
          trackDistanceMeters: 1_100,
        }),
        edge({
          from: b,
          to: c,
          trackCoordinates: [b, curve2, c],
          trackDistanceMeters: 1_200,
        }),
      ],
      stationCoordinates: [a, b, c],
    });

    expect(result.coordinates).toEqual([a, curve1, b, curve2, c]);
    expect(result.distanceMeters).toBe(2_300);
    expect(result.observation).toEqual({
      outcome: "track",
      reason: "NONE",
      source: "OSM",
      vertexCount: 5,
    });
  });

  it("반대 방향으로 저장된 구간을 출발→도착 순서로 보정한다", () => {
    const curve = { lat: 36.354, lng: 127.385 };
    const result = assembleSubwayRideGeometry({
      profile: "TRACK_V1",
      edges: [edge({ from: a, to: b, trackCoordinates: [b, curve, a] })],
      stationCoordinates: [a, b],
    });

    expect(result.coordinates).toEqual([a, curve, b]);
    expect(result.usedTrackGeometry).toBe(true);
  });

  it("한 구간이라도 없으면 전체 승차 leg를 기존 직선으로 fallback한다", () => {
    const result = assembleSubwayRideGeometry({
      profile: "TRACK_V1",
      edges: [
        edge({ from: a, to: b }),
        edge({ from: b, to: c, trackCoordinates: null }),
      ],
      stationCoordinates: [a, b, c],
    });

    expect(result.coordinates).toEqual([a, b, c]);
    expect(result.distanceMeters).toBe(1_800);
    expect(result.observation.reason).toBe("MISSING_GEOMETRY");
  });

  it("구간 접합점이 크게 끊기면 임의로 연결하지 않고 전체 fallback한다", () => {
    const firstEnd = { lat: 36.35, lng: 127.388 };
    const secondStart = { lat: 36.35, lng: 127.392 };
    const result = assembleSubwayRideGeometry({
      profile: "TRACK_V1",
      edges: [
        edge({ from: a, to: b, trackCoordinates: [a, firstEnd] }),
        edge({ from: b, to: c, trackCoordinates: [secondStart, c] }),
      ],
      stationCoordinates: [a, b, c],
    });

    expect(result.coordinates).toEqual([a, b, c]);
    expect(result.observation.reason).toBe("CONTINUITY_GAP");
  });
});
