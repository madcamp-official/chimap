import type { ParkRouteSnapshot } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  calculateParkRouteDatasetChecksum,
  ParkRouteImportService,
} from "./park-route-import-service.js";
import type { ParkRouteRepository } from "./park-route-repository.js";

function snapshot(): ParkRouteSnapshot {
  const route = {
    routeId: "park-route:1",
    officialParkId: "1",
    parkName: "공원",
    routeType: "THROUGH" as const,
    directionPolicy: "FORWARD_ONLY" as const,
    entry: { waypointId: "A", location: { lng: 127.3, lat: 36.3 } },
    exit: { waypointId: "B", location: { lng: 127.31, lat: 36.31 } },
    waypoints: [
      { id: "A", kind: "ENTRANCE" as const, location: { lng: 127.3, lat: 36.3 } },
      { id: "B", kind: "ENTRANCE" as const, location: { lng: 127.31, lat: 36.31 } },
    ],
    pathWaypointIds: ["A", "B"],
    excludedWaypointIds: [],
    coordinates: [
      { lng: 127.3, lat: 36.3 },
      { lng: 127.31, lat: 36.31 },
    ],
    distanceMeters: 100,
    durationSeconds: 80,
    routing: { engine: "VALHALLA" as const, costing: "pedestrian" as const },
    review: {
      completed: true as const,
      outcome: "APPROVED_FOR_PRODUCTION" as const,
      reviewer: "검수자",
      reviewedAt: "2026-07-29T13:30:00+09:00",
    },
    sourceHash: "a".repeat(64),
  };
  const withoutChecksum = {
    schemaVersion: "park-route-snapshot-v1" as const,
    datasetId: "dataset-1",
    generatedAt: "2026-07-29T14:00:00+09:00",
    regionCode: "KR-30" as const,
    mode: "FULL_SNAPSHOT" as const,
    source: {
      system: "chimap-park-etl" as const,
      reviewSchemaVersion: "v2.4",
    },
    routes: [route],
  };
  return {
    ...withoutChecksum,
    datasetChecksum: calculateParkRouteDatasetChecksum(withoutChecksum),
  };
}

describe("ParkRouteImportService", () => {
  it("비활성 상태와 누락·오류 token을 거절하고 constant-time 경계를 사용한다", () => {
    const repository = {} as ParkRouteRepository;
    expect(() =>
      new ParkRouteImportService(
        { importEnabled: false, integrationEnabled: false, searchRadiusMeters: 800, maxCandidates: 3 },
        repository,
      ).authenticate(undefined),
    ).toThrow(/비활성/u);
    const service = new ParkRouteImportService(
      {
        importEnabled: true,
        importToken: "p".repeat(32),
        integrationEnabled: false,
        searchRadiusMeters: 800,
        maxCandidates: 3,
      },
      repository,
    );
    expect(() => service.authenticate(undefined)).toThrow(/token/u);
    expect(() => service.authenticate("x".repeat(32))).toThrow(/token/u);
    expect(() => service.authenticate("p".repeat(32))).not.toThrow();
  });

  it("Idempotency-Key와 checksum을 검증한 뒤 repository로 전달한다", async () => {
    const importSnapshot = vi.fn().mockResolvedValue({ status: "UNCHANGED" });
    const service = new ParkRouteImportService(
      {
        importEnabled: true,
        importToken: "p".repeat(32),
        integrationEnabled: false,
        searchRadiusMeters: 800,
        maxCandidates: 3,
      },
      { importSnapshot } as unknown as ParkRouteRepository,
    );
    await expect(
      service.import({ body: snapshot(), idempotencyKey: "wrong" }),
    ).rejects.toMatchObject({ status: 400 });
    const valid = snapshot();
    await expect(
      service.import({ body: valid, idempotencyKey: valid.datasetId }),
    ).resolves.toMatchObject({ result: { status: "UNCHANGED" } });
    expect(importSnapshot).toHaveBeenCalledOnce();
  });
});
