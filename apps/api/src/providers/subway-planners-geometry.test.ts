import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import type {
  SubwayRoutingGraph,
  SubwayRoutingStation,
} from "../transit/transit-repository.js";
import type { TransitService } from "../transit/transit-service.js";
import { MultimodalRoutePlanner } from "./multimodal-route-planner.js";
import { SubwayRoutePlanner } from "./subway-route-planner.js";
import type { MobilityProvider, RoadGeometryProvider } from "./types.js";

const coordinates = {
  a: { lat: 36.35, lng: 127.38 },
  curve1: { lat: 36.354, lng: 127.385 },
  b: { lat: 36.35, lng: 127.39 },
  curve2: { lat: 36.346, lng: 127.395 },
  c: { lat: 36.35, lng: 127.4 },
};

function station(key: "A" | "B" | "C"): SubwayRoutingStation {
  const coordinate = coordinates[key.toLocaleLowerCase() as "a" | "b" | "c"];
  return {
    nodeId: `line-1:${key}`,
    stationLineId: `station-${key}`,
    serviceLineId: "line-1",
    sourceStationKey: key,
    stationOrder: key.charCodeAt(0) - 64,
    stationName: key,
    lineName: "1호선",
    regionName: "대전",
    operatorName: "대전교통공사",
    latitude: coordinate.lat,
    longitude: coordinate.lng,
  };
}

const graph: SubwayRoutingGraph = {
  stations: [station("A"), station("B"), station("C")],
  edges: [
    {
      fromNodeId: "line-1:A",
      toNodeId: "line-1:B",
      kind: "RIDE",
      durationSeconds: 60,
      distanceMeters: 900,
      expectedWaitSeconds: 120,
      serviceLineId: "line-1",
      durationIsEstimated: false,
      trackCoordinates: [coordinates.a, coordinates.curve1, coordinates.b],
      trackDistanceMeters: 1_100,
      geometrySource: "OpenStreetMap relation 1",
    },
    {
      fromNodeId: "line-1:B",
      toNodeId: "line-1:C",
      kind: "RIDE",
      durationSeconds: 60,
      distanceMeters: 900,
      expectedWaitSeconds: 120,
      serviceLineId: "line-1",
      durationIsEstimated: false,
      trackCoordinates: [coordinates.b, coordinates.curve2, coordinates.c],
      trackDistanceMeters: 1_200,
      geometrySource: "OpenStreetMap relation 1",
    },
  ],
};

const place = (id: string, location: { lat: number; lng: number }) => ({
  id,
  name: id,
  address: "",
  roadAddress: "",
  category: "",
  location,
});

function dependencies() {
  const repository = {
    getSubwayRoutingGraph: vi.fn(async () => graph),
    getBusSubwayTransferLinks: vi.fn(async () => []),
  };
  const transitService = {
    repository,
    getNearbyStops: vi.fn(async () => ({ items: [], partial: false })),
    resolveSubwayTiming: vi.fn(async (input: {
      fallbackWaitSeconds: number;
      plannedBoardingAt: Date;
    }) => ({
      waitSeconds: input.fallbackWaitSeconds,
      timingSource: "SUBWAY_HEADWAY_FALLBACK" as const,
      isRealtime: false,
      plannedBoardingAt: input.plannedBoardingAt.toISOString(),
      updatedAt: null,
      stale: false,
      direction: "D" as const,
    })),
  } as unknown as TransitService;
  const baseProvider = {
    source: "KAKAO" as const,
    searchPlaces: vi.fn(async () => []),
    getTransitRoutes: vi.fn(async () => []),
    getWalkingRoute: vi.fn(async () => {
      throw new Error("walking fallback for test");
    }),
    getRoadRouteGeometry: vi.fn(async () => {
      throw new Error("road fallback for test");
    }),
  } satisfies MobilityProvider & RoadGeometryProvider;
  return { baseProvider, transitService };
}

