import type {
  BusArrival,
  BusRoute,
  BusRouteStop,
  BusStop,
  NormalizedRoute,
  Place,
} from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { ProviderError } from "../errors.js";
import type { TransitService } from "../transit/transit-service.js";
import { TagoTransitMobilityProvider } from "./tago-transit-provider.js";
import type { MobilityProvider } from "./types.js";

const origin: Place = {
  id: "origin",
  name: "출발지",
  address: "",
  roadAddress: "",
  category: "",
  location: { lat: 36.37, lng: 127.36 },
};
const destination: Place = {
  id: "destination",
  name: "목적지",
  address: "",
  roadAddress: "",
  category: "",
  location: { lat: 36.35, lng: 127.4 },
};

function stop(
  nodeId: string,
  longitude: number,
  distanceMeters = 100,
): BusStop {
  return {
    id: `25:${nodeId}`,
    cityCode: "25",
    nodeId,
    sourceStopNo: null,
    arsId: null,
    name: `${nodeId} 정류장`,
    latitude: 36.36,
    longitude,
    distanceMeters,
    source: "tago",
  };
}

function route(routeId: string): BusRoute {
  return {
    id: `25:${routeId}`,
    cityCode: "25",
    routeId,
    routeNo: routeId,
    routeName: routeId,
    routeType: "간선",
    startStopName: null,
    endStopName: null,
    firstBusTime: null,
    lastBusTime: null,
    weekdayIntervalMinutes: 10,
    weekendIntervalMinutes: 10,
    source: "tago",
  };
}

function routeStops(
  routeId: string,
  nodes: Array<[string, number]>,
): BusRouteStop[] {
  return nodes.map(([nodeId, longitude], index) => ({
    routeId,
    stopId: `25:${nodeId}`,
    nodeId,
    cityCode: "25",
    stopName: `${nodeId} 정류장`,
    latitude: 36.36,
    longitude,
    nodeOrder: index + 1,
    direction: null,
  }));
}

const baseProvider: MobilityProvider = {
  source: "MOCK",
  mode: "mock",
  async searchPlaces() {
    return [];
  },
  async getTransitRoutes(): Promise<NormalizedRoute[]> {
    throw new Error("사용되지 않아야 합니다.");
  },
  async getWalkingRoute(): Promise<NormalizedRoute> {
    throw new Error("사용되지 않아야 합니다.");
  },
};

function provider(
  service: Partial<TransitService>,
  maxTransfers: 0 | 1,
) {
  return new TagoTransitMobilityProvider({
    baseProvider,
    transitService: service as TransitService,
    config: loadConfig({
      NODE_ENV: "test",
      KAKAO_MODE: "mock",
      TRANSIT_MAX_TRANSFER_COUNT: String(maxTransfers),
    }),
  });
}

