import type {
  NormalizedRoute,
  Recommendation,
  RecommendationRequest,
  RouteLeg,
} from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { ProviderError } from "../errors.js";
import type {
  MobilityProvider,
  WalkingRouteProvider,
} from "../providers/types.js";
import {
  CandidateGenerator,
  adjustedBusLeg,
  rebuildRoute,
} from "./candidate-generator.js";

function adjustableRoute(): NormalizedRoute {
  const stops = [
    { nodeId: "n1", lat: 36.35, lng: 127.37 },
    { nodeId: "n2", lat: 36.352, lng: 127.372 },
    { nodeId: "n3", lat: 36.354, lng: 127.374 },
    { nodeId: "n4", lat: 36.356, lng: 127.376 },
  ].map((stop, index) => ({
    routeId: "route-514",
    stopId: `stop-${index + 1}`,
    nodeId: stop.nodeId,
    cityCode: "25",
    stopName: stop.nodeId,
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
  return {
    id: "adjustable",
    source: "TAGO",
    durationSeconds: 600,
    distanceMeters: 1_000,
    walkDistanceMeters: 0,
    transitDistanceMeters: 1_000,
    transferCount: 0,
    legs: [{
      id: "adjustable-bus",
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
}

const generationRequest: RecommendationRequest = {
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
};

function busThenSubwayRoute(): NormalizedRoute {
  const bus = adjustableRoute().legs[0]!;
  const busStart = bus.coordinates[0]!;
  const busEnd = bus.coordinates.at(-1)!;
  const subwayStart = { lat: 36.3565, lng: 127.3765 };
  const subwayEnd = { lat: 36.3575, lng: 127.3775 };
  const legs: RouteLeg[] = [
    {
      id: "mixed-origin-walk",
      mode: "WALK",
      guidance: "출발지에서 버스 정류장까지 이동",
      distanceMeters: 150,
      durationSeconds: 120,
      coordinates: [generationRequest.origin.location, busStart],
      isExerciseSegment: false,
      walkingRole: "ACCESS",
    },
    { ...bus, id: "mixed-bus" },
    {
      id: "mixed-bus-subway-transfer",
      mode: "WALK",
      guidance: "버스에서 지하철로 환승",
      distanceMeters: 80,
      durationSeconds: 90,
      coordinates: [busEnd, subwayStart],
      isExerciseSegment: false,
      walkingRole: "TRANSFER",
      transfer: {
        transferType: "BUS_TO_SUBWAY",
        fromServiceId: "route-514",
        toServiceId: "daejeon-1",
      },
    },
    {
      id: "mixed-subway",
      mode: "SUBWAY",
      name: "대전 1호선",
      guidance: "지하철을 타고 목적지 인근 역까지 이동",
      distanceMeters: 1_000,
      durationSeconds: 420,
      coordinates: [subwayStart, subwayEnd],
      isExerciseSegment: false,
      subway: {
        serviceLineId: "daejeon-1",
        lineName: "대전 1호선",
        boardingStation: {
          stationLineId: "station-1",
          sourceStationKey: "S3001|101",
          name: "정부청사",
          location: subwayStart,
        },
        alightingStation: {
          stationLineId: "station-2",
          sourceStationKey: "S3001|104",
          name: "대전",
          location: subwayEnd,
        },
        stationCount: 3,
        rideDurationSeconds: 300,
        direction: "DOWN",
        destinationName: null,
        intermediateStations: [],
      },
    },
    {
      id: "mixed-destination-walk",
      mode: "WALK",
      guidance: "지하철역에서 목적지까지 이동",
      distanceMeters: 100,
      durationSeconds: 100,
      coordinates: [subwayEnd, generationRequest.destination.location],
      isExerciseSegment: false,
      walkingRole: "ACCESS",
    },
  ];
  return {
    id: "mixed-bus-subway",
    source: "MULTIMODAL",
    durationSeconds: legs.reduce(
      (total, leg) => total + leg.durationSeconds,
      0,
    ),
    distanceMeters: 2_330,
    walkDistanceMeters: 330,
    transitDistanceMeters: 2_000,
    transferCount: 1,
    fareWon: 1_500,
    waitingDurationSeconds: 240,
    ridingDurationSeconds: 780,
    isRealtime: false,
    legs,
  };
}

function subwayThenBusRoute(): NormalizedRoute {
  const source = busThenSubwayRoute();
  const originWalk = source.legs[0]!;
  const bus = source.legs[1]!;
  const transfer = source.legs[2]!;
  const subway = source.legs[3]!;
  const destinationWalk = source.legs[4]!;
  if (subway.subway === undefined) {
    throw new TypeError("지하철 테스트 leg가 필요합니다.");
  }
  const subwayStart = { lat: 36.3493, lng: 127.3693 };
  const subwayEnd = { lat: 36.3497, lng: 127.3697 };
  const busStart = bus.coordinates[0]!;
  const busEnd = bus.coordinates.at(-1)!;
  const legs: RouteLeg[] = [
    {
      ...originWalk,
      id: "leading-origin-walk",
      coordinates: [generationRequest.origin.location, subwayStart],
    },
    {
      ...subway,
      id: "leading-subway",
      coordinates: [subwayStart, subwayEnd],
      subway: {
        ...subway.subway,
        boardingStation: {
          ...subway.subway.boardingStation,
          location: subwayStart,
        },
        alightingStation: {
          ...subway.subway.alightingStation,
          location: subwayEnd,
        },
      },
    },
    {
      ...transfer,
      id: "leading-subway-bus-transfer",
      coordinates: [subwayEnd, busStart],
      transfer: {
        transferType: "SUBWAY_TO_BUS",
        fromServiceId: "daejeon-1",
        toServiceId: "route-514",
      },
    },
    { ...bus, id: "leading-bus" },
    {
      ...destinationWalk,
      id: "leading-destination-walk",
      coordinates: [busEnd, generationRequest.destination.location],
    },
  ];
  return {
    ...source,
    id: "mixed-subway-bus",
    legs,
  };
}

describe("대중교통 목표 걸음 경로 재구성", () => {
  it("WALK→BUS→TRANSFER→SUBWAY→WALK 조정은 원래 leg를 보존하고 버스 옆에 connector를 넣는다", async () => {
    const base = busThenSubwayRoute();
    const getWalkingRoute = vi.fn();
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [base],
      getWalkingRoute,
    };

    const generated = await new CandidateGenerator(provider).generate(
      { ...generationRequest, goalSteps: 10_000 },
      undefined,
      { geometryProfile: "TRANSIT_V2" },
    );
    const early = generated.candidates.find(
      (candidate) => candidate.kind === "EARLY_ALIGHT",
    )?.route;
    const late = generated.candidates.find(
      (candidate) => candidate.kind === "LATE_BOARD",
    )?.route;

    expect(getWalkingRoute).not.toHaveBeenCalled();
    expect(early).toBeDefined();
    expect(late).toBeDefined();

    expect(early?.legs.map((leg) => leg.id)).toEqual([
      "mixed-origin-walk",
      "mixed-bus",
      "mixed-bus-subway-early-alight-walk-0",
      "mixed-bus-subway-transfer",
      "mixed-subway",
      "mixed-destination-walk",
    ]);
    expect(late?.legs.map((leg) => leg.id)).toEqual([
      "mixed-origin-walk",
      "mixed-bus-subway-late-board-walk-0",
      "mixed-bus",
      "mixed-bus-subway-transfer",
      "mixed-subway",
      "mixed-destination-walk",
    ]);

    for (const adjusted of [early!, late!]) {
      for (let index = 1; index < adjusted.legs.length; index += 1) {
        expect(adjusted.legs[index - 1]?.coordinates.at(-1)).toEqual(
          adjusted.legs[index]?.coordinates[0],
        );
      }
      const adjustedBus = adjusted.legs.find((leg) => leg.id === "mixed-bus");
      expect(adjusted.legs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "mixed-bus-subway-transfer",
            walkingRole: "TRANSFER",
          }),
          expect.objectContaining({
            id: "mixed-subway",
            mode: "SUBWAY",
          }),
        ]),
      );
      expect(adjusted).toMatchObject({
        transferCount: 1,
        fareWon: 1_500,
        waitingDurationSeconds: 240,
        ridingDurationSeconds:
          300 + (adjustedBus?.bus?.expectedRideSeconds ?? 0),
      });
      expect(adjusted.durationSeconds).toBe(
        adjusted.legs.reduce(
          (total, leg) => total + leg.durationSeconds,
          0,
        ),
      );
    }
  });

  it("늦은 탑승은 BUS 앞의 SUBWAY→TRANSFER leg를 보존한다", async () => {
    const base = subwayThenBusRoute();
    const generated = await new CandidateGenerator({
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [base],
      getWalkingRoute: vi.fn(),
    }).generate(
      { ...generationRequest, goalSteps: 10_000 },
      undefined,
      { geometryProfile: "TRANSIT_V2" },
    );
    const late = generated.candidates.find(
      (candidate) => candidate.kind === "LATE_BOARD",
    )?.route;

    expect(late?.legs.map((leg) => leg.id)).toEqual([
      "leading-origin-walk",
      "leading-subway",
      "leading-subway-bus-transfer",
      "mixed-subway-bus-late-board-walk-0",
      "leading-bus",
      "leading-destination-walk",
    ]);
    expect(late).toMatchObject({
      transferCount: 1,
      fareWon: 1_500,
    });
    for (let index = 1; index < (late?.legs.length ?? 0); index += 1) {
      expect(late?.legs[index - 1]?.coordinates.at(-1)).toEqual(
        late?.legs[index]?.coordinates[0],
      );
    }
  });

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

  it("최종 선택된 중복 도보 구간을 한 번 상세화하고 leg 실측값을 반영한다", async () => {
    const from = { lat: 36.35, lng: 127.37 };
    const middle = { lat: 36.351, lng: 127.3715 };
    const to = { lat: 36.352, lng: 127.373 };
    const getWalkingRoute = vi.fn(async (): Promise<NormalizedRoute> => ({
      id: "valhalla-walk",
      source: "VALHALLA",
      durationSeconds: 999,
      distanceMeters: 999,
      walkDistanceMeters: 999,
      transitDistanceMeters: 0,
      transferCount: 0,
      legs: [{
        id: "valhalla-walk-leg",
        mode: "WALK",
        guidance: "상세 도보",
        distanceMeters: 999,
        durationSeconds: 999,
        coordinates: [from, middle, to],
        isExerciseSegment: false,
      }],
    }));
    const mobilityWalking = vi.fn(async () => {
      throw new Error("mobility walking must not be used");
    });
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [],
      getWalkingRoute: mobilityWalking,
    };
    const walkingProvider: WalkingRouteProvider = {
      source: "VALHALLA",
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
    const enriched = await new CandidateGenerator(
      provider,
      walkingProvider,
    ).enrichWalkingGeometry(
      [recommendation, { ...recommendation, id: "selected-duplicate" }],
      undefined,
      (observation) => observations.push(observation),
    );

    expect(mobilityWalking).not.toHaveBeenCalled();
    expect(getWalkingRoute).toHaveBeenCalledTimes(1);
    expect(enriched).toHaveLength(2);
    for (const result of enriched) {
      expect(result.durationSeconds).toBe(600);
      expect(result.walkDistanceMeters).toBe(300);
      expect(result.legs[0]).toMatchObject({
        durationSeconds: 999,
        distanceMeters: 999,
        coordinates: [from, middle, to],
        geometryQuality: "DETAILED",
      });
    }
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      outcome: "DETAILED",
      source: "VALHALLA_WALK",
      walkingRole: "ACCESS",
    });
  });

  it("조정 버스의 계획 거리와 시간은 상세 도로선이 아니라 정류장 topology로 계산한다", () => {
    const stops = [
      { nodeId: "n1", lat: 36.35, lng: 127.37 },
      { nodeId: "n2", lat: 36.351, lng: 127.372 },
      { nodeId: "n3", lat: 36.352, lng: 127.374 },
      { nodeId: "n4", lat: 36.353, lng: 127.376 },
    ].map((stop, index) => ({
      routeId: "route-514",
      stopId: `stop-${index + 1}`,
      nodeId: stop.nodeId,
      cityCode: "25",
      stopName: stop.nodeId,
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
    const leg: RouteLeg = {
      id: "bus-514",
      mode: "BUS",
      name: "514",
      distanceMeters: 2_000,
      durationSeconds: 900,
      coordinates: [
        { lat: 36.35, lng: 127.37 },
        { lat: 36.39, lng: 127.45 },
        { lat: 36.353, lng: 127.376 },
      ],
      geometryQuality: "DETAILED",
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
        expectedRideSeconds: 780,
        vehicleNo: null,
        vehicleType: null,
        isArrivalRealtime: false,
        polyline: [],
        stops,
      },
    };

    const adjusted = adjustedBusLeg(leg, 1, 3, true);
    const sameTopologyDifferentShape = adjustedBusLeg(
      {
        ...leg,
        distanceMeters: 99_999,
        coordinates: [...leg.coordinates].reverse(),
      },
      1,
      3,
      true,
    );

    expect(adjusted.coordinates).toEqual(
      stops.slice(1).map((stop) => ({
        lat: stop.latitude,
        lng: stop.longitude,
      })),
    );
    expect(adjusted.geometryQuality).toBe("APPROXIMATE");
    expect(sameTopologyDifferentShape).toMatchObject({
      distanceMeters: adjusted.distanceMeters,
      durationSeconds: adjusted.durationSeconds,
      coordinates: adjusted.coordinates,
    });
  });

  it("baseline 생성 뒤 planning deadline이 끝나면 완성된 후보만 partial로 반환한다", async () => {
    const getWalkingRoute = vi.fn(
      async () => new Promise<NormalizedRoute>(() => undefined),
    );
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [adjustableRoute()],
      getWalkingRoute,
    };
    const controller = new AbortController();
    const pending = new CandidateGenerator(provider).generate(
      generationRequest,
      controller.signal,
      { allowPartialOnTimeout: true },
    );
    await vi.waitFor(() => expect(getWalkingRoute).toHaveBeenCalled());

    controller.abort(new DOMException("planning deadline", "TimeoutError"));
    const result = await pending;

    expect(result.planningTimedOut).toBe(true);
    expect(result.candidates).toEqual([
      { route: expect.objectContaining({ id: "adjustable" }), kind: "BASE" },
    ]);
  });

  it("baseline 생성 뒤 client abort는 partial 성공으로 바꾸지 않는다", async () => {
    const getWalkingRoute = vi.fn(
      async () => new Promise<NormalizedRoute>(() => undefined),
    );
    const provider: MobilityProvider = {
      source: "TAGO",
      searchPlaces: async () => [],
      getTransitRoutes: async () => [adjustableRoute()],
      getWalkingRoute,
    };
    const controller = new AbortController();
    const pending = new CandidateGenerator(provider).generate(
      generationRequest,
      controller.signal,
      { allowPartialOnTimeout: true },
    );
    await vi.waitFor(() => expect(getWalkingRoute).toHaveBeenCalled());

    controller.abort(new DOMException("client aborted", "AbortError"));

    await expect(pending).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "ABORTED",
    });
  });
});
