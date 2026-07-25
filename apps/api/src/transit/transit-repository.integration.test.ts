import { readFileSync } from "node:fs";

import type { BusRoute, BusRouteStop } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { parseBusStopsCsvBuffer } from "./csv-importer.js";
import { TransitRepository } from "./transit-repository.js";

const databaseUrl = process.env.DATABASE_TEST_URL;
const source = readFileSync(
  new URL(
    "../../test-data/bus-stops-public-sample-20251031.csv",
    import.meta.url,
  ),
);
const actualRoute: BusRoute = {
  id: "25:DJB30300043",
  cityCode: "25",
  routeId: "DJB30300043",
  routeNo: "108",
  routeName: "108",
  routeType: "간선버스",
  startStopName: "낭월공영차고지기점",
  endStopName: "충대농대종점",
  firstBusTime: null,
  lastBusTime: null,
  weekdayIntervalMinutes: null,
  weekendIntervalMinutes: null,
  source: "tago",
};
const actualRouteStops: BusRouteStop[] = [
  {
    routeId: "DJB30300043",
    stopId: "25:DJB8003109",
    nodeId: "DJB8003109",
    cityCode: "25",
    stopName: "낭월공영차고지기점",
    latitude: 36.26705,
    longitude: 127.47933,
    nodeOrder: 1,
    direction: "0",
  },
  {
    routeId: "DJB30300043",
    stopId: "25:DJB9005538",
    nodeId: "DJB9005538",
    cityCode: "25",
    stopName: "낭월공영차고지",
    latitude: 36.268803,
    longitude: 127.47771,
    nodeOrder: 2,
    direction: "0",
  },
];

describe.skipIf(databaseUrl === undefined)(
  "PostgreSQL/PostGIS 실제 정류장 통합",
  () => {
    it("migration 반복 적용, COPY upsert, 거리 정렬을 검증한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        await repository.migrate();
        const rows = parseBusStopsCsvBuffer(source).rows;
        await repository.upsertCsvStops(rows);
        await repository.upsertCsvStops(rows);

        const nearby = await repository.findNearbyStops(
          36.458658,
          128.891228,
          500,
        );
        expect(nearby[0]).toMatchObject({
          sourceStopNo: "ADB354000001",
          name: "길안정류장",
        });
        expect(nearby[0]?.distanceMeters).toBeLessThanOrEqual(1);
        expect(
          nearby.every(
            (item, index) =>
              index === 0 ||
              (nearby[index - 1]?.distanceMeters ?? 0) <=
                (item.distanceMeters ?? 0),
          ),
        ).toBe(true);
      } finally {
        await repository.close();
      }
    });

    it("실제 공개 정류장과 실제 TAGO 정류장을 30m 안에서 연결한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        await repository.upsertCsvStops(
          parseBusStopsCsvBuffer(source).rows,
        );
        const result = await repository.reconcileTagoStop({
          id: "25:DJB8007526",
          cityCode: "25",
          nodeId: "DJB8007526",
          sourceStopNo: null,
          arsId: "45110",
          name: "한국과학기술원본관",
          latitude: 36.369938,
          longitude: 127.36063,
          source: "tago",
        });
        expect(result.status).toBe("matched");
        expect(result.stop).toMatchObject({
          cityCode: "25",
          nodeId: "DJB8007526",
          sourceStopNo: "DJB8007526",
          name: "한국과학기술원본관",
        });

        const nearby = await repository.findNearbyStops(
          36.369938,
          127.36063,
          30,
        );
        expect(
          nearby.some(
            (stop) =>
              stop.cityCode === "25" &&
              stop.nodeId === "DJB8007526",
          ),
        ).toBe(true);
      } finally {
        await repository.close();
      }
    });

    it("적용된 migration checksum 변경을 거절한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      let originalChecksum: string | undefined;
      try {
        await repository.migrate();
        const applied = await repository.pool.query<{ checksum: string }>(
          "SELECT checksum FROM schema_migrations WHERE version = 1",
        );
        originalChecksum = applied.rows[0]?.checksum;
        expect(originalChecksum).toMatch(/^[a-f0-9]{64}$/u);
        await repository.pool.query(
          "UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = 1",
        );
        await expect(repository.migrate()).rejects.toThrow(/checksum/u);
      } finally {
        if (originalChecksum !== undefined) {
          await repository.pool.query(
            "UPDATE schema_migrations SET checksum = $1 WHERE version = 1",
            [originalChecksum],
          );
        }
        await repository.close();
      }
    });

    it("실제 노선 정류장 교체 실패 시 이전 transaction을 보존한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        await repository.replaceRouteStops(actualRoute, [
          actualRouteStops[0]!,
        ]);
        await repository.pool.query(
          `ALTER TABLE bus_route_stops
           ADD CONSTRAINT actual_route_failure_guard
           CHECK (direction <> '0') NOT VALID`,
        );
        await expect(
          repository.replaceRouteStops(actualRoute, actualRouteStops),
        ).rejects.toThrow();
        const preserved = await repository.getRouteStops(
          actualRoute.cityCode,
          actualRoute.routeId,
        );
        expect(preserved.map((stop) => stop.nodeId)).toEqual([
          "DJB8003109",
        ]);
      } finally {
        await repository.pool
          .query(
            `ALTER TABLE bus_route_stops
             DROP CONSTRAINT IF EXISTS actual_route_failure_guard`,
          )
          .catch(() => undefined);
        await repository.close();
      }
    });
  },
);
