import {
  haversineDistanceMeters,
  type BusRouteStop,
  type Coordinate,
  type RouteGeometryQuality,
  type WalkingRole,
} from "@chimap/contracts";
import { createHash } from "node:crypto";
import pLimit from "p-limit";

import { ProviderError } from "../errors.js";
import { MemoryCache } from "../services/cache.js";
import type {
  BusSegmentGeometry,
  BusSegmentGeometryWrite,
  TransitRepository,
} from "../transit/transit-repository.js";
import type { RoadGeometryProvider } from "./types.js";

export type RouteGeometryReason =
  | "NONE"
  | "SHORT_DISTANCE"
  | "TIMEOUT"
  | "ABORTED"
  | "RATE_LIMIT"
  | "NO_ROUTE"
  | "UPSTREAM"
  | "EMPTY_PATH"
  | "SECTION_MISMATCH"
  | "ENDPOINT_MISMATCH"
  | "CONTINUITY_GAP"
  | "EXCESS_DETOUR";

export type RouteGeometryObservation = {
  mode: "BUS" | "WALK";
  outcome: "DETAILED" | "APPROXIMATE";
  reason: RouteGeometryReason;
  source: "KAKAO_ROAD" | "KAKAO_WALK" | "PRECOMPUTED" | "FALLBACK";
  cacheState: "FRESH" | "STALE" | "MISS" | "NONE";
  durationMilliseconds: number;
  inputVertexCount: number;
  outputVertexCount: number;
  successfulSectionCount: number;
  failedSectionCount: number;
  routeId?: string;
  fromNodeOrder?: number;
  toNodeOrder?: number;
  walkingRole?: WalkingRole;
};

export type ResolvedBusGeometry = {
  coordinates: Coordinate[];
  quality: RouteGeometryQuality;
  reason: RouteGeometryReason;
};

type ValidatedRoadSection = {
  coordinates: Coordinate[] | null;
  distanceMeters: number;
  reason: RouteGeometryReason;
};

const FRESH_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const EXPIRES_MILLISECONDS = 180 * 24 * 60 * 60 * 1_000;
const routeGeometryLimit = pLimit(4);

export function withRouteGeometryLimit<T>(task: () => Promise<T>): Promise<T> {
  return routeGeometryLimit(task);
}

function stopCoordinate(stop: BusRouteStop): Coordinate {
  return { lat: stop.latitude, lng: stop.longitude };
}

function appendDistinct(target: Coordinate[], point: Coordinate): void {
  const previous = target.at(-1);
  if (
    previous === undefined ||
    previous.lat !== point.lat ||
    previous.lng !== point.lng
  ) {
    target.push(point);
  }
}

function polylineDistance(points: readonly Coordinate[]): number {
  let distance = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    distance += haversineDistanceMeters(points[index]!, points[index + 1]!);
  }
  return Math.round(distance);
}

function isKoreanCoordinate(point: Coordinate): boolean {
  return point.lat >= 32.8 && point.lat <= 39.8 && point.lng >= 124 && point.lng <= 132;
}

export function busSegmentSourceHash(
  cityCode: string,
  routeId: string,
  from: BusRouteStop,
  to: BusRouteStop,
): string {
  return createHash("sha256")
    .update([
      cityCode,
      routeId,
      from.nodeOrder,
      from.nodeId,
      from.latitude.toFixed(7),
      from.longitude.toFixed(7),
      to.nodeOrder,
      to.nodeId,
      to.latitude.toFixed(7),
      to.longitude.toFixed(7),
    ].join("|"))
    .digest("hex");
}

