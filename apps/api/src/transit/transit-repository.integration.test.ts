import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { BusRoute, BusRouteStop } from "@chimap/contracts";
import { describe, expect, it } from "vitest";

import { parseBusStopsCsvBuffer } from "./csv-importer.js";
import { parseSubwayStationsCsvBuffer } from "./subway-csv-importer.js";
import { parseSubwaySegmentShapesDirectory } from "./subway-segment-shape-importer.js";
import { parseSubwayTopologyDirectory } from "./subway-topology-importer.js";
import { TransitRepository } from "./transit-repository.js";

const databaseUrl = process.env.DATABASE_TEST_URL;
const source = readFileSync(
  new URL(
    "../../test-data/bus-stops-public-sample-20251031.csv",
    import.meta.url,
  ),
);
const subwaySource = readFileSync(
  new URL("../../../../data/subway_data.csv", import.meta.url),
);
const subwayDataDirectory = fileURLToPath(
  new URL("../../../../data/", import.meta.url),
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

    it("migration 13 v3 형상은 legacy v2와 함께 저장·조회한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        await repository.replaceRouteStops(actualRoute, actualRouteStops);
        const sourceHash = "a".repeat(64);
        await repository.upsertBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
          [{
            fromNodeOrder: 1,
            toNodeOrder: 2,
            coordinates: [
              { lat: 36.26705, lng: 127.47933 },
              { lat: 36.2679, lng: 127.4785 },
              { lat: 36.268803, lng: 127.47771 },
            ],
            distanceMeters: 240,
            geometrySource: "KAKAO_ROAD",
            geometryVersion: "transit-v2",
            sourceHash,
            freshUntil: new Date(Date.now() + 60_000),
            expiresAt: new Date(Date.now() + 120_000),
          }],
        );

        const stored = await repository.getBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
        );
        expect(stored[0]).toMatchObject({
          fromNodeOrder: 1,
          toNodeOrder: 2,
          geometrySource: "KAKAO_ROAD",
          sourceHash,
          cacheState: "FRESH",
        });
        expect(stored[0]?.coordinates.length).toBeGreaterThanOrEqual(2);

        const versionedSourceHash = "c".repeat(64);
        await repository.upsertVersionedBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
          [{
            fromNodeOrder: 1,
            toNodeOrder: 2,
            coordinates: [
              { lat: 36.26708, lng: 127.47931 },
              { lat: 36.26788, lng: 127.47852 },
              { lat: 36.26878, lng: 127.47773 },
            ],
            distanceMeters: 235,
            geometrySource: "KAKAO_ROAD",
            geometryVersion: "kakao-road-pair-v3",
            sourceHash: versionedSourceHash,
            startSnapDistanceMeters: 4.2,
            endSnapDistanceMeters: 3.8,
            detourRatio: 1.08,
            outAndBack: false,
            freshUntil: new Date(Date.now() + 60_000),
            expiresAt: new Date(Date.now() + 120_000),
          }],
        );
        const versioned = await repository.getVersionedBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
          "kakao-road-pair-v3",
        );
        expect(versioned[0]).toMatchObject({
          fromNodeOrder: 1,
          toNodeOrder: 2,
          geometryVersion: "kakao-road-pair-v3",
          sourceHash: versionedSourceHash,
          startSnapDistanceMeters: 4.2,
          endSnapDistanceMeters: 3.8,
          detourRatio: 1.08,
          outAndBack: false,
          cacheState: "FRESH",
        });
        expect(versioned[0]?.coordinates.length).toBeGreaterThanOrEqual(2);

        await repository.removeMismatchedBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
          ["b".repeat(64)],
        );
        await expect(repository.getBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
        )).resolves.toEqual([]);
        await expect(repository.getVersionedBusSegmentGeometries(
          actualRoute.cityCode,
          actualRoute.routeId,
          "kakao-road-pair-v3",
        )).resolves.toHaveLength(1);
      } finally {
        await repository.close();
      }
    });

    it("노선 연결 정류장만 DB에서 거리순으로 조회한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        await repository.replaceRouteStops(actualRoute, actualRouteStops);

        const nearby = await repository.findNearbyRoutableStops(
          actualRouteStops[0]!.latitude,
          actualRouteStops[0]!.longitude,
          300,
        );

        expect(nearby.some(
          (stop) => stop.nodeId === actualRouteStops[0]!.nodeId,
        )).toBe(true);
        expect(nearby.every(
          (stop, index) =>
            index === 0 ||
            (nearby[index - 1]?.distanceMeters ?? 0) <=
              (stop.distanceMeters ?? 0),
        )).toBe(true);
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

    it("정류장번호가 같은 기존 TAGO row와 노선 관계를 CSV row로 병합한다", async () => {
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
        const csv = await repository.pool.query<{ id: string }>(
          `UPDATE bus_stops
           SET city_code = NULL, node_id = NULL
           WHERE source_stop_no = 'DJB8007526'
           RETURNING id`,
        );
        const csvId = csv.rows[0]?.id;
        expect(csvId).toBeDefined();
        const tago = await repository.pool.query<{ id: string }>(
          `INSERT INTO bus_stops (
             city_code, node_id, ars_id, name, location, source,
             source_updated_at, created_at, updated_at
           ) VALUES (
             '25', 'DJB8007526', '45110', '한국과학기술원본관',
             ST_SetSRID(ST_MakePoint(127.36063, 36.369938), 4326)::geography,
             'tago', now(), now(), now()
           )
           RETURNING id`,
        );
        const tagoId = tago.rows[0]?.id;
        expect(tagoId).toBeDefined();
        await repository.upsertRoute(actualRoute);
        await repository.pool.query(
          `INSERT INTO bus_route_stops (
             route_internal_id, stop_internal_id, node_order, direction,
             created_at, updated_at
           )
           SELECT id, $1, 99, 'migration-check', now(), now()
           FROM bus_routes
           WHERE city_code = $2 AND route_id = $3`,
          [tagoId, actualRoute.cityCode, actualRoute.routeId],
        );
        await repository.pool.query(
          "DELETE FROM schema_migrations WHERE version = 2",
        );

        await repository.migrate();

        const merged = await repository.pool.query<{
          id: string;
          city_code: string;
          node_id: string;
        }>(
          `SELECT id, city_code, node_id
           FROM bus_stops
           WHERE source_stop_no = 'DJB8007526'`,
        );
        expect(merged.rows).toEqual([
          {
            id: csvId,
            city_code: "25",
            node_id: "DJB8007526",
          },
        ]);
        const removed = await repository.pool.query(
          "SELECT id FROM bus_stops WHERE id = $1",
          [tagoId],
        );
        expect(removed.rowCount).toBe(0);
        const relation = await repository.pool.query<{
          stop_internal_id: string;
        }>(
          `SELECT stop_internal_id
           FROM bus_route_stops
           WHERE node_order = 99`,
        );
        expect(relation.rows[0]?.stop_internal_id).toBe(csvId);
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

    it("status는 알 수 없는 상위 migration을 허용하고 알려진 checksum 불일치는 거절한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      const unknownVersion = 9_000_000_001;
      let originalChecksum: string | undefined;
      try {
        await repository.migrate();
        const applied = await repository.pool.query<{ checksum: string }>(
          "SELECT checksum FROM schema_migrations WHERE version = 1",
        );
        originalChecksum = applied.rows[0]?.checksum;
        expect(originalChecksum).toBeDefined();
        await repository.pool.query(
          `INSERT INTO schema_migrations(version, name, checksum)
           VALUES ($1, 'future_additive_test', repeat('f', 64))
           ON CONFLICT(version) DO UPDATE SET
             name = EXCLUDED.name,
             checksum = EXCLUDED.checksum`,
          [unknownVersion],
        );

        await expect(repository.status()).resolves.toMatchObject({
          connected: true,
          postgis: true,
          migrationsCurrent: true,
        });

        await repository.pool.query(
          "UPDATE schema_migrations SET checksum = repeat('0', 64) WHERE version = 1",
        );
        await expect(repository.status()).resolves.toMatchObject({
          connected: true,
          postgis: true,
          migrationsCurrent: false,
        });
      } finally {
        if (originalChecksum !== undefined) {
          await repository.pool.query(
            "UPDATE schema_migrations SET checksum = $1 WHERE version = 1",
            [originalChecksum],
          );
        }
        await repository.pool.query(
          "DELETE FROM schema_migrations WHERE version = $1",
          [unknownVersion],
        );
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

    it("지하철 CSV 재import는 멱등이고 누락 역의 TAGO 매핑을 보존해 비활성화한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        const parsed = parseSubwayStationsCsvBuffer(subwaySource);
        expect(parsed).toMatchObject({
          sourceRowCount: 1099,
          duplicateRows: 2,
        });
        await repository.importSubwayStations(parsed.rows);
        await repository.importSubwayStations(parsed.rows);
        expect(await repository.stats()).toMatchObject({
          subwayStations: 1097,
          activeSubwayStations: 1097,
        });

        const first = (
          await repository.searchSubwayStations(parsed.rows[0]!.name, 100)
        ).find(
          (station) =>
            station.stationCode === parsed.rows[0]!.stationCode &&
            station.lineCode === parsed.rows[0]!.lineCode &&
            station.lineName === parsed.rows[0]!.lineName &&
            station.operatorName === parsed.rows[0]!.operatorName,
        );
        expect(first).toBeDefined();
        await repository.updateSubwayStationMapping({
          id: first!.id,
          status: "MAPPED",
          tagoStationId: "TEST_TAGO_STATION",
          tagoRouteName: "TEST_ROUTE",
        });
        await repository.importSubwayStations(parsed.rows.slice(1));

        const inactive = await repository.pool.query<{
          active: boolean;
          tago_station_id: string;
          mapping_status: string;
        }>(
          `SELECT active, tago_station_id, mapping_status
           FROM subway_station_lines WHERE id = $1`,
          [first!.id],
        );
        expect(inactive.rows[0]).toEqual({
          active: false,
          tago_station_id: "TEST_TAGO_STATION",
          mapping_status: "MAPPED",
        });

        await repository.importSubwayStations(parsed.rows);
        expect(await repository.stats()).toMatchObject({
          subwayStations: 1097,
          activeSubwayStations: 1097,
        });
      } finally {
        await repository.close();
      }
    });

    it("전국 2,314개 선로를 PostGIS에 적재하고 routing graph로 반환한다", async () => {
      const repository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      try {
        await repository.migrate();
        const [topology, shapes] = await Promise.all([
          parseSubwayTopologyDirectory(subwayDataDirectory),
          parseSubwaySegmentShapesDirectory(subwayDataDirectory),
        ]);
        await repository.importSubwayStations(
          parseSubwayStationsCsvBuffer(subwaySource).rows,
        );
        await repository.importSubwayTopology(topology);
        await repository.importSubwaySegmentShapes(shapes);
        await repository.importSubwaySegmentShapes(shapes);

        expect(await repository.stats()).toMatchObject({
          routeReadySubwaySegments: 2314,
          subwayTrackGeometrySegments: 2314,
        });
        const coverage = await repository.subwayTrackGeometryCoverage();
        expect(coverage).toHaveLength(30);
        expect(
          coverage.every(
            ({ segmentCount, geometryCount }) =>
              segmentCount === geometryCount,
          ),
        ).toBe(true);

        const graph = await repository.getSubwayRoutingGraph(
          "WEEKDAY",
          "DAYTIME",
        );
        const reference = graph.edges.find(
          (edge) =>
            edge.fromNodeId === "SL_035A73FB3875:S3001|112" &&
            edge.toNodeId === "SL_035A73FB3875:S3001|111",
        );
        expect(reference).toMatchObject({
          kind: "RIDE",
          distanceMeters: 839,
          geometrySource: "OpenStreetMap relation 7792527",
        });
        expect(reference?.trackCoordinates?.length).toBeGreaterThan(2);
        expect(reference?.trackDistanceMeters).toBeGreaterThan(839);

        const stored = await repository.pool.query<{
          srid: number;
          points: number;
          distance: number;
        }>(
          `SELECT
             ST_SRID(track_geometry) AS srid,
             ST_NPoints(track_geometry) AS points,
             track_distance_meters AS distance
           FROM subway_segments
           WHERE service_line_id = 'SL_035A73FB3875'
             AND from_source_station_key = 'S3001|112'
             AND to_source_station_key = 'S3001|111'`,
        );
        expect(stored.rows[0]).toMatchObject({ srid: 4326 });
        expect(stored.rows[0]?.points).toBeGreaterThan(2);
        expect(stored.rows[0]?.distance).toBe(reference?.trackDistanceMeters);
      } finally {
        await repository.close();
      }
    }, 120_000);
  },
);
