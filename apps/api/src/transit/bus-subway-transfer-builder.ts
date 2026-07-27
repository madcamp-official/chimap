import {
  haversineDistanceMeters,
  type Coordinate,
  type NormalizedRoute,
} from "@chimap/contracts";

import type { MobilityProvider } from "../providers/types.js";
import type { TransitRepository } from "./transit-repository.js";

export type TransferBuildResult = {
  runId: string;
  candidateCount: number;
  processed: number;
  saved: number;
  skipped: number;
  failed: number;
};

function uniqueCoordinates(coordinates: Coordinate[]): Coordinate[] {
  const result: Coordinate[] = [];
  for (const coordinate of coordinates) {
    const previous = result.at(-1);
    if (
      previous === undefined ||
      previous.lat !== coordinate.lat ||
      previous.lng !== coordinate.lng
    ) {
      result.push(coordinate);
    }
  }
  return result;
}

export async function buildBusSubwayTransferEdges(options: {
  repository: TransitRepository;
  walkingProvider: Pick<MobilityProvider, "getWalkingRoute">;
  concurrency?: number;
  limit?: number;
}): Promise<TransferBuildResult> {
  const candidates = await options.repository.getBusSubwayTransferBuildCandidates(
    options.limit ?? 20_000,
  );
  const runId = `transfer-${new Date().toISOString().replace(/[^0-9]/gu, "")}`;
  await options.repository.beginBusSubwayTransferBuild(runId, candidates.length);
  let nextIndex = 0;
  let processed = 0;
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  const workerCount = Math.min(
    Math.max(1, options.concurrency ?? 2),
    4,
    Math.max(1, candidates.length),
  );
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < candidates.length) {
        const candidate = candidates[nextIndex];
        nextIndex += 1;
        if (candidate === undefined) {
          continue;
        }
        if (!candidate.needsRefresh) {
          skipped += 1;
          processed += 1;
          continue;
        }
        try {
          let route: NormalizedRoute | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              route = await options.walkingProvider.getWalkingRoute({
                origin: candidate.busCoordinate,
                destination: candidate.subwayCoordinate,
                routeMode: "SHORTEST",
              });
              break;
            } catch (error) {
              if (attempt === 1) {
                throw error;
              }
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
          if (route === undefined) {
            throw new Error("보행 경로를 받지 못했습니다.");
          }
          const coordinates = uniqueCoordinates(
            route.legs.flatMap((leg) => leg.coordinates),
          );
          const distanceMeters = Math.round(route.distanceMeters);
          const durationSeconds = Math.round(route.durationSeconds);
          const endpointsArePlausible =
            coordinates.length >= 2 &&
            haversineDistanceMeters(
              coordinates[0]!,
              candidate.busCoordinate,
            ) <= 100 &&
            haversineDistanceMeters(
              coordinates.at(-1)!,
              candidate.subwayCoordinate,
            ) <= 100;
          if (
            !endpointsArePlausible ||
            distanceMeters < 0 ||
            distanceMeters > 500 ||
            durationSeconds < 1
          ) {
            skipped += 1;
          } else {
            await options.repository.saveBusSubwayTransferEdge({
              runId,
              candidate,
              walkDistanceMeters: distanceMeters,
              walkDurationSeconds: durationSeconds,
              coordinates,
            });
            saved += 1;
          }
        } catch {
          failed += 1;
        } finally {
          processed += 1;
        }
      }
    }),
  );
  const result = {
    runId,
    candidateCount: candidates.length,
    processed,
    saved,
    skipped,
    failed,
  };
  await options.repository.finishBusSubwayTransferBuild(result);
  return result;
}
