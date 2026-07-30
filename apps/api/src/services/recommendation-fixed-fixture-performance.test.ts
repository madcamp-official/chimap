import {
  recommendationSchema,
  type BusRouteStop,
  type NormalizedRoute,
  type Recommendation,
} from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { ProviderError } from "../errors.js";
import type { MobilityProvider } from "../providers/types.js";
import {
  SelectedRouteGeometryService,
  type GeometrySkippedObservation,
} from "./selected-route-geometry-service.js";

const CASE_COUNT = 100;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fixture(index: number): Recommendation {
  const from = { lat: 36.35 + index * 0.00001, lng: 127.37 };
  const transfer = { lat: from.lat + 0.001, lng: 127.372 };
  const to = { lat: from.lat + 0.004, lng: 127.378 };
  const stops: BusRouteStop[] = [
    {
      routeId: `route-${index}`,
      stopId: `stop-${index}-1`,
      nodeId: `node-${index}-1`,
      cityCode: "25",
      stopName: "승차",
      latitude: transfer.lat,
      longitude: transfer.lng,
      nodeOrder: 1,
      direction: null,
    },
    {
      routeId: `route-${index}`,
      stopId: `stop-${index}-2`,
      nodeId: `node-${index}-2`,
      cityCode: "25",
      stopName: "하차",
      latitude: to.lat,
      longitude: to.lng,
      nodeOrder: 2,
      direction: null,
    },
  ];
  const stopRef = (stop: BusRouteStop) => ({
    id: stop.stopId,
    cityCode: stop.cityCode,
    nodeId: stop.nodeId,
    sourceStopNo: null,
    arsId: null,
    name: stop.stopName,
    latitude: stop.latitude,
    longitude: stop.longitude,
    source: "database" as const,
  });
  return {
    id: `fixture-${index}`,
    type: "FAST",
    title: "고정 fixture",
    reason: "성능 회귀",
    durationSeconds: 900,
    arrivalAt: "2026-07-30T06:00:00.000Z",
    extraMinutes: 0,
    walkDistanceMeters: 250,
    estimatedSteps: 360,
    stepDifference: -100,
    goalFit: "UNDER",
    expectedTotalSteps: 5_360,
    dailyGoalCompletionRate: 0.67,
    shortfallCoverageRate: 0.13,
    transferCount: 0,
    legs: [
      {
        id: `fixture-${index}-walk`,
        mode: "WALK",
        distanceMeters: 250,
        durationSeconds: 200,
        coordinates: [from, transfer],
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: false,
        walkingRole: "ACCESS",
      },
      {
        id: `fixture-${index}-bus`,
        mode: "BUS",
        name: "fixture",
        distanceMeters: 1_200,
        durationSeconds: 700,
        coordinates: [transfer, to],
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: false,
        bus: {
          routeId: `route-${index}`,
          cityCode: "25",
          routeNo: "fixture",
          routeType: null,
          boardingStop: stopRef(stops[0]!),
          alightingStop: stopRef(stops[1]!),
          stopCount: 1,
          boardingNodeOrder: 1,
          alightingNodeOrder: 2,
          expectedArrivalSeconds: 120,
          expectedRideSeconds: 580,
          vehicleNo: null,
          vehicleType: null,
          isArrivalRealtime: false,
          polyline: [transfer, to],
          stops,
        },
      },
    ],
  };
}

function fixtureIndex(value: string): number {
  return Number(value.slice(value.lastIndexOf("-") + 1));
}

describe("추천 geometry 100건 고정 fixture 성능 게이트", () => {
  it("정상·지연·provider timeout을 격리하고 20초 전에 모두 종료한다", async () => {
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute: async (request): Promise<NormalizedRoute> => {
        const index = Math.round((request.origin.lat - 36.35) * 100_000);
        const mode = index % 4;
        if (mode === 1) await wait(2);
        if (mode === 2) {
          throw new ProviderError({
            kind: "TIMEOUT",
            message: "walking fixture timeout",
          });
        }
        const middle = {
          lat: (request.origin.lat + request.destination.lat) / 2,
          lng: (request.origin.lng + request.destination.lng) / 2,
        };
        return {
          id: `walk-${index}`,
          source: "KAKAO",
          durationSeconds: 999,
          distanceMeters: 999,
          walkDistanceMeters: 999,
          transitDistanceMeters: 0,
          transferCount: 0,
          legs: [{
            id: `walk-${index}-leg`,
            mode: "WALK",
            distanceMeters: 999,
            durationSeconds: 999,
            coordinates: [request.origin, middle, request.destination],
            isExerciseSegment: false,
          }],
        };
      },
      resolveBusGeometry: async ({ stops }) => {
        const index = fixtureIndex(stops[0]!.routeId);
        const mode = index % 4;
        if (mode === 1) await wait(2);
        if (mode === 3) {
          throw new ProviderError({
            kind: "TIMEOUT",
            message: "bus fixture timeout",
          });
        }
        const from = {
          lat: stops[0]!.latitude,
          lng: stops[0]!.longitude,
        };
        const to = {
          lat: stops[1]!.latitude,
          lng: stops[1]!.longitude,
        };
        return {
          coordinates: [
            from,
            {
              lat: (from.lat + to.lat) / 2,
              lng: (from.lng + to.lng) / 2,
            },
            to,
          ],
          quality: "DETAILED",
          reason: "NONE",
        };
      },
    };
    const service = new SelectedRouteGeometryService(provider);
    const skipped: GeometrySkippedObservation[] = [];
    const durations: number[] = [];

    const results = await Promise.all(
      Array.from({ length: CASE_COUNT }, async (_, index) => {
        const input = fixture(index);
        const startedAt = performance.now();
        const [result] = await service.enrich(
          [input],
          undefined,
          undefined,
          { observeSkipped: (observation) => skipped.push(observation) },
        );
        durations.push(performance.now() - startedAt);
        expect(result).toBeDefined();
        expect(recommendationSchema.safeParse(result).success).toBe(true);
        expect(result).toMatchObject({
          id: input.id,
          durationSeconds: input.durationSeconds,
          arrivalAt: input.arrivalAt,
          walkDistanceMeters: input.walkDistanceMeters,
          estimatedSteps: input.estimatedSteps,
        });
        const walkingTimedOut = index % 4 === 2;
        expect(result!.legs[0]).toMatchObject({
          id: input.legs[0]!.id,
          distanceMeters: walkingTimedOut ? 250 : 999,
          durationSeconds: walkingTimedOut ? 200 : 999,
        });
        expect(result!.legs[1]).toMatchObject({
          id: input.legs[1]!.id,
          distanceMeters: input.legs[1]!.distanceMeters,
          durationSeconds: input.legs[1]!.durationSeconds,
        });
        return result!;
      }),
    );

    results.forEach((result, index) => {
      const mode = index % 4;
      expect(result.legs[0]?.geometryQuality).toBe(
        mode === 2 ? "APPROXIMATE" : "DETAILED",
      );
      expect(result.legs[1]?.geometryQuality).toBe(
        mode === 3 ? "APPROXIMATE" : "DETAILED",
      );
    });
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const p95 = sortedDurations[Math.ceil(CASE_COUNT * 0.95) - 1]!;
    expect(results).toHaveLength(CASE_COUNT);
    expect(skipped).not.toContainEqual(expect.objectContaining({
      reason: "BUDGET_EXHAUSTED_BEFORE_START",
    }));
    expect(p95).toBeLessThan(1_000);
    expect(Math.max(...durations)).toBeLessThan(20_000);
  });
});
