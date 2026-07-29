import { buildJourneyMapMarkers } from "@chimap/app-core";
import type { Recommendation } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

const origin = { lat: 36.37, lng: 127.36 };
const destination = { lat: 36.33, lng: 127.43 };

function recommendation(
  transferCoordinate = { lat: 36.359, lng: 127.381 },
): Recommendation {
  return {
    id: "mobile-marker-route",
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
        coordinates: [origin, transferCoordinate],
        stops: ["출발역", "환승역"],
        isExerciseSegment: false,
      },
      {
        id: "subway-two",
        mode: "SUBWAY",
        name: "대전 2호선",
        distanceMeters: 4_000,
        durationSeconds: 600,
        coordinates: [transferCoordinate, destination],
        stops: ["환승역", "도착역"],
        isExerciseSegment: false,
      },
    ],
  };
}

describe("mobile journey map markers", () => {
  it("환승 없는 경로에는 출발과 도착만 표시한다", () => {
    const markers = buildJourneyMapMarkers({
      route: { ...recommendation(), transferCount: 0 },
      origin,
      destination,
    });

    expect(markers.map((marker) => marker.role)).toEqual([
      "ORIGIN",
      "DESTINATION",
    ]);
  });

  it("환승 경로에는 출발·환승·도착을 경로 순서로 표시한다", () => {
    const markers = buildJourneyMapMarkers({
      route: recommendation(),
      origin,
      destination,
    });

    expect(markers.map((marker) => marker.role)).toEqual([
      "ORIGIN",
      "TRANSFER",
      "DESTINATION",
    ]);
  });

  it("도착지와 15m 이내인 환승 마커는 도착 마커보다 우선하지 않는다", () => {
    const markers = buildJourneyMapMarkers({
      route: recommendation({
        lat: destination.lat + 0.00001,
        lng: destination.lng + 0.00001,
      }),
      origin,
      destination,
    });

    expect(markers.map((marker) => marker.role)).toEqual([
      "ORIGIN",
      "DESTINATION",
    ]);
  });
});
