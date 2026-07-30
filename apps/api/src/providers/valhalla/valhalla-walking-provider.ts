import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type Coordinate,
} from "@chimap/contracts";

import { ProviderError } from "../../errors.js";
import type { WalkingRouteProvider, WalkRouteRequest } from "../types.js";
import { ValhallaClient } from "./valhalla-client.js";

const MAX_REPORTED_DISTANCE_MISMATCH_RATIO = 3;

function pathDistance(points: readonly Coordinate[]): number {
  let distanceMeters = 0;
  for (let index = 1; index < points.length; index += 1) {
    distanceMeters += haversineDistanceMeters(
      points[index - 1]!,
      points[index]!,
    );
  }
  return distanceMeters;
}

function requestedPath(request: WalkRouteRequest): Coordinate[] {
  return [request.origin, ...(request.vias ?? []), request.destination];
}

export class ValhallaWalkingProvider implements WalkingRouteProvider {
  public readonly source = "VALHALLA" as const;

  public constructor(
    private readonly client: ValhallaClient,
    private readonly limits: {
      maxSnapDistanceMeters: number;
      maxDetourRatio: number;
    },
  ) {
    if (
      !Number.isFinite(limits.maxSnapDistanceMeters) ||
      limits.maxSnapDistanceMeters <= 0 ||
      !Number.isFinite(limits.maxDetourRatio) ||
      limits.maxDetourRatio < 1
    ) {
      throw new ProviderError({
        kind: "CONFIGURATION",
        message: "Valhalla 도보 경로 검증 설정이 올바르지 않습니다.",
      });
    }
  }

  public async getWalkingRoute(request: WalkRouteRequest) {
    const result = await this.client.route(request);
    const requested = requestedPath(request);
    if (result.legCoordinates.length !== requested.length - 1) {
      throw new ProviderError({
        kind: "UPSTREAM",
        message: "Valhalla 도보 경로 구간 수가 올바르지 않습니다.",
      });
    }

    if (
      result.legCoordinates.some(
        (leg, index) => {
          const start = leg[0];
          const end = leg.at(-1);
          return (
            start === undefined ||
            end === undefined ||
            haversineDistanceMeters(requested[index]!, start) >
              this.limits.maxSnapDistanceMeters ||
            haversineDistanceMeters(requested[index + 1]!, end) >
              this.limits.maxSnapDistanceMeters
          );
        },
      )
    ) {
      throw new ProviderError({
        kind: "NO_ROUTE",
        message: "Valhalla 도보 경로의 지점 연결 오차가 큽니다.",
      });
    }

    const referenceDistanceMeters = Math.max(1, pathDistance(requested));
    const geometryDistanceMeters = pathDistance(result.coordinates);
    if (
      geometryDistanceMeters <= 0 ||
      geometryDistanceMeters / referenceDistanceMeters >
        this.limits.maxDetourRatio
    ) {
      throw new ProviderError({
        kind: "NO_ROUTE",
        message: "Valhalla 도보 경로의 우회율이 허용 범위를 벗어났습니다.",
      });
    }
    const reportedDistanceMismatchRatio =
      Math.max(result.distanceMeters, geometryDistanceMeters) /
      Math.max(1, Math.min(result.distanceMeters, geometryDistanceMeters));
    if (
      !Number.isFinite(reportedDistanceMismatchRatio) ||
      reportedDistanceMismatchRatio > MAX_REPORTED_DISTANCE_MISMATCH_RATIO
    ) {
      throw new ProviderError({
        kind: "UPSTREAM",
        message:
          "Valhalla 도보 경로의 보고 거리와 geometry 거리가 일치하지 않습니다.",
        retryable: true,
      });
    }

    try {
      return normalizedRouteSchema.parse({
        id: `valhalla-walk-${crypto.randomUUID()}`,
        source: "VALHALLA",
        durationSeconds: result.durationSeconds,
        distanceMeters: result.distanceMeters,
        walkDistanceMeters: result.distanceMeters,
        transitDistanceMeters: 0,
        transferCount: 0,
        legs: [{
          id: `valhalla-walk-leg-${crypto.randomUUID()}`,
          mode: "WALK",
          guidance: "도보 이동",
          distanceMeters: result.distanceMeters,
          durationSeconds: result.durationSeconds,
          coordinates: result.coordinates,
          geometryQuality: "DETAILED",
          isExerciseSegment: false,
        }],
      });
    } catch (error) {
      throw new ProviderError({
        kind: "UPSTREAM",
        message: "Valhalla 도보 경로를 정규화하지 못했습니다.",
        cause: safeNormalizationCause(error),
      });
    }
  }
}

function safeNormalizationCause(error: unknown): { errorName: string } {
  return {
    errorName: error instanceof Error ? error.name : "UnknownError",
  };
}
