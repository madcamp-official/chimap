import type { BusRouteStop } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { BUS_GEOMETRY_ALGORITHM_VERSION } from "../providers/route-geometry.js";
import {
  buildBusGeometryWarmPlan,
  busGeometryWarmPairsPerChunk,
  chunkBusGeometryWarmStops,
  parseBusGeometryAlgorithm,
  parseBusGeometryWarmConcurrency,
} from "./bus-geometry-warm-options.js";

function routeStops(count: number): BusRouteStop[] {
  return Array.from({ length: count }, (_, index) => ({
    routeId: "DJB30300071",
    stopId: `stop-${index + 1}`,
    nodeId: `node-${index + 1}`,
    cityCode: "25",
    stopName: `604-${index + 1}`,
    latitude: 36.35 + index * 0.0001,
    longitude: 127.37 + index * 0.0001,
    nodeOrder: index + 1,
    direction: null,
  }));
}

describe("warm-bus-geometry 옵션", () => {
  it("algorithm 기본값은 v3이고 legacy v2도 명시적으로 허용한다", () => {
    expect(parseBusGeometryAlgorithm()).toBe(
      BUS_GEOMETRY_ALGORITHM_VERSION,
    );
    expect(parseBusGeometryAlgorithm("transit-v2")).toBe("transit-v2");
    expect(() => parseBusGeometryAlgorithm("unknown")).toThrow(/algorithm/u);
  });

  it("concurrency는 기본 2, 최대 4로 제한한다", () => {
    expect(parseBusGeometryWarmConcurrency()).toBe(2);
    expect(parseBusGeometryWarmConcurrency("4")).toBe(4);
    expect(() => parseBusGeometryWarmConcurrency("0")).toThrow(/concurrency/u);
    expect(() => parseBusGeometryWarmConcurrency("5")).toThrow(/concurrency/u);
    expect(busGeometryWarmPairsPerChunk(1)).toBe(8);
    expect(busGeometryWarmPairsPerChunk(2)).toBe(4);
    expect(busGeometryWarmPairsPerChunk(4)).toBe(2);
  });

  it("node order 범위와 maxApiCalls를 검증한다", () => {
    const plan = buildBusGeometryWarmPlan(routeStops(20), {
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
      fromNodeOrder: 4,
      toNodeOrder: 12,
      maxApiCalls: 8,
    });

    expect(plan.stops.map((stop) => stop.nodeOrder)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(plan.estimatedApiCalls).toBe(8);
    expect(() => buildBusGeometryWarmPlan(routeStops(20), {
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
      maxApiCalls: 18,
    })).toThrow(/maxApiCalls/u);
  });

  it("전체 v3 노선을 concurrency에 맞춘 겹치는 chunk로 나눈다", () => {
    const stops = routeStops(20);
    const plan = buildBusGeometryWarmPlan(stops, {
      algorithmVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
      maxApiCalls: 19,
    });
    const chunks = chunkBusGeometryWarmStops(
      plan.stops,
      busGeometryWarmPairsPerChunk(2),
    );

    expect(chunks.map((chunk) => chunk.length)).toEqual([5, 5, 5, 5, 4]);
    expect(chunks[0]?.at(-1)?.nodeOrder).toBe(chunks[1]?.[0]?.nodeOrder);
    expect(chunks[1]?.at(-1)?.nodeOrder).toBe(chunks[2]?.[0]?.nodeOrder);
    expect(chunks.reduce((sum, chunk) => sum + chunk.length - 1, 0)).toBe(19);
  });
});
