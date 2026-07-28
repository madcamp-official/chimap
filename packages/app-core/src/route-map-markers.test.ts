import type { Recommendation } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { buildJourneyMapMarkers } from "./route-map-markers.js";

const origin = { lat: 36.37, lng: 127.36 };
const destination = { lat: 36.33, lng: 127.43 };

const route: Recommendation = {
  id: "transfer-route",
  type: "FAST",
  title: "환승 경로",
  reason: "테스트",
  durationSeconds: 1_000,
  arrivalAt: "2026-07-28T12:00:00+09:00",
  extraMinutes: 0,
  walkDistanceMeters: 300,
  estimatedSteps: 400,
  stepDifference: 0,
  goalFit: "WITHIN_TOLERANCE",
  expectedTotalSteps: 8_000,
  dailyGoalCompletionRate: 1,
  shortfallCoverageRate: 1,
  transferCount: 1,
  legs: [
    {
      id: "subway-one",
      mode: "SUBWAY",
      name: "대전 1호선",
      distanceMeters: 1_000,
      durationSeconds: 300,
      coordinates: [origin, { lat: 36.36, lng: 127.38 }],
      stops: ["출발역", "환승역"],
      isExerciseSegment: false,
    },
    {
      id: "transfer-walk",
      mode: "WALK",
      distanceMeters: 100,
      durationSeconds: 80,
      coordinates: [
        { lat: 36.36, lng: 127.38 },
        { lat: 36.359, lng: 127.381 },
      ],
      isExerciseSegment: false,
      walkingRole: "TRANSFER",
    },
    {
      id: "subway",
      mode: "SUBWAY",
      name: "대전 2호선",
      distanceMeters: 4_000,
      durationSeconds: 600,
      stops: ["정부청사", "대전"],
      coordinates: [
        { lat: 36.359, lng: 127.381 },
        destination,
      ],
      isExerciseSegment: false,
    },
  ],
};

describe("buildJourneyMapMarkers", () => {
  it("개별 승하차를 반복하지 않고 출발·환승·도착만 만든다", () => {
    const markers = buildJourneyMapMarkers({
      route,
      origin,
      destination,
      originName: "한국과학기술원",
      destinationName: "대전역",
    });

    expect(markers.map((marker) => marker.label)).toEqual([
      "출발",
      "환승",
      "도착",
    ]);
    expect(markers.map((marker) => marker.role)).toEqual([
      "ORIGIN",
      "TRANSFER",
      "DESTINATION",
    ]);
    expect(markers[1]).toMatchObject({
      coordinate: { lat: 36.359, lng: 127.381 },
      title: "정부청사 · 대전 1호선에서 대전 2호선으로 환승",
    });
  });

  it("환승 없는 경로에는 출발과 도착만 만든다", () => {
    const markers = buildJourneyMapMarkers({
      route: { ...route, transferCount: 0 },
      origin,
      destination,
    });
    expect(markers.map((marker) => marker.label)).toEqual(["출발", "도착"]);
  });
});