describe("두 지하철 플래너의 track-v1 회귀", () => {
  it("동일한 공통 선로를 반환하면서 역 순서·ETA·대기시간은 유지한다", async () => {
    const config = loadConfig({ NODE_ENV: "test" });
    const legacyDependencies = dependencies();
    const legacyPlanner = new SubwayRoutePlanner({
      ...legacyDependencies,
      config,
    });
    const multimodalDependencies = dependencies();
    const multimodalPlanner = new MultimodalRoutePlanner({
      ...multimodalDependencies,
      config,
    });
    const request = {
      origin: place("origin", coordinates.a),
      destination: place("destination", coordinates.c),
    };

    const [straightRoutes, trackRoutes, multimodalRoutes] = await Promise.all([
      legacyPlanner.getRoutes(request),
      legacyPlanner.getRoutes({ ...request, geometryProfile: "TRACK_V1" }),
      multimodalPlanner.getRoutes({ ...request, geometryProfile: "TRACK_V1" }),
    ]);
    const straight = straightRoutes[0]!;
    const track = trackRoutes[0]!;
    const multimodal = multimodalRoutes[0]!;
    const straightLeg = straight.legs.find((leg) => leg.mode === "SUBWAY")!;
    const trackLeg = track.legs.find((leg) => leg.mode === "SUBWAY")!;
    const multimodalLeg = multimodal.legs.find((leg) => leg.mode === "SUBWAY")!;

    expect(track).toMatchObject({
      id: straight.id,
      durationSeconds: straight.durationSeconds,
      transferCount: straight.transferCount,
      waitingDurationSeconds: straight.waitingDurationSeconds,
      ridingDurationSeconds: straight.ridingDurationSeconds,
    });
    expect(trackLeg.stops).toEqual(straightLeg.stops);
    expect(straightLeg.coordinates).toEqual([
      coordinates.a,
      coordinates.b,
      coordinates.c,
    ]);
    expect(trackLeg.coordinates).toEqual([
      coordinates.a,
      coordinates.curve1,
      coordinates.b,
      coordinates.curve2,
      coordinates.c,
    ]);
    expect(multimodalLeg.coordinates).toEqual(trackLeg.coordinates);
    expect(multimodalLeg.stops).toEqual(trackLeg.stops);
    expect(multimodalLeg.durationSeconds).toBe(trackLeg.durationSeconds);
    expect(multimodalLeg.timing?.waitSeconds).toBe(
      trackLeg.timing?.waitSeconds,
    );
  });

  it("transit-v2 후보 순위 계산 중에는 Kakao 도보 형상을 미리 호출하지 않는다", async () => {
    const config = loadConfig({ NODE_ENV: "test" });
    const legacyDependencies = dependencies();
    const legacyPlanner = new SubwayRoutePlanner({
      ...legacyDependencies,
      config,
    });
    const multimodalDependencies = dependencies();
    const multimodalPlanner = new MultimodalRoutePlanner({
      ...multimodalDependencies,
      config,
    });
    const request = {
      origin: place("origin", { lat: 36.3485, lng: 127.378 }),
      destination: place("destination", { lat: 36.3515, lng: 127.402 }),
      geometryProfile: "TRANSIT_V2" as const,
    };

    const [legacyRoutes, multimodalRoutes] = await Promise.all([
      legacyPlanner.getRoutes(request),
      multimodalPlanner.getRoutes(request),
    ]);

    expect(legacyDependencies.baseProvider.getWalkingRoute).not.toHaveBeenCalled();
    expect(multimodalDependencies.baseProvider.getWalkingRoute).not.toHaveBeenCalled();
    for (const route of [...legacyRoutes, ...multimodalRoutes]) {
      expect(
        route.legs
          .filter((leg) => leg.mode === "WALK")
          .every((leg) => leg.geometryQuality === "APPROXIMATE"),
      ).toBe(true);
    }
  });
});
