import type { BusRouteStop, Coordinate } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../errors.js";

import {
  RouteGeometryService,
  busSegmentSourceHash,
  validateRoadSection,
} from "./route-geometry.js";

function stop(nodeOrder: number, lat: number, lng: number): BusRouteStop {
  return {
    routeId: "DJB30300067",
    stopId: `stop-${nodeOrder}`,
    nodeId: `node-${nodeOrder}`,
    cityCode: "25",
    stopName: `514-${nodeOrder}`,
    latitude: lat,
    longitude: lng,
    nodeOrder,
    direction: null,
  };
}

const stops = [
  stop(43, 36.355984, 127.37849),
  stop(44, 36.355965, 127.37598),
  stop(45, 36.359123, 127.37447),
  stop(46, 36.35995, 127.370865),
  stop(47, 36.362118, 127.36937),
];

function curved(from: BusRouteStop, to: BusRouteStop): Coordinate[] {
  return [
    { lat: from.latitude, lng: from.longitude },
    {
      lat: (from.latitude + to.latitude) / 2 + 0.00005,
      lng: (from.longitude + to.longitude) / 2 + 0.00005,
    },
    { lat: to.latitude, lng: to.longitude },
  ];
}

describe("버스 인접 정류장 형상", () => {
  it("역방향 section을 출발 정류장 방향으로 보정한다", () => {
    const from = { lat: 36.35, lng: 127.37 };
    const to = { lat: 36.351, lng: 127.371 };
    const middle = { lat: 36.3504, lng: 127.3707 };
    const result = validateRoadSection([to, middle, from], from, to);

    expect(result.reason).toBe("NONE");
    expect(result.coordinates?.[0]).toEqual(from);
    expect(result.coordinates?.at(-1)).toEqual(to);
  });

  it("514번 핵심 구간을 정류장 직선이 아닌 조밀한 도로 형상으로 반환한다", async () => {
    const saved: unknown[] = [];
    const repository = {
      getBusSegmentGeometries: vi.fn(async () => []),
      upsertBusSegmentGeometries: vi.fn(async (_city, _route, rows) => {
        saved.push(...rows);
      }),
    };
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async () => ({
        sections: stops.slice(0, -1).map((from, index) => curved(from, stops[index + 1]!)),
      })),
    };
    const service = new RouteGeometryService({ provider, repository });

    const result = await service.resolveBusGeometry({ stops });

    expect(result.quality).toBe("DETAILED");
    expect(result.coordinates.length).toBeGreaterThan(stops.length);
    expect(saved).toHaveLength(stops.length - 1);
  });

  it("한 section이 비면 검증된 구간만 저장하고 전체 leg는 근사로 표시한다", async () => {
    const repository = {
      getBusSegmentGeometries: vi.fn(async () => []),
      upsertBusSegmentGeometries: vi.fn(async () => undefined),
    };
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async () => ({
        sections: [curved(stops[0]!, stops[1]!), [], curved(stops[2]!, stops[3]!), curved(stops[3]!, stops[4]!)],
      })),
    };
    const service = new RouteGeometryService({ provider, repository });

    const result = await service.resolveBusGeometry({ stops });

    expect(result.quality).toBe("APPROXIMATE");
    expect(result.reason).toBe("SECTION_MISMATCH");
    expect(repository.upsertBusSegmentGeometries.mock.calls[0]?.[2]).toHaveLength(3);
  });

  it("정류장 좌표가 바뀌면 source hash도 바뀐다", () => {
    const original = busSegmentSourceHash("25", stops[0]!.routeId, stops[0]!, stops[1]!);
    const changed = { ...stops[1]!, latitude: stops[1]!.latitude + 0.0001 };
    expect(busSegmentSourceHash("25", stops[0]!.routeId, stops[0]!, changed)).not.toBe(original);
  });

  it("외부 timeout을 추천 실패로 전파하지 않고 근사 좌표와 사유로 격리한다", async () => {
    const observations: unknown[] = [];
    const service = new RouteGeometryService({
      repository: {
        getBusSegmentGeometries: vi.fn(async () => []),
        upsertBusSegmentGeometries: vi.fn(async () => undefined),
      },
      provider: {
        getRoadRouteGeometry: vi.fn(async () => []),
        getRoadRouteSections: vi.fn(async () => {
          throw new ProviderError({ kind: "TIMEOUT", message: "timeout" });
        }),
      },
    });

    const result = await service.resolveBusGeometry({
      stops: stops.slice(0, 3),
      observe: (observation) => observations.push(observation),
    });

    expect(result).toMatchObject({ quality: "APPROXIMATE", reason: "TIMEOUT" });
    expect(result.coordinates).toEqual(stops.slice(0, 3).map((item) => ({
      lat: item.latitude,
      lng: item.longitude,
    })));
    expect(observations[0]).toMatchObject({
      outcome: "APPROXIMATE",
      reason: "TIMEOUT",
      failedSectionCount: 2,
    });
  });
});
