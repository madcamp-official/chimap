import type { NormalizedRoute, Recommendation } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { ProviderError } from "../errors.js";
import type { MobilityProvider } from "../providers/types.js";
import { CandidateGenerator, rebuildRoute } from "./candidate-generator.js";

describe("대중교통 목표 걸음 경로 재구성", () => {
  it("시간표 기반 지하철의 비실시간 상태와 시간 합계를 보존한다", () => {
    const base: NormalizedRoute = {
      id: "mixed-base",
      source: "TAGO",
      durationSeconds: 600,
      distanceMeters: 1_500,
      walkDistanceMeters: 0,
      transitDistanceMeters: 1_500,
      transferCount: 1,
      waitingDurationSeconds: 200,
      ridingDurationSeconds: 400,
      isRealtime: false,
      estimationNotes: ["TAGO 시간표 기반 예상"],
      legs: [
        {
          id: "subway",
          mode: "SUBWAY",
          name: "대전 1호선",
          distanceMeters: 1_000,
          durationSeconds: 400,
          coordinates: [
            { lat: 36.35, lng: 127.38 },
            { lat: 36.33, lng: 127.42 },
          ],
          isExerciseSegment: false,
          subway: {
            serviceLineId: "daejeon-1",
            lineName: "대전 1호선",
            boardingStation: {
              stationLineId: "1",
              sourceStationKey: "S3001|101",
              name: "반석",
              location: { lat: 36.35, lng: 127.38 },
            },
            alightingStation: {
              stationLineId: "2",
              sourceStationKey: "S3001|104",
              name: "대전",
              location: { lat: 36.33, lng: 127.42 },
            },
            stationCount: 3,
            rideDurationSeconds: 200,
            direction: "DOWN",
            destinationName: null,
            intermediateStations: [],
          },
        },
        {
          id: "bus",
          mode: "BUS",
          name: "501",
          distanceMeters: 500,
          durationSeconds: 200,
          coordinates: [
            { lat: 36.33, lng: 127.42 },
            { lat: 36.33, lng: 127.43 },
          ],
          isExerciseSegment: false,
          bus: {
            routeId: "route-501",
            cityCode: "25",
            routeNo: "501",
            routeType: null,
            boardingStop: {
              id: "stop-1", cityCode: "25", nodeId: "node-1",
              sourceStopNo: null, arsId: null, name: "승차",
              latitude: 36.33, longitude: 127.42, source: "database",
            },
            alightingStop: {
              id: "stop-2", cityCode: "25", nodeId: "node-2",
              sourceStopNo: null, arsId: null, name: "하차",
              latitude: 36.33, longitude: 127.43, source: "database",
            },
            stopCount: 1,
            boardingNodeOrder: 1,
            alightingNodeOrder: 2,
            expectedArrivalSeconds: 100,
            expectedRideSeconds: 100,
            vehicleNo: null,
            vehicleType: null,
            isArrivalRealtime: false,
            polyline: [
              { lat: 36.33, lng: 127.42 },
              { lat: 36.33, lng: 127.43 },
            ],
            stops: [
              { routeId: "route-501", stopId: "stop-1", nodeId: "node-1", cityCode: "25", stopName: "승차", latitude: 36.33, longitude: 127.42, nodeOrder: 1, direction: null },
              { routeId: "route-501", stopId: "stop-2", nodeId: "node-2", cityCode: "25", stopName: "하차", latitude: 36.33, longitude: 127.43, nodeOrder: 2, direction: null },
            ],
          },
        },
      ],
    };

    const rebuilt = rebuildRoute(
      base,
      base.legs,
      "mixed-adjusted",
      "EARLY_ALIGHT",
    );

    expect(rebuilt).toMatchObject({
      isRealtime: false,
      waitingDurationSeconds: 200,
      ridingDurationSeconds: 400,
    });
  });

  it("transit-v2 후보 도보 형상 취소는 근사 경로로 격리한다", async () => {
    const stops = [
      { nodeId: "n1", name: "첫 정류장", lat: 36.35, lng: 127.37 },
      { nodeId: "n2", name: "둘째 정류장", lat: 36.352, lng: 127.372 },
      { nodeId: "n3", name: "셋째 정류장", lat: 36.354, lng: 127.374 },
      { nodeId: "n4", name: "마지막 정류장", lat: 36.356, lng: 127.376 },
    ].map((stop, index) => ({
      routeId: "route-514",
      stopId: `stop-${index + 1}`,
      nodeId: stop.nodeId,
      cityCode: "25",
      stopName: stop.name,
      latitude: stop.lat,
      longitude: stop.lng,
      nodeOrder: index + 1,
      direction: null,
    }));
    const stopRef = (index: number) => ({
      id: stops[index]!.stopId,
      cityCode: "25",
      nodeId: stops[index]!.nodeId,
      sourceStopNo: null,
      arsId: null,
      name: stops[index]!.stopName,
      latitude: stops[index]!.latitude,
      longitude: stops[index]!.longitude,
      source: "database" as const,
    });
    const route: NormalizedRoute = {
      id: "bus-base",
      source: "TAGO",
      durationSeconds: 600,
      distanceMeters: 1_000,
      walkDistanceMeters: 0,
      transitDistanceMeters: 1_000,
      transferCount: 0,
      legs: [{
        id: "bus-514",
        mode: "BUS",
        name: "514",
        distanceMeters: 1_000,
        durationSeconds: 600,
        coordinates: stops.map((stop) => ({
          lat: stop.latitude,
          lng: stop.longitude,
        })),
        isExerciseSegment: false,
        bus: {
          routeId: "route-514",
          cityCode: "25",
          routeNo: "514",
          routeType: null,
          boardingStop: stopRef(0),
          alightingStop: stopRef(3),
          stopCount: 3,
          boardingNodeOrder: 1,
          alightingNodeOrder: 4,
          expectedArrivalSeconds: 120,
          expectedRideSeconds: 480,
          vehicleNo: null,
          vehicleType: null,
          isArrivalRealtime: false,
          polyline: stops.map((stop) => ({
            lat: stop.latitude,
            lng: stop.longitude,
          })),
          stops,
        },
      }],
    };
    const getWalkingRoute = vi.fn(async () => {
      throw new ProviderError({ kind: "ABORTED", message: "cancelled" });
    });
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [route],
      getWalkingRoute,
    };

    const generated = await new CandidateGenerator(provider).generate(
      {
        origin: {
          id: "origin",
          name: "출발",
          address: "",
          roadAddress: "",
          category: "",
          location: { lat: 36.349, lng: 127.369 },
        },
        destination: {
          id: "destination",
          name: "도착",
          address: "",
          roadAddress: "",
          category: "",
          location: { lat: 36.358, lng: 127.378 },
        },
        currentSteps: 0,
        goalSteps: 2_000,
        walkingMetric: {
          stepLengthMeters: 0.7,
          source: "RESEARCH_ESTIMATE",
          modelVersion: "HAN_2026_V1",
        },
      },
      undefined,
      { geometryProfile: "TRANSIT_V2" },
    );

    expect(generated.candidates.length).toBeGreaterThan(1);
    expect(
      generated.candidates.some((candidate) =>
        candidate.route.legs.some(
          (leg) => leg.mode === "WALK" && leg.geometryQuality === "APPROXIMATE",
        ),
      ),
    ).toBe(true);
    expect(getWalkingRoute).not.toHaveBeenCalled();
  });

  it("최종 선택된 중복 도보 구간만 한 번 상세화하고 ETA·거리는 유지한다", async () => {
    const from = { lat: 36.35, lng: 127.37 };
    const middle = { lat: 36.351, lng: 127.3715 };
    const to = { lat: 36.352, lng: 127.373 };
    const getWalkingRoute = vi.fn(async (): Promise<NormalizedRoute> => ({
      id: "kakao-walk",
      source: "KAKAO",
      durationSeconds: 999,
      distanceMeters: 999,
      walkDistanceMeters: 999,
      transitDistanceMeters: 0,
      transferCount: 0,
      legs: [{
        id: "kakao-walk-leg",
        mode: "WALK",
        guidance: "상세 도보",
        distanceMeters: 999,
        durationSeconds: 999,
        coordinates: [from, middle, to],
        isExerciseSegment: false,
      }],
    }));
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute,
    };
    const recommendation: Recommendation = {
      id: "selected",
      type: "FAST",
      title: "빠른 경로",
      reason: "test",
      durationSeconds: 600,
      arrivalAt: "2026-07-28T03:10:00.000Z",
      extraMinutes: 0,
      walkDistanceMeters: 300,
      estimatedSteps: 430,
      stepDifference: -100,
      goalFit: "UNDER",
      expectedTotalSteps: 430,
      dailyGoalCompletionRate: 0.1,
      shortfallCoverageRate: 0.1,
      transferCount: 0,
      legs: [{
        id: "selected-walk",
        mode: "WALK",
        guidance: "근사 도보",
        distanceMeters: 300,
        durationSeconds: 240,
        coordinates: [from, to],
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: false,
        walkingRole: "ACCESS",
      }],
    };
    const observations: unknown[] = [];
    const enriched = await new CandidateGenerator(provider).enrichWalkingGeometry(
      [recommendation, { ...recommendation, id: "selected-duplicate" }],
      undefined,
      (observation) => observations.push(observation),
    );

    expect(getWalkingRoute).toHaveBeenCalledTimes(1);
    expect(enriched).toHaveLength(2);
    for (const result of enriched) {
      expect(result.durationSeconds).toBe(600);
      expect(result.walkDistanceMeters).toBe(300);
      expect(result.legs[0]).toMatchObject({
        durationSeconds: 240,
        distanceMeters: 300,
        coordinates: [from, middle, to],
        geometryQuality: "DETAILED",
      });
    }
    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({
      outcome: "DETAILED",
      source: "KAKAO_WALK",
      walkingRole: "ACCESS",
    });
  });
});
