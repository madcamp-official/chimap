import {
  haversineDistanceMeters,
  normalizedRouteSchema,
  type Coordinate,
} from "@chimap/contracts";
import { ProviderError } from "../../errors.js";
import type { WalkingRouteProvider, WalkRouteRequest } from "../types.js";
import { ValhallaClient } from "./valhalla-client.js";

function pathDistance(points: readonly Coordinate[]): number {
  return points.slice(1).reduce(
    (sum, point, index) => sum + haversineDistanceMeters(points[index]!, point),
    0,
  );
}

export class ValhallaWalkingProvider implements WalkingRouteProvider {
  public readonly source = "VALHALLA" as const;
  public constructor(
    private readonly client: ValhallaClient,
    private readonly limits: { maxSnapDistanceMeters: number; maxDetourRatio: number },
  ) {}

  public async getWalkingRoute(request: WalkRouteRequest) {
    const result = await this.client.route(request);
    if (
      haversineDistanceMeters(request.origin, result.coordinates[0]!) >
        this.limits.maxSnapDistanceMeters ||
      haversineDistanceMeters(request.destination, result.coordinates.at(-1)!) >
        this.limits.maxSnapDistanceMeters
    ) {
      throw new ProviderError({ kind: "NO_ROUTE", message: "Valhalla endpoint snap 오차가 큽니다." });
    }
    const straight = Math.max(1, haversineDistanceMeters(request.origin, request.destination));
    if (pathDistance(result.coordinates) / straight > this.limits.maxDetourRatio) {
      throw new ProviderError({ kind: "NO_ROUTE", message: "Valhalla 경로 우회율이 너무 큽니다." });
    }
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
  }
}
