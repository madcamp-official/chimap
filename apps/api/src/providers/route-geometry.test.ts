import {
  haversineDistanceMeters,
  type BusRouteStop,
  type Coordinate,
} from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../errors.js";

import {
  BUS_GEOMETRY_ALGORITHM_VERSION,
  RouteGeometryService,
  busSegmentSourceHash,
  hasOutAndBackSpike,
  joinBusRoadSections,
  validateRoadSection,
  withWalkingGeometryLimit,
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

function stop604(
  nodeOrder: number,
  stopName: string,
  lat: number,
  lng: number,
): BusRouteStop {
  return {
    ...stop(nodeOrder, lat, lng),
    routeId: "DJB30300071",
    stopName,
  };
}

function distance(points: readonly Coordinate[]): number {
  let meters = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    meters += haversineDistanceMeters(points[index]!, points[index + 1]!);
  }
  return meters;
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

  it("v3 검증 결과에는 raw 정류장 좌표를 강제로 삽입하지 않는다", () => {
    const from = { lat: 36.35, lng: 127.37 };
    const to = { lat: 36.351, lng: 127.371 };
    const roadStart = { lat: 36.35005, lng: 127.37003 };
    const roadEnd = { lat: 36.35095, lng: 127.37097 };

    const result = validateRoadSection([roadStart, roadEnd], from, to);

    expect(result).toMatchObject({ reason: "NONE" });
    expect(result.coordinates).toEqual([roadStart, roadEnd]);
    expect(result.coordinates).not.toContainEqual(from);
    expect(result.coordinates).not.toContainEqual(to);
  });

  it("514번 핵심 구간을 정류장 직선이 아닌 조밀한 도로 형상으로 반환한다", async () => {
    const saved: unknown[] = [];
    const repository = {
      getBusSegmentGeometries: vi.fn(async () => []),
      upsertBusSegmentGeometries: vi.fn(async (_city, _route, rows) => {
        saved.push(...rows);
      }),
      getVersionedBusSegmentGeometries: vi.fn(async () => []),
      upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
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
      getVersionedBusSegmentGeometries: vi.fn(async () => []),
      upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
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

  it("v3 source hash는 legacy v2 hash와 공존한다", () => {
    const v2 = busSegmentSourceHash(
      "25",
      stops[0]!.routeId,
      stops[0]!,
      stops[1]!,
      "transit-v2",
    );
    const v3 = busSegmentSourceHash(
      "25",
      stops[0]!.routeId,
      stops[0]!,
      stops[1]!,
      BUS_GEOMETRY_ALGORITHM_VERSION,
    );

    expect(v3).not.toBe(v2);
    expect(v3).toBe(busSegmentSourceHash(
      "25",
      stops[0]!.routeId,
      stops[0]!,
      stops[1]!,
    ));
    expect(busSegmentSourceHash(
      "25",
      stops[0]!.routeId,
      stops[0]!,
      stops[1]!,
      BUS_GEOMETRY_ALGORITHM_VERSION,
      "future-thresholds-v2",
    )).not.toBe(v3);
  });

  it("v3는 모든 인접 정류장 쌍을 독립된 2-point 요청으로 저장한다", async () => {
    const saved: unknown[] = [];
    const observations: Array<{
      queueWaitMilliseconds?: number;
      queueStartedCount?: number;
      queueAbortedBeforeStartCount?: number;
    }> = [];
    const repository = {
      getBusSegmentGeometries: vi.fn(async () => []),
      upsertBusSegmentGeometries: vi.fn(async () => undefined),
      getVersionedBusSegmentGeometries: vi.fn(async () => []),
      upsertVersionedBusSegmentGeometries: vi.fn(async (_city, _route, rows) => {
        saved.push(...rows);
      }),
    };
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async ({ points }) => ({
        sections: [[
          points[0]!,
          {
            lat: (points[0]!.lat + points[1]!.lat) / 2 + 0.00001,
            lng: (points[0]!.lng + points[1]!.lng) / 2 + 0.00001,
          },
          points[1]!,
        ]],
      })),
    };
    const service = new RouteGeometryService({
      provider,
      repository,
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });

    const result = await service.resolveBusGeometry({
      stops,
      observe: (observation) => observations.push(observation),
    });

    expect(result.quality).toBe("DETAILED");
    expect(provider.getRoadRouteSections).toHaveBeenCalledTimes(stops.length - 1);
    expect(provider.getRoadRouteSections.mock.calls.every(
      ([request]) => request.points.length === 2,
    )).toBe(true);
    expect(saved).toHaveLength(stops.length - 1);
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({
        geometryVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
        startSnapDistanceMeters: expect.any(Number),
        endSnapDistanceMeters: expect.any(Number),
        detourRatio: expect.any(Number),
        outAndBack: false,
      }),
    ]));
    expect(repository.getBusSegmentGeometries).not.toHaveBeenCalled();
    expect(repository.upsertBusSegmentGeometries).not.toHaveBeenCalled();
    expect(observations[0]?.queueWaitMilliseconds).toBeGreaterThanOrEqual(0);
    expect(observations[0]).toMatchObject({
      cacheState: "MISS",
      queueStartedCount: stops.length - 1,
      queueAbortedBeforeStartCount: 0,
    });
  });

  it("514번 56→65의 9개 cold pair도 첫 응답에서 전부 재조립한다", async () => {
    const routeStops = [
      stop(56, 36.36237, 127.37039),
      stop(57, 36.35968, 127.371956),
      stop(58, 36.35917, 127.374146),
      stop(59, 36.35571, 127.37578),
      stop(60, 36.355686, 127.37889),
      stop(61, 36.355667, 127.38408),
      stop(62, 36.355705, 127.38866),
      stop(63, 36.35568, 127.39251),
      stop(64, 36.35467, 127.39488),
      stop(65, 36.350273, 127.39484),
    ];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async ({ points }) => {
        activeRequests += 1;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        await gate;
        activeRequests -= 1;
        return { sections: [[points[0]!, points[1]!]] };
      }),
    };
    const service = new RouteGeometryService({
      provider,
      repository: {
        getBusSegmentGeometries: vi.fn(async () => []),
        upsertBusSegmentGeometries: vi.fn(async () => undefined),
        getVersionedBusSegmentGeometries: vi.fn(async () => []),
        upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
      },
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });

    const pending = service.resolveBusGeometry({ stops: routeStops });
    await vi.waitFor(() => {
      expect(provider.getRoadRouteSections).toHaveBeenCalledTimes(4);
    });
    expect(maxActiveRequests).toBe(4);
    release();
    const result = await pending;

    expect(provider.getRoadRouteSections).toHaveBeenCalledTimes(9);
    expect(provider.getRoadRouteSections.mock.calls.every(
      ([request]) => request.points.length === 2,
    )).toBe(true);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
    expect(result).toMatchObject({
      quality: "DETAILED",
      reason: "NONE",
    });
    expect(result.coordinates.at(-1)).toEqual({
      lat: routeStops.at(-1)!.latitude,
      lng: routeStops.at(-1)!.longitude,
    });
  });

  it("17개 이상 cold pair는 최대 16개만 채우고 요청 상한으로 강등한다", async () => {
    const routeStops = Array.from({ length: 18 }, (_, index) =>
      stop(index + 1, 36.35 + index * 0.0001, 127.37 + index * 0.0001),
    );
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async ({ points }) => ({
        sections: [[points[0]!, points[1]!]],
      })),
    };
    const service = new RouteGeometryService({
      provider,
      repository: {
        getBusSegmentGeometries: vi.fn(async () => []),
        upsertBusSegmentGeometries: vi.fn(async () => undefined),
        getVersionedBusSegmentGeometries: vi.fn(async () => []),
        upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
      },
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });

    const result = await service.resolveBusGeometry({ stops: routeStops });

    expect(provider.getRoadRouteSections).toHaveBeenCalledTimes(16);
    expect(result).toMatchObject({
      quality: "APPROXIMATE",
      reason: "PAIR_REQUEST_LIMIT",
    });
  });

  it("첫 waiter 취소가 공유 v3 cache fill과 다른 waiter를 취소하지 않는다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async ({ points }) => {
        await gate;
        return { sections: [[points[0]!, points[1]!]] };
      }),
    };
    const repository = {
      getBusSegmentGeometries: vi.fn(async () => []),
      upsertBusSegmentGeometries: vi.fn(async () => undefined),
      getVersionedBusSegmentGeometries: vi.fn(async () => []),
      upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
    };
    const service = new RouteGeometryService({
      provider,
      repository,
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });
    const controller = new AbortController();
    const first = service.resolveBusGeometry({
      stops: stops.slice(0, 2),
      signal: controller.signal,
    });
    await vi.waitFor(() => {
      expect(provider.getRoadRouteSections).toHaveBeenCalledTimes(1);
    });
    const second = service.resolveBusGeometry({ stops: stops.slice(0, 2) });

    controller.abort(new Error("first-waiter-cancelled"));
    await expect(first).resolves.toMatchObject({
      quality: "APPROXIMATE",
      reason: "ABORTED",
    });
    release();

    await expect(second).resolves.toMatchObject({
      quality: "DETAILED",
      reason: "NONE",
    });
    expect(provider.getRoadRouteSections).toHaveBeenCalledTimes(1);
    expect(repository.upsertVersionedBusSegmentGeometries)
      .toHaveBeenCalledTimes(1);
  });

  it("v3 join은 도로 snap 사이에 raw 내부 정류장을 넣지 않는다", async () => {
    const routeStops = [
      stop604(78, "오룡역7번출구", 36.328983, 127.40702),
      stop604(79, "충남여자중고등학교", 36.33083, 127.409966),
      stop604(80, "한사랑아파트", 36.33327, 127.412125),
    ];
    const middleRoadSnap = { lat: 36.330928, lng: 127.4097943 };
    const firstRoadStart = { lat: 36.32901, lng: 127.40704 };
    const lastRoadEnd = { lat: 36.33324, lng: 127.4121 };
    const saved: Array<{ coordinates: Coordinate[] }> = [];
    const repository = {
      getBusSegmentGeometries: vi.fn(async () => []),
      upsertBusSegmentGeometries: vi.fn(async () => undefined),
      getVersionedBusSegmentGeometries: vi.fn(async () => []),
      upsertVersionedBusSegmentGeometries: vi.fn(async (_city, _route, rows) => {
        saved.push(...rows);
      }),
    };
    const provider = {
      getRoadRouteGeometry: vi.fn(async () => []),
      getRoadRouteSections: vi.fn(async ({ points }) => ({
        sections: [points[0]!.lat === routeStops[0]!.latitude
          ? [firstRoadStart, middleRoadSnap]
          : [middleRoadSnap, lastRoadEnd]],
      })),
    };
    const service = new RouteGeometryService({
      provider,
      repository,
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });

    const result = await service.resolveBusGeometry({ stops: routeStops });
    const rawMiddle = {
      lat: routeStops[1]!.latitude,
      lng: routeStops[1]!.longitude,
    };

    expect(result).toMatchObject({ quality: "DETAILED", reason: "NONE" });
    expect(result.coordinates).not.toContainEqual(rawMiddle);
    expect(hasOutAndBackSpike(result.coordinates)).toBe(false);
    expect(saved[0]?.coordinates.at(-1)).toEqual(middleRoadSnap);
    expect(saved[1]?.coordinates[0]).toEqual(middleRoadSnap);
  });

  it("604번 69→70 독립쌍은 250~400m, detour ratio 1.5 이하로 수용한다", async () => {
    const routeStops = [
      stop604(69, "이마트", 36.355156, 127.37922),
      stop604(70, "갤러리아타임월드", 36.35272, 127.37907),
    ];
    const pairRoad = [
      { lat: 36.355156, lng: 127.37922 },
      { lat: 36.353938, lng: 127.37857 },
      { lat: 36.35272, lng: 127.37907 },
    ];
    const saved: Array<{
      distanceMeters: number;
      detourRatio: number;
    }> = [];
    const service = new RouteGeometryService({
      provider: {
        getRoadRouteGeometry: vi.fn(async () => []),
        getRoadRouteSections: vi.fn(async () => ({ sections: [pairRoad] })),
      },
      repository: {
        getBusSegmentGeometries: vi.fn(async () => []),
        upsertBusSegmentGeometries: vi.fn(async () => undefined),
        getVersionedBusSegmentGeometries: vi.fn(async () => []),
        upsertVersionedBusSegmentGeometries: vi.fn(async (_city, _route, rows) => {
          saved.push(...rows);
        }),
      },
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });

    const result = await service.resolveBusGeometry({ stops: routeStops });

    expect(result).toMatchObject({ quality: "DETAILED", reason: "NONE" });
    expect(distance(result.coordinates)).toBeGreaterThanOrEqual(250);
    expect(distance(result.coordinates)).toBeLessThanOrEqual(400);
    expect(saved[0]?.distanceMeters).toBeGreaterThanOrEqual(250);
    expect(saved[0]?.distanceMeters).toBeLessThanOrEqual(400);
    expect(saved[0]?.detourRatio).toBeLessThanOrEqual(1.5);
  });

  it("연속 road section 사이 30m 초과 단절은 DETAILED invariant를 막는다", () => {
    const routeStops = stops.slice(0, 3);
    const joined = joinBusRoadSections(routeStops, [
      [
        { lat: routeStops[0]!.latitude, lng: routeStops[0]!.longitude },
        { lat: routeStops[1]!.latitude, lng: routeStops[1]!.longitude },
      ],
      [
        { lat: routeStops[1]!.latitude + 0.001, lng: routeStops[1]!.longitude },
        { lat: routeStops[2]!.latitude, lng: routeStops[2]!.longitude },
      ],
    ]);

    expect(joined.continuityGap).toBe(true);
  });

  it("section 경계의 A-B-A를 제거한 뒤 돌출이 남지 않으면 DETAILED를 허용한다", async () => {
    const routeStops = stops.slice(0, 3);
    const junction = {
      lat: routeStops[1]!.latitude,
      lng: routeStops[1]!.longitude,
    };
    const spur = {
      lat: junction.lat + 0.0001,
      lng: junction.lng,
    };
    const joined = joinBusRoadSections(routeStops, [
      [
        { lat: routeStops[0]!.latitude, lng: routeStops[0]!.longitude },
        junction,
      ],
      [
        spur,
        junction,
        { lat: routeStops[2]!.latitude, lng: routeStops[2]!.longitude },
      ],
    ]);

    expect(joined.removedOutAndBack).toBe(true);
    expect(joined.outAndBack).toBe(false);
    expect(hasOutAndBackSpike(joined.coordinates)).toBe(false);

    const observations: Array<{ outAndBack?: boolean }> = [];
    const service = new RouteGeometryService({
      provider: {
        getRoadRouteGeometry: vi.fn(async () => []),
        getRoadRouteSections: vi.fn(async ({ points }) => ({
          sections: [points[0]!.lat === routeStops[0]!.latitude
            ? [points[0]!, junction]
            : [spur, junction, points[1]!]],
        })),
      },
      repository: {
        getBusSegmentGeometries: vi.fn(async () => []),
        upsertBusSegmentGeometries: vi.fn(async () => undefined),
        getVersionedBusSegmentGeometries: vi.fn(async () => []),
        upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
      },
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
    });

    const result = await service.resolveBusGeometry({
      stops: routeStops,
      observe: (observation) => observations.push(observation),
    });

    expect(result).toMatchObject({ quality: "DETAILED", reason: "NONE" });
    expect(hasOutAndBackSpike(result.coordinates)).toBe(false);
    expect(observations).toEqual([
      expect.objectContaining({
        outcome: "DETAILED",
        reason: "NONE",
        outAndBack: true,
      }),
    ]);
  });

  it("전체 A-B-A가 한 점으로 축약되면 최소 두 좌표 fallback으로 강등한다", () => {
    const start = stop(1, 36.35, 127.37);
    const middle = stop(2, 36.3501, 127.37);
    const returned = stop(3, 36.35, 127.37);
    const joined = joinBusRoadSections(
      [start, middle, returned],
      [
        [
          { lat: start.latitude, lng: start.longitude },
          { lat: middle.latitude, lng: middle.longitude },
        ],
        [
          { lat: middle.latitude, lng: middle.longitude },
          { lat: returned.latitude, lng: returned.longitude },
        ],
      ],
    );

    expect(joined.coordinates).toHaveLength(2);
    expect(joined.outAndBack).toBe(true);
    expect(joined.removedOutAndBack).toBe(true);
  });

  it("5m 이상 왕복하는 A-B-A section을 제거한 뒤 상세 경로로 수용한다", () => {
    const from = { lat: 36.35, lng: 127.37 };
    const to = { lat: 36.351, lng: 127.371 };
    const snap = { lat: 36.3504, lng: 127.3704 };
    const spur = { lat: 36.3506, lng: 127.3706 };
    const result = validateRoadSection(
      [from, snap, spur, snap, to],
      from,
      to,
    );

    expect(hasOutAndBackSpike([snap, spur, snap])).toBe(true);
    expect(result).toMatchObject({
      coordinates: [from, snap, to],
      reason: "NONE",
      outAndBack: true,
    });
  });

  it("A-B-A 제거 뒤 두 정점 미만이면 상세 경로로 수용하지 않는다", () => {
    const from = { lat: 36.35, lng: 127.37 };
    const spur = { lat: 36.3501, lng: 127.37 };
    const result = validateRoadSection([from, spur, from], from, from);

    expect(result).toMatchObject({
      coordinates: null,
      reason: "EXCESS_DETOUR",
      outAndBack: true,
    });
  });

  it("detour는 ratio 2.25 이상과 excess 200m 이상을 모두 만족할 때 거절한다", () => {
    const from = { lat: 36.35, lng: 127.37 };
    const to = { lat: 36.3527, lng: 127.37 };
    const excessOnly = validateRoadSection(
      [from, { lat: 36.35135, lng: 127.373 }, to],
      from,
      to,
    );
    const both = validateRoadSection(
      [from, { lat: 36.35135, lng: 127.3745 }, to],
      from,
      to,
    );
    const shortTo = { lat: 36.3509, lng: 127.37 };
    const ratioOnly = validateRoadSection(
      [from, { lat: 36.35045, lng: 127.3713 }, shortTo],
      from,
      shortTo,
    );

    expect(excessOnly.reason).toBe("NONE");
    expect(excessOnly.detourRatio).toBeLessThan(2.25);
    expect(both.detourRatio).toBeGreaterThanOrEqual(2.25);
    expect(both.distanceMeters - haversineDistanceMeters(from, to))
      .toBeGreaterThanOrEqual(200);
    expect(both.reason).toBe("EXCESS_DETOUR");
    expect(ratioOnly.detourRatio).toBeGreaterThanOrEqual(2.25);
    expect(ratioOnly.distanceMeters - haversineDistanceMeters(from, shortTo))
      .toBeLessThan(200);
    expect(ratioOnly.reason).toBe("NONE");
  });

  it("외부 timeout을 추천 실패로 전파하지 않고 근사 좌표와 사유로 격리한다", async () => {
    const observations: unknown[] = [];
    const service = new RouteGeometryService({
      repository: {
        getBusSegmentGeometries: vi.fn(async () => []),
        upsertBusSegmentGeometries: vi.fn(async () => undefined),
        getVersionedBusSegmentGeometries: vi.fn(async () => []),
        upsertVersionedBusSegmentGeometries: vi.fn(async () => undefined),
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
      queueStartedCount: 1,
      queueAbortedBeforeStartCount: 0,
    });
  });

  it("대기열에서 취소된 도보 형상은 공급자를 호출하지 않는다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    const running = Array.from({ length: 4 }, () =>
      withWalkingGeometryLimit(async () => {
        started += 1;
        await gate;
      }),
    );
    await vi.waitFor(() => expect(started).toBe(4));

    const controller = new AbortController();
    const queuedTask = vi.fn(async () => undefined);
    const queueObservations: Array<{
      queueWaitMilliseconds: number;
      started: boolean;
      abortedBeforeStart: boolean;
    }> = [];
    const queued = withWalkingGeometryLimit(
      queuedTask,
      controller.signal,
      (observation) => queueObservations.push(observation),
    );
    controller.abort(new Error("client-aborted"));

    await expect(queued).rejects.toMatchObject<Partial<ProviderError>>({
      kind: "ABORTED",
    });
    release();
    await Promise.all(running);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queuedTask).not.toHaveBeenCalled();
    expect(queueObservations).toHaveLength(1);
    expect(queueObservations[0]).toMatchObject({
      started: false,
      abortedBeforeStart: true,
    });
    expect(queueObservations[0]?.queueWaitMilliseconds)
      .toBeGreaterThanOrEqual(0);
  });

  it("이미 취소된 도보 형상은 0ms queue abort로 한 번만 관측한다", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already-aborted"));
    const task = vi.fn(async () => undefined);
    const observeQueue = vi.fn();

    await expect(withWalkingGeometryLimit(
      task,
      controller.signal,
      observeQueue,
    )).rejects.toMatchObject<Partial<ProviderError>>({ kind: "ABORTED" });

    expect(task).not.toHaveBeenCalled();
    expect(observeQueue).toHaveBeenCalledOnce();
    expect(observeQueue).toHaveBeenCalledWith({
      queueWaitMilliseconds: 0,
      started: false,
      abortedBeforeStart: true,
    });
  });
});
