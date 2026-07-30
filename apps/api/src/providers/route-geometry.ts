import {
  haversineDistanceMeters,
  type BusRouteStop,
  type Coordinate,
  type RouteGeometryQuality,
  type WalkingRole,
} from "@chimap/contracts";
import { createHash } from "node:crypto";
import pLimit, { type LimitFunction } from "p-limit";

import { ProviderError } from "../errors.js";
import { MemoryCache } from "../services/cache.js";
import type {
  BusSegmentGeometry,
  BusSegmentGeometryWrite,
  TransitRepository,
  VersionedBusSegmentGeometry,
  VersionedBusSegmentGeometryWrite,
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
  | "PAIR_REQUEST_LIMIT"
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
  geometryVersion?: string;
  startSnapDistanceMeters?: number;
  endSnapDistanceMeters?: number;
  detourRatio?: number;
  outAndBack?: boolean;
  queueWaitMilliseconds?: number;
  queueStartedCount?: number;
  queueAbortedBeforeStartCount?: number;
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
  startSnapDistanceMeters: number;
  endSnapDistanceMeters: number;
  detourRatio: number;
  outAndBack: boolean;
};

type ExpectedBusSection = {
  from: BusRouteStop;
  to: BusRouteStop;
  key: string;
  hash: string;
};

type BusGeometryFetchResult = {
  geometries: Map<string, VersionedBusSegmentGeometry>;
  failureReason: RouteGeometryReason;
  queueWaitMilliseconds: number;
  queueStartedCount: number;
  queueAbortedBeforeStartCount: number;
};

type LegacyBusGeometryFetchResult = {
  geometries: Map<string, BusSegmentGeometry>;
  queueWaitMilliseconds: number;
  queueStartedCount: number;
  queueAbortedBeforeStartCount: number;
};

export type JoinedBusRoadSections = {
  coordinates: Coordinate[];
  continuityGap: boolean;
  outAndBack: boolean;
  removedOutAndBack: boolean;
};

export type RouteGeometryQueueObservation = {
  queueWaitMilliseconds: number;
  started: boolean;
  abortedBeforeStart: boolean;
};

const FRESH_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const EXPIRES_MILLISECONDS = 180 * 24 * 60 * 60 * 1_000;
const MAX_ENDPOINT_SNAP_METERS = 75;
const MIN_ENDPOINT_SNAP_METERS = 35;
const MAX_SECTION_JOIN_GAP_METERS = 30;
const OUT_AND_BACK_RETURN_METERS = 3;
const OUT_AND_BACK_LEG_METERS = 5;
const busGeometryLimit = pLimit(4);
const busGeometryContinuationLimit = pLimit(1);
const walkingGeometryLimit = pLimit(4);

export const BUS_GEOMETRY_ALGORITHM_VERSION = "kakao-road-pair-v3";
export const BUS_GEOMETRY_VALIDATION_VERSION =
  "endpoint15pct35to75-join30-detour225and200-spike3x5-v1";
export const MAX_BUS_GEOMETRY_PAIR_REQUESTS = 8;
export type BusGeometryAlgorithmVersion =
  | "transit-v2"
  | typeof BUS_GEOMETRY_ALGORITHM_VERSION;

function abortReason(signal: AbortSignal): ProviderError {
  const timedOut =
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError";
  return new ProviderError({
    kind: timedOut ? "TIMEOUT" : "ABORTED",
    message: timedOut
      ? "경로 형상 요청 시간이 초과되었습니다."
      : "경로 형상 요청이 취소되었습니다.",
    retryable: timedOut,
    cause: signal.reason,
  });
}