export function validateRoadSection(
  section: readonly Coordinate[],
  from: Coordinate,
  to: Coordinate,
): ValidatedRoadSection {
  if (section.length < 2 || section.some((point) => !isKoreanCoordinate(point))) {
    return { coordinates: null, distanceMeters: 0, reason: "EMPTY_PATH" };
  }
  const forwardGap =
    haversineDistanceMeters(from, section[0]!) +
    haversineDistanceMeters(to, section.at(-1)!);
  const reverseGap =
    haversineDistanceMeters(from, section.at(-1)!) +
    haversineDistanceMeters(to, section[0]!);
  const oriented = reverseGap < forwardGap ? [...section].reverse() : [...section];
  const straightDistance = Math.max(1, haversineDistanceMeters(from, to));
  const endpointTolerance = Math.min(250, Math.max(75, straightDistance * 0.5));
  if (
    haversineDistanceMeters(from, oriented[0]!) > endpointTolerance ||
    haversineDistanceMeters(to, oriented.at(-1)!) > endpointTolerance
  ) {
    return { coordinates: null, distanceMeters: 0, reason: "ENDPOINT_MISMATCH" };
  }
  const pathDistance = polylineDistance(oriented);
  if (pathDistance > Math.max(straightDistance + 300, straightDistance * 3)) {
    return { coordinates: null, distanceMeters: pathDistance, reason: "EXCESS_DETOUR" };
  }
  const coordinates: Coordinate[] = [];
  appendDistinct(coordinates, from);
  oriented.forEach((point) => appendDistinct(coordinates, point));
  appendDistinct(coordinates, to);
  return {
    coordinates,
    distanceMeters: Math.max(1, polylineDistance(coordinates)),
    reason: "NONE",
  };
}

export function classifyGeometryError(error: unknown): RouteGeometryReason {
  if (error instanceof ProviderError) {
    const causeReason =
      typeof error.cause === "object" &&
      error.cause !== null &&
      "geometryReason" in error.cause
        ? error.cause.geometryReason
        : undefined;
    if (
      causeReason === "EMPTY_PATH" ||
      causeReason === "CONTINUITY_GAP" ||
      causeReason === "ENDPOINT_MISMATCH"
    ) {
      return causeReason;
    }
    if (error.kind === "TIMEOUT") return "TIMEOUT";
    if (error.kind === "ABORTED") return "ABORTED";
    if (error.kind === "RATE_LIMIT") return "RATE_LIMIT";
    if (error.kind === "NO_ROUTE") return "NO_ROUTE";
  }
  return "UPSTREAM";
}

export class RouteGeometryService {
  readonly #provider: RoadGeometryProvider;
  readonly #repository: Pick<
    TransitRepository,
    "getBusSegmentGeometries" | "upsertBusSegmentGeometries"
  >;
  readonly #refreshCache = new MemoryCache(64 * 1024 * 1024);

  public constructor(options: {
    provider: RoadGeometryProvider;
    repository: Pick<
      TransitRepository,
      "getBusSegmentGeometries" | "upsertBusSegmentGeometries"
    >;
  }) {
    this.#provider = options.provider;
    this.#repository = options.repository;
  }