describe("TAGO 버스 경로 탐색", () => {
  it("routeId 교집합과 nodeOrder로 직행 정방향만 생성하고 도착정보를 결합한다", async () => {
    const a = stop("A", 127.361);
    const c = stop("C", 127.399);
    const directRoute = route("104");
    const stops = routeStops("104", [
      ["A", 127.361],
      ["B", 127.38],
      ["C", 127.399],
    ]);
    const arrival: BusArrival = {
      cityCode: "25",
      nodeId: "A",
      routeId: "104",
      routeNo: "104",
      routeType: "간선",
      remainingStops: 2,
      arrivalSeconds: 180,
      arrivalMinutes: 3,
      vehicleType: "저상버스",
      isRealtime: true,
      fetchedAt: new Date().toISOString(),
    };
    const service = {
      async getNearbyStops(coordinate: { lng: number }) {
        return {
          items: coordinate.lng < 127.38 ? [a] : [c],
          partial: false,
        };
      },
      async getRoutesByStop() {
        return { items: [directRoute], source: "tago" as const };
      },
      async getRouteStops() {
        return stops;
      },
      async getRoute() {
        return directRoute;
      },
      async getArrivals() {
        return [arrival];
      },
    };
    const routes = await provider(service, 0).getTransitRoutes({
      origin,
      destination,
    });
    const bus = routes[0]?.legs.find((leg) => leg.bus !== undefined)?.bus;
    expect(routes[0]).toMatchObject({
      transferCount: 0,
      source: "TAGO",
      isRealtime: true,
      waitingDurationSeconds: 180,
    });
    expect(bus).toMatchObject({
      routeId: "104",
      boardingNodeOrder: 1,
      alightingNodeOrder: 3,
      stopCount: 2,
      isArrivalRealtime: true,
      vehicleType: "저상버스",
    });
  });

  it("같은 노선이라도 반대 nodeOrder 방향은 제외한다", async () => {
    const a = stop("A", 127.361);
    const c = stop("C", 127.399);
    const directRoute = route("104");
    const service = {
      async getNearbyStops(coordinate: { lng: number }) {
        return {
          items: coordinate.lng < 127.38 ? [c] : [a],
          partial: false,
        };
      },
      async getRoutesByStop() {
        return { items: [directRoute], source: "tago" as const };
      },
      async getRouteStops() {
        return routeStops("104", [
          ["A", 127.361],
          ["B", 127.38],
          ["C", 127.399],
        ]);
      },
      async getRoute() {
        return directRoute;
      },
      async getArrivals() {
        return [];
      },
    };
    await expect(
      provider(service, 0).getTransitRoutes({ origin, destination }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "NO_ROUTE" });
  });

  it("도착정보가 없으면 0분 대신 배차간격 절반을 예상 대기시간으로 쓴다", async () => {
    const a = stop("A", 127.361);
    const c = stop("C", 127.399);
    const directRoute = route("104");
    const service = {
      async getNearbyStops(coordinate: { lng: number }) {
        return {
          items: coordinate.lng < 127.38 ? [a] : [c],
          partial: false,
        };
      },
      async getRoutesByStop() {
        return { items: [directRoute], source: "tago" as const };
      },
      async getRouteStops() {
        return routeStops("104", [
          ["A", 127.361],
          ["C", 127.399],
        ]);
      },
      async getRoute() {
        return directRoute;
      },
      async getArrivals() {
        return [];
      },
    };
    const routes = await provider(service, 0).getTransitRoutes({
      origin,
      destination,
    });
    expect(routes[0]).toMatchObject({
      waitingDurationSeconds: 300,
      isRealtime: false,
    });
    expect(
      routes[0]?.legs.find((leg) => leg.bus !== undefined)?.bus,
    ).toMatchObject({
      expectedArrivalSeconds: 300,
      isArrivalRealtime: false,
    });
  });

  it("동일하거나 가까운 환승 정류장으로 1회 환승을 만들고 최대 환승 제한을 지킨다", async () => {
    const a = stop("A", 127.361);
    const c = stop("C", 127.399);
    const firstRoute = route("R1");
    const secondRoute = route("R2");
    const service = {
      async getNearbyStops(coordinate: { lng: number }) {
        return {
          items: coordinate.lng < 127.38 ? [a] : [c],
          partial: false,
        };
      },
      async getRoutesByStop(
        _cityCode: string,
        nodeId: string,
      ) {
        return {
          items: nodeId === "A" ? [firstRoute] : [secondRoute],
          source: "tago" as const,
        };
      },
      async getRouteStops(_cityCode: string, routeId: string) {
        return routeId === "R1"
          ? routeStops("R1", [
              ["A", 127.361],
              ["X", 127.38],
            ])
          : routeStops("R2", [
              ["X", 127.38],
              ["C", 127.399],
            ]);
      },
      async getRoute(_cityCode: string, routeId: string) {
        return routeId === "R1" ? firstRoute : secondRoute;
      },
      async getArrivals() {
        return [];
      },
      async getArrivalsForRoute() {
        return [];
      },
    };

    const routes = await provider(service, 1).getTransitRoutes({
      origin,
      destination,
    });
    expect(routes[0]?.transferCount).toBe(1);
    expect(
      routes[0]?.legs.filter((leg) => leg.mode === "BUS"),
    ).toHaveLength(2);
    await expect(
      provider(service, 0).getTransitRoutes({ origin, destination }),
    ).rejects.toMatchObject<Partial<ProviderError>>({ kind: "NO_ROUTE" });
  });
});