function withAbortableLimit<T>(
  limit: LimitFunction,
  task: () => Promise<T>,
  signal?: AbortSignal,
  observeQueue?: (observation: RouteGeometryQueueObservation) => void,
): Promise<T> {
  if (signal?.aborted === true) {
    observeQueue?.({
      queueWaitMilliseconds: 0,
      started: false,
      abortedBeforeStart: true,
    });
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const enqueuedAt = performance.now();
    let settled = false;
    let started = false;
    let queueObserved = false;
    const reportQueue = (abortedBeforeStart: boolean) => {
      if (queueObserved) return;
      queueObserved = true;
      observeQueue?.({
        queueWaitMilliseconds: performance.now() - enqueuedAt,
        started,
        abortedBeforeStart,
      });
    };
    const settle = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      operation();
    };
    const handleAbort = () => {
      if (!started) reportQueue(true);
      settle(() => reject(abortReason(signal!)));
    };
    signal?.addEventListener("abort", handleAbort, { once: true });
    void limit(async () => {
      started = true;
      reportQueue(false);
      if (signal?.aborted === true) throw abortReason(signal);
      return task();
    }).then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

export function withRouteGeometryLimit<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
  observeQueue?: (observation: RouteGeometryQueueObservation) => void,
): Promise<T> {
  return withAbortableLimit(busGeometryLimit, task, signal, observeQueue);
}

export function withWalkingGeometryLimit<T>(
  task: () => Promise<T>,
  signal?: AbortSignal,
  observeQueue?: (observation: RouteGeometryQueueObservation) => void,
): Promise<T> {
  return withAbortableLimit(walkingGeometryLimit, task, signal, observeQueue);
}

function waitForSharedFill<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return pending;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      operation();
    };
    const handleAbort = () => settle(() => reject(abortReason(signal)));
    signal.addEventListener("abort", handleAbort, { once: true });
    void pending.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
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