  async #fetchAndStore(
    stops: BusRouteStop[],
    signal?: AbortSignal,
  ): Promise<Map<string, BusSegmentGeometry>> {
    const first = stops[0]!;
    const key = [
      first.cityCode,
      first.routeId,
      first.nodeOrder,
      stops.at(-1)!.nodeOrder,
      ...stops.slice(0, -1).map((stop, index) =>
        busSegmentSourceHash(first.cityCode, first.routeId, stop, stops[index + 1]!),
      ),
    ].join(":");
    return this.#refreshCache.getOrLoad(key, 30_000, () => {
      const budgetSignal = AbortSignal.timeout(8_000);
      return withRouteGeometryLimit(async () => {
        const combinedSignal = signal === undefined
          ? budgetSignal
          : AbortSignal.any([signal, budgetSignal]);
        const response = await this.#provider.getRoadRouteSections({
          points: stops.map(stopCoordinate),
          signal: combinedSignal,
        });
        if (response.sections.length !== stops.length - 1) {
          return new Map();
        }
        const now = Date.now();
        const writes: BusSegmentGeometryWrite[] = [];
        const result = new Map<string, BusSegmentGeometry>();
        for (let index = 0; index < stops.length - 1; index += 1) {
          const from = stops[index]!;
          const to = stops[index + 1]!;
          const validated = validateRoadSection(
            response.sections[index] ?? [],
            stopCoordinate(from),
            stopCoordinate(to),
          );
          if (validated.coordinates === null) continue;
          const sourceHash = busSegmentSourceHash(first.cityCode, first.routeId, from, to);
          const row: BusSegmentGeometryWrite = {
            fromNodeOrder: from.nodeOrder,
            toNodeOrder: to.nodeOrder,
            coordinates: validated.coordinates,
            distanceMeters: validated.distanceMeters,
            geometrySource: "KAKAO_ROAD",
            geometryVersion: "transit-v2",
            sourceHash,
            freshUntil: new Date(now + FRESH_MILLISECONDS),
            expiresAt: new Date(now + EXPIRES_MILLISECONDS),
          };
          writes.push(row);
          result.set(`${from.nodeOrder}:${to.nodeOrder}`, {
            ...row,
            cacheState: "FRESH",
          });
        }
        try {
          await this.#repository.upsertBusSegmentGeometries(
            first.cityCode,
            first.routeId,
            writes,
          );
        } catch {
          // Cache persistence must never make an otherwise valid route fail.
        }
        return result;
      });
    });
  }

  public async resolveBusGeometry(input: {
    stops: BusRouteStop[];
    signal?: AbortSignal;
    observe?: (observation: RouteGeometryObservation) => void;
  }): Promise<ResolvedBusGeometry> {
    const startedAt = performance.now();
    const first = input.stops[0];
    const last = input.stops.at(-1);
    if (first === undefined || last === undefined || input.stops.length < 2) {
      return { coordinates: [], quality: "APPROXIMATE", reason: "EMPTY_PATH" };
    }
    const expected = input.stops.slice(0, -1).map((from, index) => ({
      from,
      to: input.stops[index + 1]!,
      key: `${from.nodeOrder}:${input.stops[index + 1]!.nodeOrder}`,
      hash: busSegmentSourceHash(first.cityCode, first.routeId, from, input.stops[index + 1]!),
    }));
    let stored: BusSegmentGeometry[] = [];
    try {
      stored = await this.#repository.getBusSegmentGeometries(first.cityCode, first.routeId);
    } catch {
      stored = [];
    }
    const available = new Map(
      stored
        .filter((row) => expected.some((item) => item.key === `${row.fromNodeOrder}:${row.toNodeOrder}` && item.hash === row.sourceHash))
        .map((row) => [`${row.fromNodeOrder}:${row.toNodeOrder}`, row]),
    );
    const hasStale = [...available.values()].some((row) => row.cacheState === "STALE");
    let failureReason: RouteGeometryReason = "NONE";
    if (available.size < expected.length) {
      try {
        const fetched = await this.#fetchAndStore(input.stops, input.signal);
        fetched.forEach((value, key) => available.set(key, value));
        if (fetched.size < expected.length) failureReason = "SECTION_MISMATCH";
      } catch (error) {
        failureReason = classifyGeometryError(error);
      }
    } else if (hasStale) {
      void this.#fetchAndStore(input.stops).catch(() => undefined);
    }

    const joined: Coordinate[] = [];
    let successful = 0;
    let failed = 0;
    for (const item of expected) {
      const geometry = available.get(item.key);
      if (geometry === undefined) {
        appendDistinct(joined, stopCoordinate(item.from));
        appendDistinct(joined, stopCoordinate(item.to));
        failed += 1;
      } else {
        geometry.coordinates.forEach((point) => appendDistinct(joined, point));
        successful += 1;
      }
    }
    const quality: RouteGeometryQuality = failed === 0 ? "DETAILED" : "APPROXIMATE";
    const reason = quality === "DETAILED"
      ? "NONE"
      : failureReason === "NONE" ? "EMPTY_PATH" : failureReason;
    input.observe?.({
      mode: "BUS",
      outcome: quality,
      reason,
      source: quality === "DETAILED" ? "KAKAO_ROAD" : "FALLBACK",
      cacheState: available.size === 0 ? "MISS" : hasStale ? "STALE" : "FRESH",
      durationMilliseconds: performance.now() - startedAt,
      inputVertexCount: input.stops.length,
      outputVertexCount: joined.length,
      successfulSectionCount: successful,
      failedSectionCount: failed,
      routeId: first.routeId,
      fromNodeOrder: first.nodeOrder,
      toNodeOrder: last.nodeOrder,
    });
    return { coordinates: joined, quality, reason };
  }
}
