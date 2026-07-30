import type {
  BusRouteStop,
  NormalizedRoute,
  Recommendation,
} from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import type { MobilityProvider } from "../providers/types.js";
import { SelectedRouteGeometryService } from "./selected-route-geometry-service.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
}

const walkFrom = { lat: 36.35, lng: 127.37 };
const walkTo = { lat: 36.352, lng: 127.373 };
const walkMiddle = { lat: 36.351, lng: 127.3715 };
const stops: BusRouteStop[] = [
  {
    routeId: "route-514",
    stopId: "stop-1",
    nodeId: "node-1",
    cityCode: "25",
    stopName: "승차",
    latitude: 36.352,
    longitude: 127.373,
    nodeOrder: 1,
    direction: null,
  },
  {
    routeId: "route-514",
    stopId: "stop-2",
    nodeId: "node-2",
    cityCode: "25",
    stopName: "하차",
    latitude: 36.356,
    longitude: 127.379,
    nodeOrder: 2,
    direction: null,
  },
];
const detailedBusCoordinates = [
  { lat: 36.352, lng: 127.373 },
  { lat: 36.354, lng: 127.375 },
  { lat: 36.356, lng: 127.379 },
];

function recommendation(id: string, from = walkFrom): Recommendation {
  return {
    id,
    type: "FAST",
    title: "빠른 경로",
    reason: "test",
    durationSeconds: 900,
    arrivalAt: "2026-07-30T04:00:00.000Z",
    extraMinutes: 0,
    walkDistanceMeters: 300,
    estimatedSteps: 430,
    stepDifference: -100,
    goalFit: "UNDER",
    expectedTotalSteps: 430,
    dailyGoalCompletionRate: 0.1,
    shortfallCoverageRate: 0.1,
    transferCount: 0,
    legs: [
      {
        id: `${id}-walk`,
        mode: "WALK",
        distanceMeters: 300,
        durationSeconds: 240,
        coordinates: [from, walkTo],
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: false,
        walkingRole: "ACCESS",
      },
      {
        id: `${id}-bus`,
        mode: "BUS",
        name: "514",
        distanceMeters: 1_200,
        durationSeconds: 660,
        coordinates: stops.map((stop) => ({
          lat: stop.latitude,
          lng: stop.longitude,
        })),
        geometryQuality: "APPROXIMATE",
        isExerciseSegment: false,
        bus: {
          routeId: "route-514",
          cityCode: "25",
          routeNo: "514",
          routeType: null,
          boardingStop: {
            id: "stop-1",
            cityCode: "25",
            nodeId: "node-1",
            sourceStopNo: null,
            arsId: null,
            name: "승차",
            latitude: 36.352,
            longitude: 127.373,
            source: "database",
          },
          alightingStop: {
            id: "stop-2",
            cityCode: "25",
            nodeId: "node-2",
            sourceStopNo: null,
            arsId: null,
            name: "하차",
            latitude: 36.356,
            longitude: 127.379,
            source: "database",
          },
          stopCount: 1,
          boardingNodeOrder: 1,
          alightingNodeOrder: 2,
          expectedArrivalSeconds: 120,
          expectedRideSeconds: 540,
          vehicleNo: null,
          vehicleType: null,
          isArrivalRealtime: false,
          polyline: stops.map((stop) => ({
            lat: stop.latitude,
            lng: stop.longitude,
          })),
          stops,
        },
      },
    ],
  };
}

