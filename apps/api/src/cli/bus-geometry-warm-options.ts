import type { BusRouteStop } from "@chimap/contracts";

import {
  BUS_GEOMETRY_ALGORITHM_VERSION,
  MAX_BUS_GEOMETRY_PAIR_REQUESTS,
  type BusGeometryAlgorithmVersion,
} from "../providers/route-geometry.js";

export type BusGeometryWarmPlan = {
  algorithmVersion: BusGeometryAlgorithmVersion;
  stops: BusRouteStop[];
  estimatedApiCalls: number;
  maxApiCalls: number;
};

export function chunkBusGeometryWarmStops(
  stops: readonly BusRouteStop[],
  maxPairs = MAX_BUS_GEOMETRY_PAIR_REQUESTS,
): BusRouteStop[][] {
  if (!Number.isInteger(maxPairs) || maxPairs < 1) {
    throw new Error("warm-up chunk의 인접쌍 수는 1 이상이어야 합니다.");
  }
  const chunks: BusRouteStop[][] = [];
  let start = 0;
  while (start < stops.length - 1) {
    const end = Math.min(start + maxPairs, stops.length - 1);
    chunks.push(stops.slice(start, end + 1));
    start = end;
  }
  return chunks;
}

export function parseBusGeometryAlgorithm(
  value?: string,
): BusGeometryAlgorithmVersion {
  const algorithm = value ?? BUS_GEOMETRY_ALGORITHM_VERSION;
  if (
    algorithm === "transit-v2" ||
    algorithm === BUS_GEOMETRY_ALGORITHM_VERSION
  ) {
    return algorithm;
  }
  throw new Error(
    `--algorithm은 transit-v2 또는 ${BUS_GEOMETRY_ALGORITHM_VERSION}여야 합니다.`,
  );
}

export function parseBusGeometryWarmConcurrency(value?: string): number {
  const concurrency = Number(value ?? 2);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("--concurrency는 1 이상 4 이하의 정수여야 합니다.");
  }
  return concurrency;
}

export function busGeometryWarmPairsPerChunk(concurrency: number): number {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("warm-up concurrency는 1 이상 4 이하의 정수여야 합니다.");
  }
  return Math.max(
    1,
    Math.floor(MAX_BUS_GEOMETRY_PAIR_REQUESTS / concurrency),
  );
}

export function buildBusGeometryWarmPlan(
  routeStops: readonly BusRouteStop[],
  options: {
    algorithmVersion: BusGeometryAlgorithmVersion;
    fromNodeOrder?: number;
    toNodeOrder?: number;
    maxApiCalls: number;
  },
): BusGeometryWarmPlan {
  if (!Number.isInteger(options.maxApiCalls) || options.maxApiCalls < 1) {
    throw new Error("--maxApiCalls는 1 이상의 정수여야 합니다.");
  }
  if (
    options.fromNodeOrder !== undefined &&
    options.toNodeOrder !== undefined &&
    options.fromNodeOrder >= options.toNodeOrder
  ) {
    throw new Error("--fromNodeOrder는 --toNodeOrder보다 작아야 합니다.");
  }
  const stops = routeStops.filter(
    (stop) =>
      (options.fromNodeOrder === undefined ||
        stop.nodeOrder >= options.fromNodeOrder) &&
      (options.toNodeOrder === undefined ||
        stop.nodeOrder <= options.toNodeOrder),
  );
  if (stops.length < 2) {
    throw new Error("warm-up 범위에는 정류장이 2개 이상 있어야 합니다.");
  }
  const estimatedApiCalls =
    options.algorithmVersion === BUS_GEOMETRY_ALGORITHM_VERSION
      ? stops.length - 1
      : Math.ceil(Math.max(0, stops.length - 1) / 31);
  if (estimatedApiCalls > options.maxApiCalls) {
    throw new Error(
      `예상 API 호출 ${estimatedApiCalls}건이 --maxApiCalls ${options.maxApiCalls}건을 초과합니다.`,
    );
  }
  return {
    algorithmVersion: options.algorithmVersion,
    stops,
    estimatedApiCalls,
    maxApiCalls: options.maxApiCalls,
  };
}