function appendJoinPoint(target: Coordinate[], point: Coordinate): void {
  const previous = target.at(-1);
  if (
    previous === undefined ||
    haversineDistanceMeters(previous, point) > OUT_AND_BACK_RETURN_METERS
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

export function hasOutAndBackSpike(
  points: readonly Coordinate[],
): boolean {
  for (let index = 0; index < points.length - 2; index += 1) {
    const before = points[index]!;
    const middle = points[index + 1]!;
    const after = points[index + 2]!;
    if (
      haversineDistanceMeters(before, after) <= OUT_AND_BACK_RETURN_METERS &&
      haversineDistanceMeters(before, middle) >= OUT_AND_BACK_LEG_METERS &&
      haversineDistanceMeters(middle, after) >= OUT_AND_BACK_LEG_METERS
    ) {
      return true;
    }
  }
  return false;
}

function removeOutAndBackSpikes(
  points: readonly Coordinate[],
): { coordinates: Coordinate[]; removed: boolean } {
  const coordinates: Coordinate[] = [];
  let removed = false;
  for (const point of points) {
    appendDistinct(coordinates, point);
    while (coordinates.length >= 3) {
      const triplet = coordinates.slice(-3);
      if (!hasOutAndBackSpike(triplet)) break;
      coordinates.splice(coordinates.length - 2, 2);
      removed = true;
    }
  }
  return { coordinates, removed };
}

function roadSectionMetrics(
  section: readonly Coordinate[],
  from: Coordinate,
  to: Coordinate,
): Omit<ValidatedRoadSection, "coordinates" | "distanceMeters" | "reason" | "outAndBack"> {
  const straightDistance = Math.max(1, haversineDistanceMeters(from, to));
  return {
    startSnapDistanceMeters: section[0] === undefined
      ? Number.POSITIVE_INFINITY
      : haversineDistanceMeters(from, section[0]),
    endSnapDistanceMeters: section.at(-1) === undefined
      ? Number.POSITIVE_INFINITY
      : haversineDistanceMeters(to, section.at(-1)!),
    detourRatio: polylineDistance(section) / straightDistance,
  };
}

export function busSegmentSourceHash(
  cityCode: string,
  routeId: string,
  from: BusRouteStop,
  to: BusRouteStop,
  algorithmVersion: BusGeometryAlgorithmVersion =
    BUS_GEOMETRY_ALGORITHM_VERSION,
  validationVersion = BUS_GEOMETRY_VALIDATION_VERSION,
): string {
  const versionPrefix = algorithmVersion === "transit-v2"
    ? []
    : [algorithmVersion, validationVersion];
  return createHash("sha256")
    .update([
      ...versionPrefix,
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
    return {
      coordinates: null,
      distanceMeters: 0,
      reason: "EMPTY_PATH",
      startSnapDistanceMeters: Number.POSITIVE_INFINITY,
      endSnapDistanceMeters: Number.POSITIVE_INFINITY,
      detourRatio: Number.POSITIVE_INFINITY,
      outAndBack: false,
    };
  }
  const forwardGap =
    haversineDistanceMeters(from, section[0]!) +
    haversineDistanceMeters(to, section.at(-1)!);
  const reverseGap =
    haversineDistanceMeters(from, section.at(-1)!) +
    haversineDistanceMeters(to, section[0]!);
  const oriented = reverseGap < forwardGap ? [...section].reverse() : [...section];
  const sanitized = removeOutAndBackSpikes(oriented);
  const outAndBack = hasOutAndBackSpike(sanitized.coordinates);
  if (sanitized.coordinates.length < 2) {
    return {
      coordinates: null,
      distanceMeters: polylineDistance(oriented),
      reason: "EXCESS_DETOUR",
      ...roadSectionMetrics(oriented, from, to),
      outAndBack: true,
    };
  }
  const straightDistance = Math.max(1, haversineDistanceMeters(from, to));
  const metrics = roadSectionMetrics(sanitized.coordinates, from, to);
  const endpointTolerance = Math.min(
    MAX_ENDPOINT_SNAP_METERS,
    Math.max(MIN_ENDPOINT_SNAP_METERS, straightDistance * 0.15),
  );
  if (
    metrics.startSnapDistanceMeters > endpointTolerance ||
    metrics.endSnapDistanceMeters > endpointTolerance
  ) {
    return {
      coordinates: null,
      distanceMeters: 0,
      reason: "ENDPOINT_MISMATCH",
      ...metrics,
      outAndBack: false,
    };
  }
  const pathDistance = polylineDistance(sanitized.coordinates);
  if (pathDistance < 1 || !Number.isFinite(metrics.detourRatio)) {
    return {
      coordinates: null,
      distanceMeters: 0,
      reason: "EMPTY_PATH",
      ...metrics,
      outAndBack: false,
    };
  }
  if (
    (
      pathDistance / straightDistance >= 2.25 &&
      pathDistance - straightDistance >= 200
    ) ||
    outAndBack
  ) {
    return {
      coordinates: null,
      distanceMeters: pathDistance,
      reason: "EXCESS_DETOUR",
      ...metrics,
      outAndBack,
    };
  }
  return {
    coordinates: sanitized.coordinates,
    distanceMeters: Math.max(1, pathDistance),
    reason: "NONE",
    ...metrics,
    outAndBack: sanitized.removed,
  };
}

export function joinBusRoadSections(
  stops: readonly BusRouteStop[],
  sections: readonly (readonly Coordinate[] | null | undefined)[],
): JoinedBusRoadSections {
  const first = stops[0];
  const last = stops.at(-1);
  if (first === undefined || last === undefined || stops.length < 2) {
    return {
      coordinates: [],
      continuityGap: false,
      outAndBack: false,
      removedOutAndBack: false,
    };
  }

  const joined: Coordinate[] = [stopCoordinate(first)];
  let previousAvailableIndex: number | undefined;
  let previousRoadEnd: Coordinate | undefined;
  let continuityGap = false;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const section = sections[index];
    if (section === undefined || section === null || section.length < 2) {
      appendJoinPoint(joined, stopCoordinate(stops[index]!));
      appendDistinct(joined, stopCoordinate(stops[index + 1]!));
      previousAvailableIndex = undefined;
      previousRoadEnd = undefined;
      continue;
    }
    if (
      previousAvailableIndex === index - 1 &&
      previousRoadEnd !== undefined &&
      haversineDistanceMeters(previousRoadEnd, section[0]!) >
        MAX_SECTION_JOIN_GAP_METERS
    ) {
      continuityGap = true;
    }
    section.forEach((point, pointIndex) => {
      if (pointIndex === 0) appendJoinPoint(joined, point);
      else appendDistinct(joined, point);
    });
    previousAvailableIndex = index;
    previousRoadEnd = section.at(-1);
  }
  appendJoinPoint(joined, stopCoordinate(last));

  const sanitized = removeOutAndBackSpikes(joined);
  const collapsed = sanitized.coordinates.length < 2;
  return {
    coordinates: collapsed
      ? [stopCoordinate(first), stopCoordinate(last)]
      : sanitized.coordinates,
    continuityGap,
    outAndBack: collapsed || hasOutAndBackSpike(sanitized.coordinates),
    removedOutAndBack: sanitized.removed,
  };
}

function validateLegacyRoadSection(
  section: readonly Coordinate[],
  from: Coordinate,
  to: Coordinate,
): ValidatedRoadSection {
  if (section.length < 2 || section.some((point) => !isKoreanCoordinate(point))) {
    return {
      coordinates: null,
      distanceMeters: 0,
      reason: "EMPTY_PATH",
      startSnapDistanceMeters: Number.POSITIVE_INFINITY,
      endSnapDistanceMeters: Number.POSITIVE_INFINITY,
      detourRatio: Number.POSITIVE_INFINITY,
      outAndBack: false,
    };
  }
  const forwardGap =
    haversineDistanceMeters(from, section[0]!) +
    haversineDistanceMeters(to, section.at(-1)!);
  const reverseGap =
    haversineDistanceMeters(from, section.at(-1)!) +
    haversineDistanceMeters(to, section[0]!);
  const oriented = reverseGap < forwardGap ? [...section].reverse() : [...section];
  const straightDistance = Math.max(1, haversineDistanceMeters(from, to));
  const metrics = roadSectionMetrics(oriented, from, to);
  const endpointTolerance = Math.min(250, Math.max(75, straightDistance * 0.5));
  if (
    metrics.startSnapDistanceMeters > endpointTolerance ||
    metrics.endSnapDistanceMeters > endpointTolerance
  ) {
    return {
      coordinates: null,
      distanceMeters: 0,
      reason: "ENDPOINT_MISMATCH",
      ...metrics,
      outAndBack: false,
    };
  }
  const pathDistance = polylineDistance(oriented);
  if (pathDistance > Math.max(straightDistance + 300, straightDistance * 3)) {
    return {
      coordinates: null,
      distanceMeters: pathDistance,
      reason: "EXCESS_DETOUR",
      ...metrics,
      outAndBack: false,
    };
  }
  const coordinates: Coordinate[] = [];
  appendDistinct(coordinates, from);
  oriented.forEach((point) => appendDistinct(coordinates, point));
  appendDistinct(coordinates, to);
  return {
    coordinates,
    distanceMeters: Math.max(1, polylineDistance(coordinates)),
    reason: "NONE",
    ...metrics,
    outAndBack: hasOutAndBackSpike(coordinates),
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
      causeReason === "SECTION_MISMATCH" ||
      causeReason === "PAIR_REQUEST_LIMIT" ||
      causeReason === "CONTINUITY_GAP" ||
      causeReason === "ENDPOINT_MISMATCH" ||
      causeReason === "EXCESS_DETOUR"
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
    | "getBusSegmentGeometries"
    | "upsertBusSegmentGeometries"
    | "getVersionedBusSegmentGeometries"
    | "upsertVersionedBusSegmentGeometries"
  >;
  readonly #algorithmVersion: BusGeometryAlgorithmVersion;
  readonly #refreshCache = new MemoryCache(64 * 1024 * 1024);

  public constructor(options: {
    provider: RoadGeometryProvider;
    repository: Pick<
      TransitRepository,
      | "getBusSegmentGeometries"
      | "upsertBusSegmentGeometries"
      | "getVersionedBusSegmentGeometries"
      | "upsertVersionedBusSegmentGeometries"
    >;
    algorithmVersion?: BusGeometryAlgorithmVersion;
  }) {
    this.#provider = options.provider;
    this.#repository = options.repository;
    this.#algorithmVersion = options.algorithmVersion ?? "transit-v2";
  }

  async #fetchAndStoreLegacy(
    stops: BusRouteStop[],
    signal?: AbortSignal,
    bypassMemoryCache = false,
    observeQueue?: (observation: RouteGeometryQueueObservation) => void,
  ): Promise<LegacyBusGeometryFetchResult> {
    const first = stops[0]!;
    const key = [
      "transit-v2",
      first.cityCode,
      first.routeId,
      first.nodeOrder,
      stops.at(-1)!.nodeOrder,
      ...stops.slice(0, -1).map((stop, index) =>
        busSegmentSourceHash(
          first.cityCode,
          first.routeId,
          stop,
          stops[index + 1]!,
          "transit-v2",
        ),
      ),
    ].join(":");
    const load = async (): Promise<LegacyBusGeometryFetchResult> => {
      const budgetSignal = AbortSignal.timeout(8_000);
      const combinedSignal = signal === undefined
        ? budgetSignal
        : AbortSignal.any([signal, budgetSignal]);
      let queueWaitMilliseconds = 0;
      let queueStartedCount = 0;
      let queueAbortedBeforeStartCount = 0;
      const geometries = await withRouteGeometryLimit(async () => {
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
          const validated = validateLegacyRoadSection(
            response.sections[index] ?? [],
            stopCoordinate(from),
            stopCoordinate(to),
          );
          if (validated.coordinates === null) continue;
          const sourceHash = busSegmentSourceHash(
            first.cityCode,
            first.routeId,
            from,
            to,
            "transit-v2",
          );
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
      }, combinedSignal, (observation) => {
        queueWaitMilliseconds = observation.queueWaitMilliseconds;
        queueStartedCount = observation.started ? 1 : 0;
        queueAbortedBeforeStartCount = observation.abortedBeforeStart ? 1 : 0;
        observeQueue?.(observation);
      });
      return {
        geometries,
        queueWaitMilliseconds,
        queueStartedCount,
        queueAbortedBeforeStartCount,
      };
    };
    return bypassMemoryCache
      ? load()
      : this.#refreshCache.getOrLoad(key, 30_000, load);
  }

  async #fetchAndStorePairSections(
    expected: ExpectedBusSection[],
    signal?: AbortSignal,
    bypassMemoryCache = false,
  ): Promise<BusGeometryFetchResult> {
    if (expected.length === 0) {
      return {
        geometries: new Map(),
        failureReason: "NONE",
        queueWaitMilliseconds: 0,
        queueStartedCount: 0,
        queueAbortedBeforeStartCount: 0,
      };
    }
    const first = expected[0]!.from;
    const key = [
      BUS_GEOMETRY_ALGORITHM_VERSION,
      first.cityCode,
      first.routeId,
      ...expected.map((section) => section.hash),
    ].join(":");
    const load = async (
      loadSignal?: AbortSignal,
    ): Promise<BusGeometryFetchResult> => {
      const budgetSignal = AbortSignal.timeout(8_000);
      const combinedSignal = loadSignal === undefined
        ? budgetSignal
        : AbortSignal.any([loadSignal, budgetSignal]);
      let queueWaitMilliseconds = 0;
      let queueStartedCount = 0;
      let queueAbortedBeforeStartCount = 0;
      const pairResults = await Promise.all(
        expected.map(async (item) => {
          try {
            const response = await withRouteGeometryLimit(
              () => this.#provider.getRoadRouteSections({
                points: [stopCoordinate(item.from), stopCoordinate(item.to)],
                signal: combinedSignal,
              }),
              combinedSignal,
              (observation) => {
                queueWaitMilliseconds = Math.max(
                  queueWaitMilliseconds,
                  observation.queueWaitMilliseconds,
                );
                if (observation.started) queueStartedCount += 1;
                if (observation.abortedBeforeStart) {
                  queueAbortedBeforeStartCount += 1;
                }
              },
            );
            if (response.sections.length !== 1) {
              return { item, reason: "SECTION_MISMATCH" as const };
            }
            const validated = validateRoadSection(
              response.sections[0] ?? [],
              stopCoordinate(item.from),
              stopCoordinate(item.to),
            );
            if (validated.coordinates === null) {
              return { item, reason: validated.reason };
            }
            return { item, validated };
          } catch (error) {
            return { item, reason: classifyGeometryError(error) };
          }
        }),
      );
      const now = Date.now();
      const writes: VersionedBusSegmentGeometryWrite[] = [];
      const geometries = new Map<string, VersionedBusSegmentGeometry>();
      let failureReason: RouteGeometryReason = "NONE";
      for (const pairResult of pairResults) {
        if (!("validated" in pairResult)) {
          if (failureReason === "NONE") failureReason = pairResult.reason;
          continue;
        }
        const row: VersionedBusSegmentGeometryWrite = {
          fromNodeOrder: pairResult.item.from.nodeOrder,
          toNodeOrder: pairResult.item.to.nodeOrder,
          coordinates: pairResult.validated.coordinates!,
          distanceMeters: pairResult.validated.distanceMeters,
          geometrySource: "KAKAO_ROAD",
          geometryVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
          sourceHash: pairResult.item.hash,
          startSnapDistanceMeters:
            pairResult.validated.startSnapDistanceMeters,
          endSnapDistanceMeters: pairResult.validated.endSnapDistanceMeters,
          detourRatio: pairResult.validated.detourRatio,
          outAndBack: pairResult.validated.outAndBack,
          freshUntil: new Date(now + FRESH_MILLISECONDS),
          expiresAt: new Date(now + EXPIRES_MILLISECONDS),
        };
        writes.push(row);
        geometries.set(pairResult.item.key, { ...row, cacheState: "FRESH" });
      }
      try {
        await this.#repository.upsertVersionedBusSegmentGeometries(
          first.cityCode,
          first.routeId,
          writes,
        );
      } catch {
        // Cache persistence must never make an otherwise valid route fail.
      }
      return {
        geometries,
        failureReason,
        queueWaitMilliseconds,
        queueStartedCount,
        queueAbortedBeforeStartCount,
      };
    };
    if (bypassMemoryCache) return load(signal);
    const shared = this.#refreshCache.getOrLoad(
      key,
      30_000,
      () => load(),
    );
    return waitForSharedFill(shared, signal);
  }

  async #fetchPairSectionContinuation(
    expected: ExpectedBusSection[],
    bypassMemoryCache = false,
  ): Promise<BusGeometryFetchResult> {
    const chunk = expected.slice(0, MAX_BUS_GEOMETRY_PAIR_REQUESTS);
    return busGeometryContinuationLimit(() =>
      this.#fetchAndStorePairSections(
        chunk,
        undefined,
        bypassMemoryCache,
      ),
    );
  }

  async #resolveLegacyBusGeometry(input: {
    stops: BusRouteStop[];
    signal?: AbortSignal;
    observe?: (observation: RouteGeometryObservation) => void;
    forceRefresh?: boolean;
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
      hash: busSegmentSourceHash(
        first.cityCode,
        first.routeId,
        from,
        input.stops[index + 1]!,
        "transit-v2",
      ),
    }));
    let stored: BusSegmentGeometry[] = [];
    if (input.forceRefresh !== true) {
      try {
        stored = await this.#repository.getBusSegmentGeometries(first.cityCode, first.routeId);
      } catch {
        stored = [];
      }
    }
    const available = new Map(
      stored
        .filter((row) => expected.some((item) => item.key === `${row.fromNodeOrder}:${row.toNodeOrder}` && item.hash === row.sourceHash))
        .map((row) => [`${row.fromNodeOrder}:${row.toNodeOrder}`, row]),
    );
    const hasStale = [...available.values()].some((row) => row.cacheState === "STALE");
    let failureReason: RouteGeometryReason = "NONE";
    let queueWaitMilliseconds = 0;
    let queueStartedCount = 0;
    let queueAbortedBeforeStartCount = 0;
    if (available.size < expected.length) {
      try {
        const fetched = await this.#fetchAndStoreLegacy(
          input.stops,
          input.signal,
          input.forceRefresh === true,
          (observation) => {
            queueWaitMilliseconds = observation.queueWaitMilliseconds;
            queueStartedCount = observation.started ? 1 : 0;
            queueAbortedBeforeStartCount = observation.abortedBeforeStart
              ? 1
              : 0;
          },
        );
        fetched.geometries.forEach((value, key) => available.set(key, value));
        queueWaitMilliseconds = fetched.queueWaitMilliseconds;
        queueStartedCount = fetched.queueStartedCount;
        queueAbortedBeforeStartCount = fetched.queueAbortedBeforeStartCount;
        if (fetched.geometries.size < expected.length) {
          failureReason = "SECTION_MISMATCH";
        }
      } catch (error) {
        failureReason = classifyGeometryError(error);
      }
    } else if (hasStale) {
      void this.#fetchAndStoreLegacy(input.stops).catch(() => undefined);
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
      geometryVersion: "transit-v2",
      queueWaitMilliseconds,
      queueStartedCount,
      queueAbortedBeforeStartCount,
    });
    return { coordinates: joined, quality, reason };
  }

  async #resolvePairBusGeometry(input: {
    stops: BusRouteStop[];
    signal?: AbortSignal;
    observe?: (observation: RouteGeometryObservation) => void;
    forceRefresh?: boolean;
  }): Promise<ResolvedBusGeometry> {
    const startedAt = performance.now();
    const first = input.stops[0];
    const last = input.stops.at(-1);
    if (first === undefined || last === undefined || input.stops.length < 2) {
      return { coordinates: [], quality: "APPROXIMATE", reason: "EMPTY_PATH" };
    }
    const expected: ExpectedBusSection[] = input.stops.slice(0, -1).map(
      (from, index) => {
        const to = input.stops[index + 1]!;
        return {
          from,
          to,
          key: `${from.nodeOrder}:${to.nodeOrder}`,
          hash: busSegmentSourceHash(
            first.cityCode,
            first.routeId,
            from,
            to,
            BUS_GEOMETRY_ALGORITHM_VERSION,
          ),
        };
      },
    );
    let stored: VersionedBusSegmentGeometry[] = [];
    if (input.forceRefresh !== true) {
      try {
        stored = await this.#repository.getVersionedBusSegmentGeometries(
          first.cityCode,
          first.routeId,
          BUS_GEOMETRY_ALGORITHM_VERSION,
        );
      } catch {
        stored = [];
      }
    }
    const available = new Map<string, VersionedBusSegmentGeometry>();
    for (const item of expected) {
      const row = stored.find(
        (candidate) =>
          candidate.fromNodeOrder === item.from.nodeOrder &&
          candidate.toNodeOrder === item.to.nodeOrder &&
          candidate.geometryVersion === BUS_GEOMETRY_ALGORITHM_VERSION &&
          candidate.sourceHash === item.hash &&
          !candidate.outAndBack,
      );
      if (row === undefined) continue;
      const validated = validateRoadSection(
        row.coordinates,
        stopCoordinate(item.from),
        stopCoordinate(item.to),
      );
      if (validated.coordinates === null) continue;
      available.set(item.key, {
        ...row,
        coordinates: validated.coordinates,
        distanceMeters: validated.distanceMeters,
      });
    }
    const stale = expected.filter(
      (item) => available.get(item.key)?.cacheState === "STALE",
    );
    const missing = expected.filter((item) => !available.has(item.key));
    const cacheState: RouteGeometryObservation["cacheState"] =
      input.forceRefresh === true || missing.length > 0
        ? "MISS"
        : stale.length > 0 ? "STALE" : "FRESH";
    const requestedMissing = missing.slice(0, MAX_BUS_GEOMETRY_PAIR_REQUESTS);
    const continuationMissing = missing.slice(
      MAX_BUS_GEOMETRY_PAIR_REQUESTS,
      MAX_BUS_GEOMETRY_PAIR_REQUESTS * 2,
    );
    const requestLimitReached =
      missing.length > requestedMissing.length + continuationMissing.length;
    let failureReason: RouteGeometryReason = requestLimitReached
      ? "PAIR_REQUEST_LIMIT"
      : "NONE";
    let queueWaitMilliseconds = 0;
    let queueStartedCount = 0;
    let queueAbortedBeforeStartCount = 0;
    if (missing.length > 0) {
      const fetches: Array<{
        expectedCount: number;
        pending: Promise<BusGeometryFetchResult>;
      }> = [{
        expectedCount: requestedMissing.length,
        pending: this.#fetchAndStorePairSections(
          requestedMissing,
          input.signal,
          input.forceRefresh === true,
        ),
      }];
      if (continuationMissing.length > 0) {
        const continuation = this.#fetchPairSectionContinuation(
          continuationMissing,
          input.forceRefresh === true,
        );
        fetches.push({
          expectedCount: continuationMissing.length,
          pending: waitForSharedFill(continuation, input.signal),
        });
      }
      const settled = await Promise.allSettled(
        fetches.map((fetch) => fetch.pending),
      );
      settled.forEach((result, index) => {
        if (result.status === "rejected") {
          if (failureReason === "NONE") {
            failureReason = classifyGeometryError(result.reason);
          }
          return;
        }
        const fetched = result.value;
        fetched.geometries.forEach((value, key) => available.set(key, value));
        queueWaitMilliseconds = Math.max(
          queueWaitMilliseconds,
          fetched.queueWaitMilliseconds,
        );
        queueStartedCount += fetched.queueStartedCount;
        queueAbortedBeforeStartCount +=
          fetched.queueAbortedBeforeStartCount;
        if (failureReason === "NONE") {
          failureReason = fetched.failureReason;
          if (
            fetched.geometries.size < fetches[index]!.expectedCount &&
            failureReason === "NONE"
          ) {
            failureReason = "SECTION_MISMATCH";
          }
        }
      });
      if (
        available.size < expected.length &&
        failureReason === "NONE"
      ) {
        failureReason = "SECTION_MISMATCH";
      }
    } else if (stale.length > 0) {
      void this.#fetchAndStorePairSections(
        stale.slice(0, MAX_BUS_GEOMETRY_PAIR_REQUESTS),
        undefined,
        true,
      )
        .catch(() => undefined);
    }

    const sections = expected.map(
      (item) => available.get(item.key)?.coordinates,
    );
    const joined = joinBusRoadSections(input.stops, sections);
    const successful = sections.filter(
      (section) => section !== undefined,
    ).length;
    const failed = expected.length - successful;
    const quality: RouteGeometryQuality =
      failed === 0 &&
        joined.coordinates.length >= 2 &&
        !joined.continuityGap &&
        !joined.outAndBack
        ? "DETAILED"
        : "APPROXIMATE";
    const reason: RouteGeometryReason = quality === "DETAILED"
      ? "NONE"
      : joined.outAndBack
        ? "EXCESS_DETOUR"
        : joined.continuityGap
          ? "CONTINUITY_GAP"
          : failureReason === "NONE"
            ? "EMPTY_PATH"
            : failureReason;
    const metrics = expected.flatMap((item) => {
      const geometry = available.get(item.key);
      return geometry === undefined
        ? []
        : [{
            startSnapDistanceMeters: geometry.startSnapDistanceMeters,
            endSnapDistanceMeters: geometry.endSnapDistanceMeters,
            detourRatio: geometry.detourRatio,
          }];
    });
    const snapAndDetour = metrics.length === 0
      ? {}
      : {
          startSnapDistanceMeters: Math.max(
            ...metrics.map((metric) => metric.startSnapDistanceMeters),
          ),
          endSnapDistanceMeters: Math.max(
            ...metrics.map((metric) => metric.endSnapDistanceMeters),
          ),
          detourRatio: Math.max(
            ...metrics.map((metric) => metric.detourRatio),
          ),
        };
    const sectionOutAndBackDetected = expected.some(
      (item) => available.get(item.key)?.outAndBack === true,
    );
    input.observe?.({
      mode: "BUS",
      outcome: quality,
      reason,
      source: quality === "DETAILED" ? "KAKAO_ROAD" : "FALLBACK",
      cacheState,
      durationMilliseconds: performance.now() - startedAt,
      inputVertexCount: input.stops.length,
      outputVertexCount: joined.coordinates.length,
      successfulSectionCount: successful,
      failedSectionCount: failed,
      routeId: first.routeId,
      fromNodeOrder: first.nodeOrder,
      toNodeOrder: last.nodeOrder,
      geometryVersion: BUS_GEOMETRY_ALGORITHM_VERSION,
      ...snapAndDetour,
      outAndBack:
        sectionOutAndBackDetected ||
        joined.outAndBack ||
        joined.removedOutAndBack,
      queueWaitMilliseconds,
      queueStartedCount,
      queueAbortedBeforeStartCount,
    });
    return { coordinates: joined.coordinates, quality, reason };
  }

  public resolveBusGeometry(input: {
    stops: BusRouteStop[];
    signal?: AbortSignal;
    observe?: (observation: RouteGeometryObservation) => void;
    forceRefresh?: boolean;
  }): Promise<ResolvedBusGeometry> {
    return this.#algorithmVersion === BUS_GEOMETRY_ALGORITHM_VERSION
      ? this.#resolvePairBusGeometry(input)
      : this.#resolveLegacyBusGeometry(input);
  }
}