describe("선택 경로 형상 상세화", () => {
  it("GOAL WALK barrier 뒤에는 나머지 BUS/WALK 상세화를 기다리지 않는다", async () => {
    const goalWalkingGate = deferred();
    const otherWalkingGate = deferred();
    const busGate = deferred();
    const otherWalkFrom = {
      lat: walkFrom.lat + 0.01,
      lng: walkFrom.lng + 0.01,
    };
    const getWalkingRoute = vi.fn(async (
      walkingRequest: Parameters<MobilityProvider["getWalkingRoute"]>[0],
    ): Promise<NormalizedRoute> => {
      const isGoal = walkingRequest.origin.lat === walkFrom.lat &&
        walkingRequest.origin.lng === walkFrom.lng;
      await (isGoal ? goalWalkingGate.promise : otherWalkingGate.promise);
      return {
        id: isGoal ? "goal-walk-detail" : "other-walk-detail",
        source: "KAKAO",
        durationSeconds: 1,
        distanceMeters: 1,
        walkDistanceMeters: 1,
        transitDistanceMeters: 0,
        transferCount: 0,
        legs: [{
          id: isGoal ? "goal-walk-detail-leg" : "other-walk-detail-leg",
          mode: "WALK",
          distanceMeters: 1,
          durationSeconds: 1,
          coordinates: [
            walkingRequest.origin,
            walkMiddle,
            walkingRequest.destination,
          ],
          isExerciseSegment: false,
        }],
      };
    });
    const resolveBusGeometry = vi.fn(async () => {
      await busGate.promise;
      return {
        coordinates: detailedBusCoordinates,
        quality: "DETAILED" as const,
        reason: "NONE" as const,
      };
    });
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute,
      resolveBusGeometry,
    };
    const goal = { ...recommendation("goal"), type: "GOAL" as const };
    const other = recommendation("other", otherWalkFrom);

    const plan = new SelectedRouteGeometryService(provider).prepare([
      goal,
      other,
    ]);
    let completeSettled = false;
    void plan.complete.then(() => {
      completeSettled = true;
    });

    await vi.waitFor(() => {
      expect(getWalkingRoute).toHaveBeenCalledTimes(2);
      expect(resolveBusGeometry).toHaveBeenCalledTimes(1);
    });
    goalWalkingGate.resolve();
    const goalReady = await plan.goalWalking;

    expect(goalReady[0]?.legs[0]).toMatchObject({
      coordinates: [walkFrom, walkMiddle, walkTo],
      geometryQuality: "DETAILED",
    });
    expect(goalReady[0]?.legs[1]).toEqual(goal.legs[1]);
    expect(goalReady[1]).toBe(other);
    expect(completeSettled).toBe(false);

    otherWalkingGate.resolve();
    busGate.resolve();
    const completed = await plan.complete;

    expect(completed[0]?.legs[1]).toMatchObject({
      coordinates: detailedBusCoordinates,
      geometryQuality: "DETAILED",
    });
    expect(completed[1]?.legs[0]?.geometryQuality).toBe("DETAILED");
  });

  it("선택된 최대 3개 경로의 중복 BUS/WALK를 한 번씩 동시에 조회하고 지표는 유지한다", async () => {
    const walkingGate = deferred();
    const busGate = deferred();
    const getWalkingRoute = vi.fn(async (): Promise<NormalizedRoute> => {
      await walkingGate.promise;
      return {
        id: "walk-detail",
        source: "KAKAO",
        durationSeconds: 999,
        distanceMeters: 999,
        walkDistanceMeters: 999,
        transitDistanceMeters: 0,
        transferCount: 0,
        legs: [{
          id: "walk-detail-leg",
          mode: "WALK",
          distanceMeters: 999,
          durationSeconds: 999,
          coordinates: [walkFrom, walkMiddle, walkTo],
          isExerciseSegment: false,
        }],
      };
    });
    const resolveBusGeometry = vi.fn(async () => {
      await busGate.promise;
      return {
        coordinates: detailedBusCoordinates,
        quality: "DETAILED" as const,
        reason: "NONE" as const,
      };
    });
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute,
      resolveBusGeometry,
    };
    const fourth = recommendation("fourth", {
      lat: walkFrom.lat + 0.01,
      lng: walkFrom.lng + 0.01,
    });
    const input = [
      recommendation("first"),
      recommendation("second"),
      recommendation("third"),
      fourth,
    ];
    const beforeMetrics = input.map((item) => ({
      durationSeconds: item.durationSeconds,
      arrivalAt: item.arrivalAt,
      walkDistanceMeters: item.walkDistanceMeters,
      estimatedSteps: item.estimatedSteps,
      legMetrics: item.legs.map((leg) => ({
        durationSeconds: leg.durationSeconds,
        distanceMeters: leg.distanceMeters,
      })),
    }));
    const observe = vi.fn();

    const pending = new SelectedRouteGeometryService(provider).enrich(
      input,
      undefined,
      observe,
    );
    await vi.waitFor(() => {
      expect(getWalkingRoute).toHaveBeenCalledTimes(1);
      expect(resolveBusGeometry).toHaveBeenCalledTimes(1);
    });
    walkingGate.resolve();
    busGate.resolve();
    const result = await pending;

    expect(result.map((item) => ({
      durationSeconds: item.durationSeconds,
      arrivalAt: item.arrivalAt,
      walkDistanceMeters: item.walkDistanceMeters,
      estimatedSteps: item.estimatedSteps,
      legMetrics: item.legs.map((leg) => ({
        durationSeconds: leg.durationSeconds,
        distanceMeters: leg.distanceMeters,
      })),
    }))).toEqual(beforeMetrics);
    for (const item of result.slice(0, 3)) {
      expect(item.legs[0]).toMatchObject({
        coordinates: [walkFrom, walkMiddle, walkTo],
        geometryQuality: "DETAILED",
      });
      expect(item.legs[1]).toMatchObject({
        coordinates: detailedBusCoordinates,
        geometryQuality: "DETAILED",
        bus: { polyline: detailedBusCoordinates },
      });
    }
    expect(result[3]).toBe(fourth);
    expect(
      observe.mock.calls.filter(([observation]) =>
        observation.mode === "WALK"
      ),
    ).toHaveLength(1);
  });

  it("한 mode의 실패를 다른 mode의 상세화와 추천 응답에서 격리한다", async () => {
    const getWalkingRoute = vi.fn(async (): Promise<NormalizedRoute> => ({
      id: "walk-detail",
      source: "KAKAO",
      durationSeconds: 1,
      distanceMeters: 1,
      walkDistanceMeters: 1,
      transitDistanceMeters: 0,
      transferCount: 0,
      legs: [{
        id: "walk-detail-leg",
        mode: "WALK",
        distanceMeters: 1,
        durationSeconds: 1,
        coordinates: [walkFrom, walkMiddle, walkTo],
        isExerciseSegment: false,
      }],
    }));
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute,
      resolveBusGeometry: vi.fn(async () => {
        throw new Error("road provider failed");
      }),
    };
    const original = recommendation("selected");
    const observe = vi.fn(() => {
      throw new Error("metrics exporter failed");
    });

    const [result] = await new SelectedRouteGeometryService(provider).enrich(
      [original],
      undefined,
      observe,
    );

    expect(result?.legs[0]?.geometryQuality).toBe("DETAILED");
    expect(result?.legs[1]).toEqual(original.legs[1]);
    expect(result?.durationSeconds).toBe(original.durationSeconds);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it("BUS provider가 관측 뒤 실패해도 stable key를 한 번만 기록한다", async () => {
    const observe = vi.fn();
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute: vi.fn(async (): Promise<NormalizedRoute> => ({
        id: "walk-detail",
        source: "KAKAO",
        durationSeconds: 1,
        distanceMeters: 1,
        walkDistanceMeters: 1,
        transitDistanceMeters: 0,
        transferCount: 0,
        legs: [{
          id: "walk-detail-leg",
          mode: "WALK",
          distanceMeters: 1,
          durationSeconds: 1,
          coordinates: [walkFrom, walkMiddle, walkTo],
          isExerciseSegment: false,
        }],
      })),
      resolveBusGeometry: vi.fn(async ({ observe: observeBus }) => {
        observeBus?.({
          mode: "BUS",
          outcome: "APPROXIMATE",
          reason: "UPSTREAM",
          source: "FALLBACK",
          cacheState: "MISS",
          durationMilliseconds: 1,
          inputVertexCount: 2,
          outputVertexCount: 2,
          successfulSectionCount: 0,
          failedSectionCount: 1,
        });
        throw new Error("provider failed after observation");
      }),
    };

    await expect(new SelectedRouteGeometryService(provider).enrich(
      [recommendation("selected")],
      undefined,
      observe,
    )).resolves.toHaveLength(1);

    expect(observe.mock.calls.filter(
      ([observation]) => observation.mode === "BUS",
    )).toHaveLength(1);
  });

  it("legacy walking-only 경로에서는 BUS provider를 호출하지 않는다", async () => {
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute: vi.fn(async (): Promise<NormalizedRoute> => ({
        id: "walk-detail",
        source: "KAKAO",
        durationSeconds: 1,
        distanceMeters: 1,
        walkDistanceMeters: 1,
        transitDistanceMeters: 0,
        transferCount: 0,
        legs: [{
          id: "walk-detail-leg",
          mode: "WALK",
          distanceMeters: 1,
          durationSeconds: 1,
          coordinates: [walkFrom, walkMiddle, walkTo],
          isExerciseSegment: false,
        }],
      })),
      resolveBusGeometry: vi.fn(async () => ({
        coordinates: detailedBusCoordinates,
        quality: "DETAILED" as const,
        reason: "NONE" as const,
      })),
    };
    const original = recommendation("legacy");

    const [result] = await new SelectedRouteGeometryService(provider).enrich(
      [original],
      undefined,
      undefined,
      { includeBus: false },
    );

    expect(provider.resolveBusGeometry).not.toHaveBeenCalled();
    expect(result?.legs[0]?.geometryQuality).toBe("DETAILED");
    expect(result?.legs[1]).toEqual(original.legs[1]);
  });

  it("시작 전에 geometry budget이 끝나면 provider를 호출하지 않고 mode별 skip을 관측한다", async () => {
    const getWalkingRoute = vi.fn();
    const resolveBusGeometry = vi.fn();
    const observeSkipped = vi.fn();
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute,
      resolveBusGeometry,
    };
    const controller = new AbortController();
    controller.abort(new DOMException("geometry deadline", "TimeoutError"));

    const result = await new SelectedRouteGeometryService(provider).enrich(
      [recommendation("expired")],
      controller.signal,
      undefined,
      { observeSkipped },
    );

    expect(result[0]?.id).toBe("expired");
    expect(getWalkingRoute).not.toHaveBeenCalled();
    expect(resolveBusGeometry).not.toHaveBeenCalled();
    expect(observeSkipped.mock.calls.map(([observation]) => observation)).toEqual([
      {
        mode: "WALK",
        stage: "SELECTED",
        reason: "BUDGET_EXHAUSTED_BEFORE_START",
      },
      {
        mode: "BUS",
        stage: "SELECTED",
        reason: "BUDGET_EXHAUSTED_BEFORE_START",
      },
    ]);
  });

  it("선택 WALK 상세화 call limit을 넘긴 고유 구간을 skip으로 관측한다", async () => {
    const getWalkingRoute = vi.fn(async (): Promise<NormalizedRoute> => ({
      id: "walk-detail",
      source: "KAKAO",
      durationSeconds: 1,
      distanceMeters: 1,
      walkDistanceMeters: 1,
      transitDistanceMeters: 0,
      transferCount: 0,
      legs: [{
        id: "walk-detail-leg",
        mode: "WALK",
        distanceMeters: 1,
        durationSeconds: 1,
        coordinates: [walkFrom, walkMiddle, walkTo],
        isExerciseSegment: false,
      }],
    }));
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute,
    };
    const observeSkipped = vi.fn();
    const input = Array.from({ length: 3 }, (_, recommendationIndex) => {
      const item = recommendation(`limited-${recommendationIndex}`);
      const walk = item.legs[0]!;
      return {
        ...item,
        legs: Array.from({ length: 3 }, (_, legIndex) => {
          const offset = recommendationIndex * 0.01 + legIndex * 0.001;
          return {
            ...walk,
            id: `${item.id}-walk-${legIndex}`,
            coordinates: [
              { lat: walkFrom.lat + offset, lng: walkFrom.lng + offset },
              { lat: walkTo.lat + offset, lng: walkTo.lng + offset },
            ],
          };
        }),
      };
    });

    await new SelectedRouteGeometryService(provider).enrich(
      input,
      undefined,
      undefined,
      { observeSkipped },
    );

    expect(getWalkingRoute).toHaveBeenCalledTimes(8);
    expect(observeSkipped).toHaveBeenCalledOnce();
    expect(observeSkipped).toHaveBeenCalledWith({
      mode: "WALK",
      stage: "SELECTED",
      reason: "CALL_LIMIT_REACHED",
    });
  });

  it("선택 WALK limiter 대기시간과 시작 여부를 geometry 관측에 전달한다", async () => {
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute: vi.fn(async (): Promise<NormalizedRoute> => ({
        id: "walk-detail",
        source: "KAKAO",
        durationSeconds: 1,
        distanceMeters: 1,
        walkDistanceMeters: 1,
        transitDistanceMeters: 0,
        transferCount: 0,
        legs: [{
          id: "walk-detail-leg",
          mode: "WALK",
          distanceMeters: 1,
          durationSeconds: 1,
          coordinates: [walkFrom, walkMiddle, walkTo],
          isExerciseSegment: false,
        }],
      })),
    };
    const observations: unknown[] = [];

    await new SelectedRouteGeometryService(provider).enrich(
      [recommendation("queue-observed")],
      undefined,
      (observation) => observations.push(observation),
      { includeBus: false },
    );

    expect(observations).toEqual([
      expect.objectContaining({
        mode: "WALK",
        outcome: "DETAILED",
        queueWaitMilliseconds: expect.any(Number),
        queueStartedCount: 1,
        queueAbortedBeforeStartCount: 0,
      }),
    ]);
  });
});
