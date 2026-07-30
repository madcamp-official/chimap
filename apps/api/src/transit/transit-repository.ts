import {
  type Coordinate,
  type BusRoute,
  type BusRouteStop,
  type BusStop,
  type SubwayStation,
  type SubwayStationMappingStatus,
} from "@chimap/contracts";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";
import pg, {
  type PoolClient,
  type QueryResultRow,
} from "pg";
import { from as copyFrom } from "pg-copy-streams";

import type { AppConfig } from "../config.js";
import { APP_MIGRATIONS } from "../migrations.js";

const { Pool } = pg;

type Queryable = Pick<pg.Pool, "query"> | Pick<PoolClient, "query">;
type SqlRow = QueryResultRow & Record<string, unknown>;

export type CsvBusStop = {
  sourceStopNo: string;
  name: string;
  latitude: number;
  longitude: number;
  regionName: string | null;
};

export type StopReconciliationResult =
  | { status: "existing" | "matched" | "inserted"; stop: BusStop }
  | { status: "ambiguous"; stop: BusStop; candidateIds: string[] };

export type TransitStats = {
  stops: number;
  linkedStops: number;
  routes: number;
  routeStops: number;
  subwayStations: number;
  activeSubwayStations: number;
  mappedSubwayStations: number;
  subwayServiceLines?: number;
  routeReadySubwayLines?: number;
  providerMappedStations?: number;
  busSubwayTransferEdges?: number;
  routeReadySubwaySegments?: number;
  subwayTrackGeometrySegments?: number;
};

export type SubwaySegmentShape = {
  serviceLineId: string;
  fromSourceStationKey: string;
  toSourceStationKey: string;
  coordinates: Coordinate[];
  geometrySource: string;
  geometryLicense: string;
  geometryVersion: string;
  geometryUpdatedAt: string;
};

export type SubwaySegmentShapeDataset = {
  checksum: string;
  rows: SubwaySegmentShape[];
};

export type SubwayTrackGeometryCoverage = {
  serviceLineId: string;
  segmentCount: number;
  geometryCount: number;
};

export type BusSegmentGeometry = {
  fromNodeOrder: number;
  toNodeOrder: number;
  coordinates: Coordinate[];
  distanceMeters: number;
  geometrySource: string;
  geometryVersion: string;
  sourceHash: string;
  cacheState: "FRESH" | "STALE";
};

export type BusSegmentGeometryWrite = Omit<
  BusSegmentGeometry,
  "cacheState"
> & {
  freshUntil: Date;
  expiresAt: Date;
};

/**
 * Additive, algorithm-versioned bus geometry cache introduced by migration 13.
 * The legacy BusSegmentGeometry types remain bound to bus_segment_geometries so
 * older binaries can continue to read and write transit-v2 during rollback.
 */
export type VersionedBusSegmentGeometry = BusSegmentGeometry & {
  startSnapDistanceMeters: number;
  endSnapDistanceMeters: number;
  detourRatio: number;
  outAndBack: boolean;
};

export type VersionedBusSegmentGeometryWrite = Omit<
  VersionedBusSegmentGeometry,
  "cacheState"
> & {
  freshUntil: Date;
  expiresAt: Date;
};

export type CsvSubwayStation = {
  stationCode: string;
  name: string;
  lineCode: string;
  lineName: string;
  englishName: string | null;
  hanjaName: string | null;
  transferType: string | null;
  transferLineCode: string | null;
  transferLineName: string | null;
  latitude: number;
  longitude: number;
  operatorName: string;
  roadAddress: string | null;
  phoneNumber: string | null;
  dataDate: string;
};

export type CsvSubwayTopology = {
  serviceLines: Array<{
    serviceLineId: string;
    regionCode: string;
    regionName: string;
    operatorName: string;
    serviceLineName: string;
    stationCount: number;
    matchedStationCount: number;
    segmentCount: number;
    fallbackHeadwayCount: number;
    isBranching: boolean;
    isRouteReady: boolean;
    timingProviderDefault: string;
  }>;
  lineStations: Array<{
    serviceLineId: string;
    stationOrder: number;
    orderConflict: boolean;
    sourceLineId: string;
    sourceStationId: string;
    sourceStationKey: string;
    stationName: string;
  }>;
  segments: Array<{
    serviceLineId: string;
    fromSourceStationKey: string;
    toSourceStationKey: string;
    durationSeconds: number;
    averageDurationSeconds: number;
    straightDistanceMeters: number;
    sampleCount: number;
    durationMethod: string;
  }>;
  headways: Array<{
    serviceLineId: string;
    sourceStationKey: string;
    nextSourceStationKey: string;
    dayGroup: string;
    timePeriod: string;
    medianHeadwaySeconds: number;
    expectedWaitSeconds: number;
    departureCount: number;
    intervalSampleCount: number;
  }>;
  transfers: Array<{
    fromSourceStationKey: string;
    toSourceStationKey: string;
    transferDurationSeconds: number;
    straightDistanceMeters: number;
    durationIsEstimated: boolean;
  }>;
};

export type CsvSubwayProviderMapping = {
  sourceStationKey: string;
  stationName: string;
  lineName: string;
  regionCode: string;
  preferredProvider: "SEOUL_REALTIME" | "TAGO_TIMETABLE";
  tagoStationId: string | null;
  seoulSubwayId: string | null;
  seoulStationId: string | null;
  mappingStatus: string;
};

export type SubwayRoutingStation = {
  nodeId: string;
  stationLineId: string;
  serviceLineId: string;
  sourceStationKey: string;
  stationOrder: number;
  stationName: string;
  lineName: string;
  regionName: string;
  operatorName: string;
  latitude: number;
  longitude: number;
};

export type SubwayRoutingEdge = {
  fromNodeId: string;
  toNodeId: string;
  kind: "RIDE" | "TRANSFER";
  durationSeconds: number;
  distanceMeters: number;
  expectedWaitSeconds: number;
  serviceLineId: string | null;
  durationIsEstimated: boolean;
  trackCoordinates: Coordinate[] | null;
  trackDistanceMeters: number | null;
  geometrySource: string | null;
};

export type SubwayRoutingGraph = {
  stations: SubwayRoutingStation[];
  edges: SubwayRoutingEdge[];
};

export type BusSubwayTransferLink = {
  busStopId: string;
  subwayNodeId: string;
  serviceLineId: string;
  stationLineId: string;
  sourceStationKey: string;
  stationName: string;
  lineName: string;
  busCoordinate: { lat: number; lng: number };
  subwayCoordinate: { lat: number; lng: number };
  walkDistanceMeters: number;
  walkDurationSeconds: number;
  coordinates: Array<{ lat: number; lng: number }>;
  tagoVerified: boolean;
};

export type BusSubwayTransferCandidate = {
  busStopId: string;
  stationLineId: string;
  busName: string;
  stationName: string;
  busCoordinate: { lat: number; lng: number };
  subwayCoordinate: { lat: number; lng: number };
  straightDistanceMeters: number;
  sourceHash: string;
  needsRefresh: boolean;
};

export type SubwayTimingContext = {
  stationLineId: string;
  stationName: string;
  lineName: string;
  roadAddress: string | null;
  fromStationOrder: number;
  toStationOrder: number;
  mappings: Array<{
    provider: "TAGO" | "SEOUL";
    queryStationName: string;
    externalStationId: string | null;
    externalLineId: string | null;
    externalLineName: string | null;
    mappingStatus: string;
  }>;
  directionMappings: Array<{
    provider: "TAGO" | "SEOUL";
    externalDirectionCode: string | null;
    destinationName: string | null;
    mappingStatus: string;
  }>;
};

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function nameSimilarity(first: string, second: string): number {
  const a = normalizeName(first);
  const b = normalizeName(second);
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.9;
  }
  if (a.length < 2 || b.length < 2) {
    return 0;
  }
  const firstPairs = new Set(
    Array.from({ length: a.length - 1 }, (_, index) =>
      a.slice(index, index + 2),
    ),
  );
  const secondPairs = new Set(
    Array.from({ length: b.length - 1 }, (_, index) =>
      b.slice(index, index + 2),
    ),
  );
  const intersection = [...firstPairs].filter((pair) =>
    secondPairs.has(pair),
  ).length;
  return (2 * intersection) / (firstPairs.size + secondPairs.size);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function lineStringCoordinates(
  value: unknown,
  context: string,
): Coordinate[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
    throw new TypeError(`${context}: LineString geometry가 아닙니다.`);
  }
  const coordinates = geometry.coordinates.map((point, index): Coordinate => {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== "number" ||
      !Number.isFinite(point[0]) ||
      typeof point[1] !== "number" ||
      !Number.isFinite(point[1])
    ) {
      throw new TypeError(`${context}: ${index + 1}번째 좌표가 잘못됐습니다.`);
    }
    return { lng: point[0], lat: point[1] };
  });
  if (coordinates.length < 2) {
    throw new TypeError(`${context}: 좌표가 두 개보다 적습니다.`);
  }
  return coordinates;
}

function rowToStop(row: SqlRow): BusStop {
  return {
    id: String(row.id),
    cityCode: nullableString(row.city_code),
    nodeId: nullableString(row.node_id),
    sourceStopNo: nullableString(row.source_stop_no),
    arsId: nullableString(row.ars_id),
    name: String(row.name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    ...(row.distance_meters === undefined
      ? {}
      : { distanceMeters: Math.round(Number(row.distance_meters)) }),
    source: String(row.source) === "csv" ? "csv" : "tago",
  };
}

function rowToRoute(row: SqlRow): BusRoute {
  return {
    id: `${String(row.city_code)}:${String(row.route_id)}`,
    cityCode: String(row.city_code),
    routeId: String(row.route_id),
    routeNo: String(row.route_no),
    routeName: String(row.route_name),
    routeType: nullableString(row.route_type),
    startStopName: nullableString(row.start_stop_name),
    endStopName: nullableString(row.end_stop_name),
    firstBusTime: nullableString(row.first_bus_time),
    lastBusTime: nullableString(row.last_bus_time),
    weekdayIntervalMinutes:
      row.weekday_interval_minutes === null ||
      row.weekday_interval_minutes === undefined
        ? null
        : Number(row.weekday_interval_minutes),
    weekendIntervalMinutes:
      row.weekend_interval_minutes === null ||
      row.weekend_interval_minutes === undefined
        ? null
        : Number(row.weekend_interval_minutes),
    source: "database",
  };
}

function rowToSubwayStation(row: SqlRow): SubwayStation {
  return {
    id: String(row.id),
    stationCode: String(row.station_code),
    name: String(row.station_name),
    lineCode: String(row.line_code),
    lineName: String(row.line_name),
    englishName: nullableString(row.english_name),
    hanjaName: nullableString(row.hanja_name),
    transferType: nullableString(row.transfer_type),
    transferLineCode: nullableString(row.transfer_line_code),
    transferLineName: nullableString(row.transfer_line_name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    operatorName: String(row.operator_name),
    roadAddress: nullableString(row.road_address),
    phoneNumber: nullableString(row.phone_number),
    dataDate: String(row.data_date),
    tagoStationId: nullableString(row.tago_station_id),
    tagoRouteName: nullableString(row.tago_route_name),
    mappingStatus: String(row.mapping_status) as SubwayStationMappingStatus,
    active: row.active === true,
    ...(row.distance_meters === undefined
      ? {}
      : { distanceMeters: Math.round(Number(row.distance_meters)) }),
  };
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function sourceIdentity(stop: CsvBusStop): string {
  return createHash("sha256")
    .update(
      [
        stop.sourceStopNo,
        stop.name,
        stop.latitude.toFixed(7),
        stop.longitude.toFixed(7),
      ].join("\u001f"),
    )
    .digest("hex");
}

function csvField(value: string | null): string {
  if (value === null) {
    return "";
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function postgresErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

function retryDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stopSelect(prefix = ""): string {
  return `
    ${prefix}id,
    ${prefix}city_code,
    ${prefix}node_id,
    ${prefix}source_stop_no,
    ${prefix}ars_id,
    ${prefix}name,
    ${prefix}source,
    ST_Y(${prefix}location::geometry) AS latitude,
    ST_X(${prefix}location::geometry) AS longitude
  `;
}

function subwayStationSelect(prefix = ""): string {
  return `
    ${prefix}id,
    ${prefix}station_code,
    ${prefix}station_name,
    ${prefix}line_code,
    ${prefix}line_name,
    ${prefix}english_name,
    ${prefix}hanja_name,
    ${prefix}transfer_type,
    ${prefix}transfer_line_code,
    ${prefix}transfer_line_name,
    ${prefix}operator_name,
    ${prefix}road_address,
    ${prefix}phone_number,
    ${prefix}data_date,
    ${prefix}tago_station_id,
    ${prefix}tago_route_name,
    ${prefix}mapping_status,
    ${prefix}active,
    ST_Y(${prefix}location::geometry) AS latitude,
    ST_X(${prefix}location::geometry) AS longitude
  `;
}

export class TransitRepository {
  public readonly pool: pg.Pool;

  public constructor(
    database: AppConfig["database"],
    pool?: pg.Pool,
  ) {
    this.pool =
      pool ??
      new Pool({
        connectionString: database.url,
        max: database.poolMax,
        connectionTimeoutMillis: database.connectTimeoutMs,
        statement_timeout: database.statementTimeoutMs,
        application_name: "chimap-api",
        ...(database.sslMode === "disable"
          ? {}
          : {
              ssl: {
                rejectUnauthorized: database.sslMode === "verify-full",
              },
            }),
      });
  }

  public async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext('chimap:transit:migrations'))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version bigint PRIMARY KEY,
          name text NOT NULL,
          checksum text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      for (const migration of APP_MIGRATIONS) {
        const checksum = migrationChecksum(migration.sql);
        const existing = await client.query<{
          checksum: string;
        }>(
          "SELECT checksum FROM schema_migrations WHERE version = $1",
          [migration.version],
        );
        if (existing.rowCount === 1) {
          if (existing.rows[0]?.checksum !== checksum) {
            throw new Error(
              `migration ${migration.version} checksum이 일치하지 않습니다.`,
            );
          }
          continue;
        }
        await client.query("BEGIN");
        try {
          await client.query(migration.sql);
          await client.query(
            `INSERT INTO schema_migrations(version, name, checksum)
             VALUES ($1, $2, $3)`,
            [migration.version, migration.name, checksum],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await client
        .query(
          "SELECT pg_advisory_unlock(hashtext('chimap:transit:migrations'))",
        )
        .catch(() => undefined);
      client.release();
    }
  }

  public async status(): Promise<{
    connected: boolean;
    postgis: boolean;
    migrationsCurrent: boolean;
  }> {
    try {
      const [postgis, migrations] = await Promise.all([
        this.pool.query<{ installed: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM pg_extension WHERE extname = 'postgis'
           ) AS installed`,
        ),
        this.pool.query<{ version: string; checksum: string }>(
          `SELECT version::text, checksum
           FROM schema_migrations
           WHERE version = ANY($1::bigint[])`,
          [APP_MIGRATIONS.map((migration) => migration.version)],
        ),
      ]);
      const appliedChecksums = new Map(
        migrations.rows.map((migration) => [
          Number(migration.version),
          migration.checksum,
        ]),
      );
      return {
        connected: true,
        postgis: postgis.rows[0]?.installed === true,
        migrationsCurrent: APP_MIGRATIONS.every(
          (migration) =>
            appliedChecksums.get(migration.version) ===
            migrationChecksum(migration.sql),
        ),
      };
    } catch {
      return {
        connected: false,
        postgis: false,
        migrationsCurrent: false,
      };
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  public async findNearbyStops(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    queryable: Queryable = this.pool,
  ): Promise<BusStop[]> {
    const result = await queryable.query(
      `SELECT
         ${stopSelect()}
         , ST_Distance(
             location,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
           ) AS distance_meters
       FROM bus_stops
       WHERE ST_DWithin(
         location,
         ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
         $3
       )
       ORDER BY distance_meters
       LIMIT 100`,
      [latitude, longitude, radiusMeters],
    );
    return result.rows.map((row) => rowToStop(row as SqlRow));
  }

  public async findNearbyRoutableStops(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    queryable: Queryable = this.pool,
  ): Promise<BusStop[]> {
    const result = await queryable.query(
      `SELECT
         ${stopSelect("stop.")}
         , ST_Distance(
             stop.location,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
           ) AS distance_meters
       FROM bus_stops AS stop
       WHERE ST_DWithin(
         stop.location,
         ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
         $3
       )
         AND EXISTS (
           SELECT 1
           FROM bus_route_stops AS relation
           JOIN bus_routes AS route
             ON route.id = relation.route_internal_id
           WHERE relation.stop_internal_id = stop.id
         )
       ORDER BY distance_meters
       LIMIT 100`,
      [latitude, longitude, radiusMeters],
    );
    return result.rows.map((row) => rowToStop(row as SqlRow));
  }

  public async upsertCsvStops(stops: CsvBusStop[]): Promise<number> {
    if (stops.length === 0) {
      return 0;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query(`
        CREATE TEMP TABLE bus_stops_import (
          source_identity text NOT NULL,
          source_stop_no varchar(100) NOT NULL,
          region_name varchar(200),
          name varchar(200) NOT NULL,
          latitude double precision NOT NULL,
          longitude double precision NOT NULL
        ) ON COMMIT DROP
      `);
      const stream = client.query(
        copyFrom(
          `COPY bus_stops_import(
             source_identity, source_stop_no, region_name, name,
             latitude, longitude
           ) FROM STDIN WITH (FORMAT csv)`,
        ),
      );
      const input = Readable.from(
        stops.map((stop) =>
          [
            csvField(sourceIdentity(stop)),
            csvField(stop.sourceStopNo),
            csvField(stop.regionName),
            csvField(stop.name),
            stop.latitude,
            stop.longitude,
          ].join(",") + "\n",
        ),
      );
      input.pipe(stream);
      await finished(stream);
      await client.query(`
        INSERT INTO bus_stops (
          source_stop_no, region_name, name, location, source,
          source_identity, source_updated_at, created_at, updated_at
        )
        SELECT
          source_stop_no,
          region_name,
          name,
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
          'csv',
          source_identity,
          now(),
          now(),
          now()
        FROM bus_stops_import
        ON CONFLICT (source_identity)
          WHERE source_identity IS NOT NULL
        DO UPDATE SET
          region_name = EXCLUDED.region_name,
          name = EXCLUDED.name,
          location = EXCLUDED.location,
          source_updated_at = now(),
          updated_at = now()
      `);
      await client.query("COMMIT");
      return stops.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async reconcileTagoStop(
    tagoStop: BusStop,
    queryable: Queryable = this.pool,
  ): Promise<StopReconciliationResult> {
    if (tagoStop.cityCode === null || tagoStop.nodeId === null) {
      throw new Error("TAGO 정류장에는 cityCode와 nodeId가 필요합니다.");
    }
    const exact = await queryable.query(
      `SELECT ${stopSelect()}
       FROM bus_stops
       WHERE city_code = $1 AND node_id = $2`,
      [tagoStop.cityCode, tagoStop.nodeId],
    );
    if (exact.rowCount === 1) {
      const result = await queryable.query(
        `UPDATE bus_stops
         SET ars_id = COALESCE($3, ars_id),
             name = $4,
             location = ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
             source_updated_at = now(),
             updated_at = now()
         WHERE city_code = $1 AND node_id = $2
         RETURNING ${stopSelect()}`,
        [
          tagoStop.cityCode,
          tagoStop.nodeId,
          tagoStop.arsId,
          tagoStop.name,
          tagoStop.latitude,
          tagoStop.longitude,
        ],
      );
      return {
        status: "existing",
        stop: rowToStop(result.rows[0] as SqlRow),
      };
    }

    const exactSourceNumber = await queryable.query(
      `SELECT ${stopSelect()}
       FROM bus_stops
       WHERE node_id IS NULL AND source_stop_no = $1`,
      [tagoStop.nodeId],
    );
    if (exactSourceNumber.rowCount === 1) {
      const sourceStop = exactSourceNumber.rows[0] as SqlRow;
      const result = await queryable.query(
        `UPDATE bus_stops
         SET city_code = $1,
             node_id = $2,
             ars_id = COALESCE($3, ars_id),
             name = $4,
             location = ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
             source_updated_at = now(),
             updated_at = now()
         WHERE id = $7
         RETURNING ${stopSelect()}`,
        [
          tagoStop.cityCode,
          tagoStop.nodeId,
          tagoStop.arsId,
          tagoStop.name,
          tagoStop.latitude,
          tagoStop.longitude,
          sourceStop.id,
        ],
      );
      return {
        status: "matched",
        stop: rowToStop(result.rows[0] as SqlRow),
      };
    }

    const candidates = (
      await this.findNearbyStops(
        tagoStop.latitude,
        tagoStop.longitude,
        30,
        queryable,
      )
    )
      .filter((candidate) => candidate.nodeId === null)
      .map((candidate) => ({
        candidate,
        similarity: nameSimilarity(candidate.name, tagoStop.name),
      }))
      .filter(({ similarity }) => similarity >= 0.82)
      .sort(
        (first, second) =>
          second.similarity - first.similarity ||
          (first.candidate.distanceMeters ?? 0) -
            (second.candidate.distanceMeters ?? 0),
      );
    const best = candidates[0];
    const second = candidates[1];
    if (
      best !== undefined &&
      (second === undefined || best.similarity - second.similarity >= 0.1)
    ) {
      const result = await queryable.query(
        `UPDATE bus_stops
         SET city_code = $1,
             node_id = $2,
             ars_id = COALESCE($3, ars_id),
             name = $4,
             location = ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
             source_updated_at = now(),
             updated_at = now()
         WHERE id = $7
         RETURNING ${stopSelect()}`,
        [
          tagoStop.cityCode,
          tagoStop.nodeId,
          tagoStop.arsId,
          tagoStop.name,
          tagoStop.latitude,
          tagoStop.longitude,
          best.candidate.id,
        ],
      );
      return {
        status: "matched",
        stop: rowToStop(result.rows[0] as SqlRow),
      };
    }
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        stop: tagoStop,
        candidateIds: candidates.map(({ candidate }) => candidate.id),
      };
    }
    return {
      status: "inserted",
      stop: await this.#insertTagoStop(tagoStop, queryable),
    };
  }

  async #insertTagoStop(
    stop: BusStop,
    queryable: Queryable,
  ): Promise<BusStop> {
    const result = await queryable.query(
      `INSERT INTO bus_stops (
         city_code, node_id, ars_id, name, location, source,
         source_updated_at, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4,
         ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography,
         'tago', now(), now(), now()
       )
       ON CONFLICT (city_code, node_id)
         WHERE city_code IS NOT NULL AND node_id IS NOT NULL
       DO UPDATE SET
         ars_id = COALESCE(EXCLUDED.ars_id, bus_stops.ars_id),
         name = EXCLUDED.name,
         location = EXCLUDED.location,
         source_updated_at = now(),
         updated_at = now()
       RETURNING ${stopSelect()}`,
      [
        stop.cityCode,
        stop.nodeId,
        stop.arsId,
        stop.name,
        stop.latitude,
        stop.longitude,
      ],
    );
    return rowToStop(result.rows[0] as SqlRow);
  }

  public async upsertRoute(
    route: BusRoute,
    queryable: Queryable = this.pool,
  ): Promise<BusRoute> {
    const result = await queryable.query(
      `INSERT INTO bus_routes (
         city_code, route_id, route_no, route_name, route_type,
         start_stop_name, end_stop_name, first_bus_time, last_bus_time,
         weekday_interval_minutes, weekend_interval_minutes,
         source_updated_at, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),now(),now()
       )
       ON CONFLICT (city_code, route_id) DO UPDATE SET
         route_no = EXCLUDED.route_no,
         route_name = EXCLUDED.route_name,
         route_type = EXCLUDED.route_type,
         start_stop_name = EXCLUDED.start_stop_name,
         end_stop_name = EXCLUDED.end_stop_name,
         first_bus_time = EXCLUDED.first_bus_time,
         last_bus_time = EXCLUDED.last_bus_time,
         weekday_interval_minutes = EXCLUDED.weekday_interval_minutes,
         weekend_interval_minutes = EXCLUDED.weekend_interval_minutes,
         source_updated_at = now(),
         updated_at = now()
       RETURNING *`,
      [
        route.cityCode,
        route.routeId,
        route.routeNo,
        route.routeName,
        route.routeType,
        route.startStopName,
        route.endStopName,
        route.firstBusTime,
        route.lastBusTime,
        route.weekdayIntervalMinutes,
        route.weekendIntervalMinutes,
      ],
    );
    return rowToRoute(result.rows[0] as SqlRow);
  }

  public async getRoute(
    cityCode: string,
    routeId: string,
  ): Promise<BusRoute | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM bus_routes WHERE city_code = $1 AND route_id = $2",
      [cityCode, routeId],
    );
    return result.rowCount === 0
      ? undefined
      : rowToRoute(result.rows[0] as SqlRow);
  }

  public async getRoutesByStop(
    cityCode: string,
    nodeId: string,
  ): Promise<BusRoute[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT route.*
       FROM bus_routes AS route
       JOIN bus_route_stops AS relation
         ON relation.route_internal_id = route.id
       JOIN bus_stops AS stop
         ON stop.id = relation.stop_internal_id
       WHERE stop.city_code = $1 AND stop.node_id = $2
       ORDER BY route.route_no`,
      [cityCode, nodeId],
    );
    return result.rows.map((row) => rowToRoute(row as SqlRow));
  }

  public async replaceRouteStops(
    route: BusRoute,
    stops: BusRouteStop[],
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.#replaceRouteStopsOnce(route, stops);
        return;
      } catch (error) {
        if (postgresErrorCode(error) !== "40P01" || attempt === 2) {
          throw error;
        }
        await retryDelay(75 * (attempt + 1));
      }
    }
  }

  async #replaceRouteStopsOnce(
    route: BusRoute,
    stops: BusRouteStop[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const storedRoute = await this.upsertRoute(route, client);
      const routeRow = await client.query<{ id: string }>(
        "SELECT id FROM bus_routes WHERE city_code = $1 AND route_id = $2",
        [storedRoute.cityCode, storedRoute.routeId],
      );
      const routeInternalId = routeRow.rows[0]?.id;
      if (routeInternalId === undefined) {
        throw new Error("저장된 TAGO 노선을 찾지 못했습니다.");
      }
      await client.query(
        "DELETE FROM bus_route_stops WHERE route_internal_id = $1",
        [routeInternalId],
      );
      for (const stop of stops) {
        const storedStop = await this.reconcileTagoStop(
          {
            id: stop.stopId,
            cityCode: stop.cityCode,
            nodeId: stop.nodeId,
            sourceStopNo: null,
            arsId: null,
            name: stop.stopName,
            latitude: stop.latitude,
            longitude: stop.longitude,
            source: "tago",
          },
          client,
        );
        const resolvedStop =
          storedStop.status === "ambiguous"
            ? await this.#insertTagoStop(storedStop.stop, client)
            : storedStop.stop;
        await client.query(
          `INSERT INTO bus_route_stops (
             route_internal_id, stop_internal_id, node_order, direction,
             created_at, updated_at
           ) VALUES ($1,$2,$3,$4,now(),now())`,
          [
            routeInternalId,
            resolvedStop.id,
            stop.nodeOrder,
            stop.direction,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getRouteStops(
    cityCode: string,
    routeId: string,
  ): Promise<BusRouteStop[]> {
    const result = await this.pool.query(
      `SELECT
         route.route_id,
         stop.id AS stop_id,
         stop.node_id,
         stop.name,
         ST_Y(stop.location::geometry) AS latitude,
         ST_X(stop.location::geometry) AS longitude,
         relation.node_order,
         relation.direction
       FROM bus_routes AS route
       JOIN bus_route_stops AS relation
         ON relation.route_internal_id = route.id
       JOIN bus_stops AS stop
         ON stop.id = relation.stop_internal_id
       WHERE route.city_code = $1 AND route.route_id = $2
         AND stop.node_id IS NOT NULL
       ORDER BY relation.node_order`,
      [cityCode, routeId],
    );
    return result.rows.map((row) => ({
      routeId: String(row.route_id),
      stopId: String(row.stop_id),
      nodeId: String(row.node_id),
      cityCode,
      stopName: String(row.name),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      nodeOrder: Number(row.node_order),
      direction: nullableString(row.direction),
    }));
  }

  public async getBusSegmentGeometries(
    cityCode: string,
    routeId: string,
  ): Promise<BusSegmentGeometry[]> {
    const result = await this.pool.query(
      `SELECT
         geometry.from_node_order,
         geometry.to_node_order,
         ST_AsGeoJSON(
           ST_Transform(
             ST_SimplifyPreserveTopology(
               ST_Transform(geometry.road_geometry, 5179),
               2
             ),
             4326
           )
         ) AS road_geojson,
         geometry.distance_meters,
         geometry.geometry_source,
         geometry.geometry_version,
         geometry.source_hash,
         CASE WHEN geometry.fresh_until > now()
           THEN 'FRESH' ELSE 'STALE' END AS cache_state
       FROM bus_segment_geometries AS geometry
       JOIN bus_routes AS route ON route.id = geometry.route_internal_id
       WHERE route.city_code = $1 AND route.route_id = $2
         AND geometry.expires_at > now()
       ORDER BY geometry.from_node_order, geometry.to_node_order`,
      [cityCode, routeId],
    );
    return result.rows.flatMap((row): BusSegmentGeometry[] => {
      const parsed = JSON.parse(String(row.road_geojson)) as {
        type?: unknown;
        coordinates?: unknown;
      };
      if (parsed.type !== "LineString" || !Array.isArray(parsed.coordinates)) {
        return [];
      }
      const coordinates = parsed.coordinates.flatMap((coordinate) =>
        Array.isArray(coordinate) &&
        typeof coordinate[0] === "number" &&
        typeof coordinate[1] === "number"
          ? [{ lng: coordinate[0], lat: coordinate[1] }]
          : [],
      );
      if (coordinates.length < 2) {
        return [];
      }
      return [{
        fromNodeOrder: Number(row.from_node_order),
        toNodeOrder: Number(row.to_node_order),
        coordinates,
        distanceMeters: Number(row.distance_meters),
        geometrySource: String(row.geometry_source),
        geometryVersion: String(row.geometry_version),
        sourceHash: String(row.source_hash),
        cacheState: row.cache_state === "FRESH" ? "FRESH" : "STALE",
      }];
    });
  }

  public async upsertBusSegmentGeometries(
    cityCode: string,
    routeId: string,
    rows: readonly BusSegmentGeometryWrite[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const routeResult = await client.query<{ id: string }>(
        "SELECT id FROM bus_routes WHERE city_code = $1 AND route_id = $2",
        [cityCode, routeId],
      );
      const routeInternalId = routeResult.rows[0]?.id;
      if (routeInternalId === undefined) {
        throw new Error("버스 형상을 저장할 노선을 찾지 못했습니다.");
      }
      for (const row of rows) {
        await client.query(
          `INSERT INTO bus_segment_geometries (
             route_internal_id, from_node_order, to_node_order,
             road_geometry, distance_meters, geometry_source,
             geometry_version, source_hash, fresh_until, expires_at,
             last_used_at, created_at, updated_at
           ) VALUES (
             $1,$2,$3,
             ST_SetSRID(ST_GeomFromGeoJSON($4),4326),$5,$6,$7,$8,$9,$10,
             now(),now(),now()
           )
           ON CONFLICT(route_internal_id, from_node_order, to_node_order)
           DO UPDATE SET
             road_geometry = EXCLUDED.road_geometry,
             distance_meters = EXCLUDED.distance_meters,
             geometry_source = EXCLUDED.geometry_source,
             geometry_version = EXCLUDED.geometry_version,
             source_hash = EXCLUDED.source_hash,
             fresh_until = EXCLUDED.fresh_until,
             expires_at = EXCLUDED.expires_at,
             last_used_at = now(),
             updated_at = now()`,
          [
            routeInternalId,
            row.fromNodeOrder,
            row.toNodeOrder,
            JSON.stringify({
              type: "LineString",
              coordinates: row.coordinates.map((point) => [point.lng, point.lat]),
            }),
            row.distanceMeters,
            row.geometrySource,
            row.geometryVersion,
            row.sourceHash,
            row.freshUntil,
            row.expiresAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async getVersionedBusSegmentGeometries(
    cityCode: string,
    routeId: string,
    geometryVersion: string,
  ): Promise<VersionedBusSegmentGeometry[]> {
    const result = await this.pool.query(
      `SELECT
         geometry.from_node_order,
         geometry.to_node_order,
         ST_AsGeoJSON(
           ST_Transform(
             ST_SimplifyPreserveTopology(
               ST_Transform(geometry.road_geometry, 5179),
               2
             ),
             4326
           )
         ) AS road_geojson,
         geometry.distance_meters,
         geometry.geometry_source,
         geometry.geometry_version,
         geometry.source_hash,
         geometry.start_snap_distance_meters,
         geometry.end_snap_distance_meters,
         geometry.detour_ratio,
         geometry.out_and_back,
         CASE WHEN geometry.fresh_until > now()
           THEN 'FRESH' ELSE 'STALE' END AS cache_state
       FROM bus_segment_geometry_versions AS geometry
       JOIN bus_routes AS route ON route.id = geometry.route_internal_id
       WHERE route.city_code = $1 AND route.route_id = $2
         AND geometry.geometry_version = $3
         AND geometry.expires_at > now()
       ORDER BY geometry.from_node_order, geometry.to_node_order`,
      [cityCode, routeId, geometryVersion],
    );
    return result.rows.flatMap((row): VersionedBusSegmentGeometry[] => {
      const parsed = JSON.parse(String(row.road_geojson)) as {
        type?: unknown;
        coordinates?: unknown;
      };
      if (parsed.type !== "LineString" || !Array.isArray(parsed.coordinates)) {
        return [];
      }
      const coordinates = parsed.coordinates.flatMap((coordinate) =>
        Array.isArray(coordinate) &&
        typeof coordinate[0] === "number" &&
        typeof coordinate[1] === "number"
          ? [{ lng: coordinate[0], lat: coordinate[1] }]
          : [],
      );
      if (coordinates.length < 2) {
        return [];
      }
      return [{
        fromNodeOrder: Number(row.from_node_order),
        toNodeOrder: Number(row.to_node_order),
        coordinates,
        distanceMeters: Number(row.distance_meters),
        geometrySource: String(row.geometry_source),
        geometryVersion: String(row.geometry_version),
        sourceHash: String(row.source_hash),
        startSnapDistanceMeters: Number(row.start_snap_distance_meters),
        endSnapDistanceMeters: Number(row.end_snap_distance_meters),
        detourRatio: Number(row.detour_ratio),
        outAndBack: row.out_and_back === true,
        cacheState: row.cache_state === "FRESH" ? "FRESH" : "STALE",
      }];
    });
  }

  public async upsertVersionedBusSegmentGeometries(
    cityCode: string,
    routeId: string,
    rows: readonly VersionedBusSegmentGeometryWrite[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const routeResult = await client.query<{ id: string }>(
        "SELECT id FROM bus_routes WHERE city_code = $1 AND route_id = $2",
        [cityCode, routeId],
      );
      const routeInternalId = routeResult.rows[0]?.id;
      if (routeInternalId === undefined) {
        throw new Error("버스 형상을 저장할 노선을 찾지 못했습니다.");
      }
      for (const row of rows) {
        await client.query(
          `INSERT INTO bus_segment_geometry_versions (
             route_internal_id, from_node_order, to_node_order,
             geometry_version, road_geometry, distance_meters,
             geometry_source, source_hash,
             start_snap_distance_meters, end_snap_distance_meters,
             detour_ratio, out_and_back, fresh_until, expires_at,
             last_used_at, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,
             ST_SetSRID(ST_GeomFromGeoJSON($5),4326),$6,$7,$8,
             $9,$10,$11,$12,$13,$14,
             now(),now(),now()
           )
           ON CONFLICT(
             route_internal_id,
             from_node_order,
             to_node_order,
             geometry_version
           )
           DO UPDATE SET
             road_geometry = EXCLUDED.road_geometry,
             distance_meters = EXCLUDED.distance_meters,
             geometry_source = EXCLUDED.geometry_source,
             source_hash = EXCLUDED.source_hash,
             start_snap_distance_meters = EXCLUDED.start_snap_distance_meters,
             end_snap_distance_meters = EXCLUDED.end_snap_distance_meters,
             detour_ratio = EXCLUDED.detour_ratio,
             out_and_back = EXCLUDED.out_and_back,
             fresh_until = EXCLUDED.fresh_until,
             expires_at = EXCLUDED.expires_at,
             last_used_at = now(),
             updated_at = now()`,
          [
            routeInternalId,
            row.fromNodeOrder,
            row.toNodeOrder,
            row.geometryVersion,
            JSON.stringify({
              type: "LineString",
              coordinates: row.coordinates.map((point) => [point.lng, point.lat]),
            }),
            row.distanceMeters,
            row.geometrySource,
            row.sourceHash,
            row.startSnapDistanceMeters,
            row.endSnapDistanceMeters,
            row.detourRatio,
            row.outAndBack,
            row.freshUntil,
            row.expiresAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async removeMismatchedBusSegmentGeometries(
    cityCode: string,
    routeId: string,
    sourceHashes: readonly string[],
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM bus_segment_geometries AS geometry
       USING bus_routes AS route
       WHERE geometry.route_internal_id = route.id
         AND route.city_code = $1 AND route.route_id = $2
         AND NOT (geometry.source_hash = ANY($3::text[]))`,
      [cityCode, routeId, sourceHashes],
    );
  }

  public async importSubwayStations(rows: CsvSubwayStation[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE subway_station_import (
          station_code varchar(50) NOT NULL,
          station_name varchar(200) NOT NULL,
          line_code varchar(50) NOT NULL,
          line_name varchar(200) NOT NULL,
          english_name varchar(200),
          hanja_name varchar(200),
          transfer_type varchar(100),
          transfer_line_code varchar(200),
          transfer_line_name varchar(500),
          latitude double precision NOT NULL,
          longitude double precision NOT NULL,
          operator_name varchar(200) NOT NULL,
          road_address varchar(500),
          phone_number varchar(100),
          data_date text NOT NULL
        ) ON COMMIT DROP
      `);
      for (const row of rows) {
        await client.query(
          `INSERT INTO subway_station_import(
             station_code, station_name, line_code, line_name,
             english_name, hanja_name, transfer_type, transfer_line_code,
             transfer_line_name, latitude, longitude, operator_name,
             road_address, phone_number, data_date
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
           )`,
          [
            row.stationCode,
            row.name,
            row.lineCode,
            row.lineName,
            row.englishName,
            row.hanjaName,
            row.transferType,
            row.transferLineCode,
            row.transferLineName,
            row.latitude,
            row.longitude,
            row.operatorName,
            row.roadAddress,
            row.phoneNumber,
            row.dataDate,
          ],
        );
      }
      await client.query("UPDATE subway_station_lines SET active = false, updated_at = now()");
      await client.query(`
        INSERT INTO subway_station_lines(
          station_code, station_name, line_code, line_name,
          english_name, hanja_name, transfer_type, transfer_line_code,
          transfer_line_name, location, operator_name, road_address,
          phone_number, data_date, active, created_at, updated_at
        )
        SELECT
          station_code, station_name, line_code, line_name,
          english_name, hanja_name, transfer_type, transfer_line_code,
          transfer_line_name,
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
          operator_name, road_address, phone_number, data_date,
          true, now(), now()
        FROM subway_station_import
        ON CONFLICT(station_code, line_code, line_name, operator_name)
        DO UPDATE SET
          station_name = EXCLUDED.station_name,
          english_name = EXCLUDED.english_name,
          hanja_name = EXCLUDED.hanja_name,
          transfer_type = EXCLUDED.transfer_type,
          transfer_line_code = EXCLUDED.transfer_line_code,
          transfer_line_name = EXCLUDED.transfer_line_name,
          location = EXCLUDED.location,
          road_address = EXCLUDED.road_address,
          phone_number = EXCLUDED.phone_number,
          data_date = EXCLUDED.data_date,
          active = true,
          updated_at = now()
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async importSubwayTopology(data: CsvSubwayTopology): Promise<void> {
    const client = await this.pool.connect();
    const copy = async (statement: string, rows: string[]) => {
      const stream = client.query(copyFrom(statement));
      Readable.from(rows).pipe(stream);
      await finished(stream);
    };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10min'");
      await client.query(`
        CREATE TEMP TABLE subway_service_lines_import
          AS SELECT * FROM subway_service_lines WITH NO DATA;
        CREATE TEMP TABLE subway_line_stations_import
          AS SELECT * FROM subway_line_stations WITH NO DATA;
        CREATE TEMP TABLE subway_segments_import
          AS SELECT * FROM subway_segments WITH NO DATA;
        CREATE TEMP TABLE subway_headways_fallback_import
          AS SELECT * FROM subway_headways_fallback WITH NO DATA;
        CREATE TEMP TABLE subway_transfer_edges_import
          AS SELECT * FROM subway_transfer_edges WITH NO DATA;
      `);
      await copy(
        `COPY subway_service_lines_import(
           service_line_id, region_code, region_name, operator_name,
           service_line_name, station_count, matched_station_count,
           segment_count, fallback_headway_count, is_branching,
           is_route_ready, timing_provider_default
         ) FROM STDIN WITH (FORMAT csv)`,
        data.serviceLines.map((row) =>
          [
            csvField(row.serviceLineId),
            csvField(row.regionCode),
            csvField(row.regionName),
            csvField(row.operatorName),
            csvField(row.serviceLineName),
            row.stationCount,
            row.matchedStationCount,
            row.segmentCount,
            row.fallbackHeadwayCount,
            row.isBranching,
            row.isRouteReady,
            csvField(row.timingProviderDefault),
          ].join(",") + "\n",
        ),
      );
      await copy(
        `COPY subway_line_stations_import(
           service_line_id, station_order, order_conflict, source_line_id,
           source_station_id, source_station_key, station_name
         ) FROM STDIN WITH (FORMAT csv)`,
        data.lineStations.map((row) =>
          [
            csvField(row.serviceLineId),
            row.stationOrder,
            row.orderConflict,
            csvField(row.sourceLineId),
            csvField(row.sourceStationId),
            csvField(row.sourceStationKey),
            csvField(row.stationName),
          ].join(",") + "\n",
        ),
      );
      await copy(
        `COPY subway_segments_import(
           service_line_id, from_source_station_key,
           to_source_station_key, duration_seconds,
           average_duration_seconds, straight_distance_meters,
           sample_count, duration_method
         ) FROM STDIN WITH (FORMAT csv)`,
        data.segments.map((row) =>
          [
            csvField(row.serviceLineId),
            csvField(row.fromSourceStationKey),
            csvField(row.toSourceStationKey),
            row.durationSeconds,
            row.averageDurationSeconds,
            row.straightDistanceMeters,
            row.sampleCount,
            csvField(row.durationMethod),
          ].join(",") + "\n",
        ),
      );
      await copy(
        `COPY subway_headways_fallback_import(
           service_line_id, source_station_key, next_source_station_key,
           day_group, time_period, median_headway_seconds,
           expected_wait_seconds, departure_count, interval_sample_count
         ) FROM STDIN WITH (FORMAT csv)`,
        data.headways.map((row) =>
          [
            csvField(row.serviceLineId),
            csvField(row.sourceStationKey),
            csvField(row.nextSourceStationKey),
            csvField(row.dayGroup),
            csvField(row.timePeriod),
            row.medianHeadwaySeconds,
            row.expectedWaitSeconds,
            row.departureCount,
            row.intervalSampleCount,
          ].join(",") + "\n",
        ),
      );
      await copy(
        `COPY subway_transfer_edges_import(
           from_source_station_key, to_source_station_key,
           transfer_duration_seconds, straight_distance_meters,
           duration_is_estimated
         ) FROM STDIN WITH (FORMAT csv)`,
        data.transfers.map((row) =>
          [
            csvField(row.fromSourceStationKey),
            csvField(row.toSourceStationKey),
            row.transferDurationSeconds,
            row.straightDistanceMeters,
            row.durationIsEstimated,
          ].join(",") + "\n",
        ),
      );
      await client.query(`
        UPDATE subway_service_lines
        SET active = false, updated_at = now();

        INSERT INTO subway_service_lines(
          service_line_id, region_code, region_name, operator_name,
          service_line_name, station_count, matched_station_count,
          segment_count, fallback_headway_count, is_branching,
          is_route_ready, timing_provider_default, active,
          imported_at, updated_at
        )
        SELECT
          service_line_id, region_code, region_name, operator_name,
          service_line_name, station_count, matched_station_count,
          segment_count, fallback_headway_count, is_branching,
          is_route_ready, timing_provider_default, true, now(), now()
        FROM subway_service_lines_import
        ON CONFLICT(service_line_id) DO UPDATE SET
          region_code = EXCLUDED.region_code,
          region_name = EXCLUDED.region_name,
          operator_name = EXCLUDED.operator_name,
          service_line_name = EXCLUDED.service_line_name,
          station_count = EXCLUDED.station_count,
          matched_station_count = EXCLUDED.matched_station_count,
          segment_count = EXCLUDED.segment_count,
          fallback_headway_count = EXCLUDED.fallback_headway_count,
          is_branching = EXCLUDED.is_branching,
          is_route_ready = EXCLUDED.is_route_ready,
          timing_provider_default = EXCLUDED.timing_provider_default,
          active = true,
          imported_at = now(),
          updated_at = now();

        CREATE TEMP TABLE resolved_subway_line_stations AS
        SELECT
          imported.*,
          (
            SELECT station.id
            FROM subway_station_lines AS station
            WHERE station.line_code = imported.source_line_id
              AND station.station_code = imported.source_station_id
              AND (
                (
                  SELECT COUNT(*)
                  FROM subway_station_lines AS only_station
                  WHERE only_station.line_code = imported.source_line_id
                    AND only_station.station_code = imported.source_station_id
                ) = 1
                OR regexp_replace(
                     lower(station.line_name),
                     '(도시철도|수도권|광역철도|서울교통공사|코레일|선|\\s)',
                     '', 'g'
                   ) = regexp_replace(
                     lower(service_line.service_line_name),
                     '(도시철도|수도권|광역철도|서울교통공사|코레일|선|\\s)',
                     '', 'g'
                   )
              )
            ORDER BY station.active DESC, station.data_date DESC, station.id
            LIMIT 1
          ) AS resolved_station_line_id
        FROM subway_line_stations_import AS imported
        JOIN subway_service_lines AS service_line
          ON service_line.service_line_id = imported.service_line_id;

        DO $$
        DECLARE unresolved_count bigint;
        BEGIN
          SELECT COUNT(*) INTO unresolved_count
          FROM resolved_subway_line_stations
          WHERE resolved_station_line_id IS NULL;
          IF unresolved_count > 0 THEN
            RAISE EXCEPTION
              'subway topology station mapping unresolved: %',
              unresolved_count;
          END IF;
        END $$;

        UPDATE subway_line_stations
        SET active = false, updated_at = now();
        INSERT INTO subway_line_stations(
          service_line_id, station_order, order_conflict,
          source_line_id, source_station_id, source_station_key,
          station_name, station_line_id, active, updated_at
        )
        SELECT
          service_line_id, station_order, order_conflict,
          source_line_id, source_station_id, source_station_key,
          station_name, resolved_station_line_id, true, now()
        FROM resolved_subway_line_stations
        ON CONFLICT(service_line_id, source_station_key) DO UPDATE SET
          station_order = EXCLUDED.station_order,
          order_conflict = EXCLUDED.order_conflict,
          source_line_id = EXCLUDED.source_line_id,
          source_station_id = EXCLUDED.source_station_id,
          station_name = EXCLUDED.station_name,
          station_line_id = EXCLUDED.station_line_id,
          active = true,
          updated_at = now();

        UPDATE subway_segments SET active = false, updated_at = now();
        INSERT INTO subway_segments(
          service_line_id, from_source_station_key,
          to_source_station_key, duration_seconds,
          average_duration_seconds, straight_distance_meters,
          sample_count, duration_method, active, updated_at
        )
        SELECT
          service_line_id, from_source_station_key,
          to_source_station_key, duration_seconds,
          average_duration_seconds, straight_distance_meters,
          sample_count, duration_method, true, now()
        FROM subway_segments_import
        ON CONFLICT(
          service_line_id, from_source_station_key, to_source_station_key
        ) DO UPDATE SET
          duration_seconds = EXCLUDED.duration_seconds,
          average_duration_seconds = EXCLUDED.average_duration_seconds,
          straight_distance_meters = EXCLUDED.straight_distance_meters,
          sample_count = EXCLUDED.sample_count,
          duration_method = EXCLUDED.duration_method,
          active = true,
          updated_at = now();

        UPDATE subway_headways_fallback SET active = false, updated_at = now();
        INSERT INTO subway_headways_fallback(
          service_line_id, source_station_key, next_source_station_key,
          day_group, time_period, median_headway_seconds,
          expected_wait_seconds, departure_count, interval_sample_count,
          active, updated_at
        )
        SELECT
          service_line_id, source_station_key, next_source_station_key,
          day_group, time_period, median_headway_seconds,
          expected_wait_seconds, departure_count, interval_sample_count,
          true, now()
        FROM subway_headways_fallback_import
        ON CONFLICT(
          service_line_id, source_station_key, next_source_station_key,
          day_group, time_period
        ) DO UPDATE SET
          median_headway_seconds = EXCLUDED.median_headway_seconds,
          expected_wait_seconds = EXCLUDED.expected_wait_seconds,
          departure_count = EXCLUDED.departure_count,
          interval_sample_count = EXCLUDED.interval_sample_count,
          active = true,
          updated_at = now();

        UPDATE subway_transfer_edges SET active = false, updated_at = now();
        INSERT INTO subway_transfer_edges(
          from_source_station_key, to_source_station_key,
          transfer_duration_seconds, straight_distance_meters,
          duration_is_estimated, active, updated_at
        )
        SELECT
          from_source_station_key, to_source_station_key,
          transfer_duration_seconds, straight_distance_meters,
          duration_is_estimated, true, now()
        FROM subway_transfer_edges_import
        ON CONFLICT(from_source_station_key, to_source_station_key)
        DO UPDATE SET
          transfer_duration_seconds = EXCLUDED.transfer_duration_seconds,
          straight_distance_meters = EXCLUDED.straight_distance_meters,
          duration_is_estimated = EXCLUDED.duration_is_estimated,
          active = true,
          updated_at = now();

        INSERT INTO subway_provider_direction_mappings(
          service_line_id, from_source_station_key,
          to_source_station_key, provider, external_direction_code,
          destination_name, mapping_status, mapping_checked_at, updated_at
        )
        SELECT
          segment.service_line_id,
          segment.from_source_station_key,
          segment.to_source_station_key,
          provider.provider,
          CASE
            WHEN provider.provider = 'TAGO' THEN
              CASE WHEN target.station_order > source.station_order
                THEN 'D' ELSE 'U' END
            ELSE
              CASE WHEN target.station_order > source.station_order
                THEN '하행' ELSE '상행' END
          END,
          NULL,
          'MAPPED',
          now(),
          now()
        FROM subway_segments_import AS segment
        JOIN subway_line_stations AS source
          ON source.service_line_id = segment.service_line_id
         AND source.source_station_key = segment.from_source_station_key
        JOIN subway_line_stations AS target
          ON target.service_line_id = segment.service_line_id
         AND target.source_station_key = segment.to_source_station_key
        CROSS JOIN (VALUES ('TAGO'), ('SEOUL')) AS provider(provider)
        ON CONFLICT(
          service_line_id, from_source_station_key,
          to_source_station_key, provider
        ) DO UPDATE SET
          external_direction_code = EXCLUDED.external_direction_code,
          mapping_status = 'MAPPED',
          mapping_checked_at = now(),
          updated_at = now()
      `);
      await client.query(`
        INSERT INTO transit_dataset_versions(
          dataset, generation, row_counts, imported_at, updated_at
        ) VALUES (
          'subway_topology', 1,
          jsonb_build_object(
            'serviceLines', (SELECT COUNT(*) FROM subway_service_lines_import),
            'lineStations', (SELECT COUNT(*) FROM subway_line_stations_import),
            'segments', (SELECT COUNT(*) FROM subway_segments_import),
            'headways', (SELECT COUNT(*) FROM subway_headways_fallback_import),
            'transfers', (SELECT COUNT(*) FROM subway_transfer_edges_import)
          ),
          now(), now()
        )
        ON CONFLICT(dataset) DO UPDATE SET
          generation = transit_dataset_versions.generation + 1,
          row_counts = EXCLUDED.row_counts,
          imported_at = now(),
          updated_at = now();
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async importSubwaySegmentShapes(
    dataset: SubwaySegmentShapeDataset,
  ): Promise<void> {
    const client = await this.pool.connect();
    const copy = async (statement: string, rows: string[]) => {
      const stream = client.query(copyFrom(statement));
      Readable.from(rows).pipe(stream);
      await finished(stream);
    };
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '10min'");
      await client.query(`
        CREATE TEMP TABLE subway_segment_shapes_import (
          service_line_id varchar(32) NOT NULL,
          from_source_station_key varchar(120) NOT NULL,
          to_source_station_key varchar(120) NOT NULL,
          geometry_json jsonb NOT NULL,
          geometry_source varchar(160) NOT NULL,
          geometry_license varchar(240) NOT NULL,
          geometry_version varchar(120) NOT NULL,
          geometry_updated_at timestamptz NOT NULL,
          PRIMARY KEY(
            service_line_id,
            from_source_station_key,
            to_source_station_key
          )
        ) ON COMMIT DROP
      `);
      await copy(
        `COPY subway_segment_shapes_import(
           service_line_id, from_source_station_key,
           to_source_station_key, geometry_json,
           geometry_source, geometry_license, geometry_version,
           geometry_updated_at
         ) FROM STDIN WITH (FORMAT csv)`,
        dataset.rows.map((row) =>
          [
            csvField(row.serviceLineId),
            csvField(row.fromSourceStationKey),
            csvField(row.toSourceStationKey),
            csvField(JSON.stringify({
              type: "LineString",
              coordinates: row.coordinates.map(({ lat, lng }) => [lng, lat]),
            })),
            csvField(row.geometrySource),
            csvField(row.geometryLicense),
            csvField(row.geometryVersion),
            csvField(row.geometryUpdatedAt),
          ].join(",") + "\n",
        ),
      );
      await client.query(`
        DO $$
        DECLARE
          unknown_count integer;
          missing_count integer;
        BEGIN
          SELECT COUNT(*) INTO unknown_count
          FROM subway_segment_shapes_import AS imported
          LEFT JOIN subway_segments AS segment
            ON segment.service_line_id = imported.service_line_id
           AND segment.from_source_station_key =
               imported.from_source_station_key
           AND segment.to_source_station_key = imported.to_source_station_key
          WHERE segment.service_line_id IS NULL;
          IF unknown_count > 0 THEN
            RAISE EXCEPTION
              'subway segment geometry contains unknown keys: %',
              unknown_count;
          END IF;

          SELECT COUNT(*) INTO missing_count
          FROM subway_segments AS segment
          JOIN subway_service_lines AS service_line
            ON service_line.service_line_id = segment.service_line_id
           AND service_line.active = true
           AND service_line.is_route_ready = true
          LEFT JOIN subway_segment_shapes_import AS imported
            ON imported.service_line_id = segment.service_line_id
           AND imported.from_source_station_key =
               segment.from_source_station_key
           AND imported.to_source_station_key = segment.to_source_station_key
          WHERE segment.active = true
            AND imported.service_line_id IS NULL;
          IF missing_count > 0 THEN
            RAISE EXCEPTION
              'route-ready subway segments missing geometry: %',
              missing_count;
          END IF;
        END $$;

        UPDATE subway_segments AS segment
        SET track_geometry = NULL,
            track_distance_meters = NULL,
            geometry_source = NULL,
            geometry_license = NULL,
            geometry_version = NULL,
            geometry_updated_at = NULL,
            updated_at = now()
        FROM subway_service_lines AS service_line
        WHERE service_line.service_line_id = segment.service_line_id
          AND service_line.active = true
          AND service_line.is_route_ready = true
          AND segment.active = true;

        WITH parsed AS (
          SELECT
            imported.*,
            ST_Force2D(
              ST_SetSRID(
                ST_GeomFromGeoJSON(imported.geometry_json::text),
                4326
              )
            )::geometry(LineString, 4326) AS source_geometry
          FROM subway_segment_shapes_import AS imported
        ), prepared AS (
          SELECT
            parsed.*,
            ST_Transform(
              ST_SimplifyPreserveTopology(
                ST_Transform(parsed.source_geometry, 5179),
                3
              ),
              4326
            )::geometry(LineString, 4326) AS display_geometry,
            GREATEST(
              1,
              ROUND(ST_Length(parsed.source_geometry::geography))::integer
            ) AS source_distance_meters
          FROM parsed
        )
        UPDATE subway_segments AS segment
        SET track_geometry = prepared.display_geometry,
            track_distance_meters = prepared.source_distance_meters,
            geometry_source = prepared.geometry_source,
            geometry_license = prepared.geometry_license,
            geometry_version = prepared.geometry_version,
            geometry_updated_at = prepared.geometry_updated_at,
            updated_at = now()
        FROM prepared
        WHERE segment.service_line_id = prepared.service_line_id
          AND segment.from_source_station_key =
              prepared.from_source_station_key
          AND segment.to_source_station_key = prepared.to_source_station_key;
      `);
      await client.query(`
        INSERT INTO transit_dataset_versions(
          dataset, generation, checksum, row_counts, imported_at, updated_at
        ) VALUES (
          'subway_track_geometry', 1, $1,
          jsonb_build_object(
            'segments', (SELECT COUNT(*) FROM subway_segment_shapes_import),
            'sources', (
              SELECT COUNT(DISTINCT geometry_source)
              FROM subway_segment_shapes_import
            )
          ),
          now(), now()
        )
        ON CONFLICT(dataset) DO UPDATE SET
          generation = transit_dataset_versions.generation + 1,
          checksum = EXCLUDED.checksum,
          row_counts = EXCLUDED.row_counts,
          imported_at = now(),
          updated_at = now()
      `, [dataset.checksum]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async importSubwayProviderMappings(
    rows: readonly CsvSubwayProviderMapping[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TEMP TABLE subway_provider_mapping_import (
          source_station_key varchar(120) NOT NULL,
          station_name varchar(200) NOT NULL,
          line_name varchar(200) NOT NULL,
          region_code varchar(20) NOT NULL,
          preferred_provider varchar(30) NOT NULL,
          tago_station_id varchar(100),
          seoul_subway_id varchar(100),
          seoul_station_id varchar(100),
          mapping_status varchar(30) NOT NULL
        ) ON COMMIT DROP
      `);
      for (const row of rows) {
        await client.query(
          `INSERT INTO subway_provider_mapping_import VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9
           )`,
          [
            row.sourceStationKey,
            row.stationName,
            row.lineName,
            row.regionCode,
            row.preferredProvider,
            row.tagoStationId,
            row.seoulSubwayId,
            row.seoulStationId,
            row.mappingStatus,
          ],
        );
      }
      await client.query(`
        CREATE TEMP TABLE resolved_provider_mapping_import AS
        SELECT DISTINCT ON (
          line_station.service_line_id, line_station.station_line_id
        )
          imported.*,
          line_station.service_line_id,
          line_station.station_line_id
        FROM subway_provider_mapping_import AS imported
        JOIN subway_line_stations AS line_station
          ON line_station.source_station_key = imported.source_station_key
         AND line_station.active = true
        JOIN subway_service_lines AS service_line
          ON service_line.service_line_id = line_station.service_line_id
         AND service_line.active = true
         AND (
           regexp_replace(
             lower(imported.line_name),
             '(도시철도|수도권|광역철도|서울교통공사|코레일|선|\\s)',
             '', 'g'
           ) = regexp_replace(
             lower(service_line.service_line_name),
             '(도시철도|수도권|광역철도|서울교통공사|코레일|선|\\s)',
             '', 'g'
           )
           OR (
             SELECT COUNT(DISTINCT candidate.service_line_id)
             FROM subway_line_stations AS candidate
             WHERE candidate.source_station_key = imported.source_station_key
               AND candidate.active = true
           ) = 1
         )
        ORDER BY
          line_station.service_line_id,
          line_station.station_line_id,
          (regexp_replace(lower(imported.station_name), '[^가-힣a-z0-9]', '', 'g') =
           regexp_replace(lower(line_station.station_name), '[^가-힣a-z0-9]', '', 'g')) DESC,
          imported.station_name;

        INSERT INTO subway_provider_station_mappings(
          service_line_id, station_line_id, provider, query_station_name,
          external_station_id, external_line_id, external_line_name,
          mapping_status, priority, mapping_checked_at, updated_at
        )
        SELECT
          imported.service_line_id,
          imported.station_line_id,
          'TAGO',
          imported.station_name,
          imported.tago_station_id,
          NULL,
          imported.line_name,
          CASE WHEN imported.tago_station_id IS NOT NULL
            THEN 'MAPPED' ELSE 'PENDING' END,
          CASE WHEN imported.preferred_provider = 'TAGO_TIMETABLE'
            THEN 100 ELSE 200 END,
          CASE WHEN imported.tago_station_id IS NOT NULL THEN now() ELSE NULL END,
          now()
        FROM resolved_provider_mapping_import AS imported
        ON CONFLICT(service_line_id, station_line_id, provider) DO UPDATE SET
          query_station_name = EXCLUDED.query_station_name,
          external_station_id = COALESCE(
            EXCLUDED.external_station_id,
            subway_provider_station_mappings.external_station_id
          ),
          external_line_name = EXCLUDED.external_line_name,
          mapping_status = CASE
            WHEN COALESCE(
              EXCLUDED.external_station_id,
              subway_provider_station_mappings.external_station_id
            ) IS NOT NULL THEN 'MAPPED'
            ELSE subway_provider_station_mappings.mapping_status
          END,
          priority = EXCLUDED.priority,
          updated_at = now();

        INSERT INTO subway_provider_station_mappings(
          service_line_id, station_line_id, provider, query_station_name,
          external_station_id, external_line_id, external_line_name,
          mapping_status, priority, mapping_checked_at, updated_at
        )
        SELECT
          imported.service_line_id,
          imported.station_line_id,
          'SEOUL',
          imported.station_name,
          imported.seoul_station_id,
          imported.seoul_subway_id,
          imported.line_name,
          CASE
            WHEN imported.preferred_provider <> 'SEOUL_REALTIME' THEN 'DISABLED'
            WHEN imported.seoul_station_id IS NOT NULL
              OR imported.seoul_subway_id IS NOT NULL THEN 'MAPPED'
            ELSE 'PENDING'
          END,
          CASE WHEN imported.preferred_provider = 'SEOUL_REALTIME'
            THEN 100 ELSE 300 END,
          CASE WHEN imported.seoul_station_id IS NOT NULL
            OR imported.seoul_subway_id IS NOT NULL THEN now() ELSE NULL END,
          now()
        FROM resolved_provider_mapping_import AS imported
        ON CONFLICT(service_line_id, station_line_id, provider) DO UPDATE SET
          query_station_name = EXCLUDED.query_station_name,
          external_station_id = COALESCE(
            EXCLUDED.external_station_id,
            subway_provider_station_mappings.external_station_id
          ),
          external_line_id = COALESCE(
            EXCLUDED.external_line_id,
            subway_provider_station_mappings.external_line_id
          ),
          external_line_name = EXCLUDED.external_line_name,
          mapping_status = CASE
            WHEN EXCLUDED.mapping_status = 'DISABLED' THEN 'DISABLED'
            WHEN COALESCE(
              EXCLUDED.external_station_id,
              subway_provider_station_mappings.external_station_id,
              EXCLUDED.external_line_id,
              subway_provider_station_mappings.external_line_id
            ) IS NOT NULL THEN 'MAPPED'
            ELSE subway_provider_station_mappings.mapping_status
          END,
          priority = EXCLUDED.priority,
          updated_at = now()
      `);
      await client.query(`
        INSERT INTO transit_dataset_versions(
          dataset, generation, row_counts, imported_at, updated_at
        ) VALUES (
          'subway_provider_mappings', 1,
          jsonb_build_object('sourceRows', $1::integer), now(), now()
        )
        ON CONFLICT(dataset) DO UPDATE SET
          generation = transit_dataset_versions.generation + 1,
          row_counts = EXCLUDED.row_counts,
          imported_at = now(),
          updated_at = now()
      `, [rows.length]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async searchSubwayStations(
    query: string,
    limit: number,
  ): Promise<SubwayStation[]> {
    const result = await this.pool.query(
      `SELECT ${subwayStationSelect()}
       FROM subway_station_lines
       WHERE active = true
         AND (station_name ILIKE $1 OR line_name ILIKE $1)
       ORDER BY
         CASE WHEN station_name = $2 THEN 0 ELSE 1 END,
         station_name, line_name
       LIMIT $3`,
      [`%${query}%`, query, limit],
    );
    return result.rows.map(rowToSubwayStation);
  }

  public async findNearbySubwayStations(
    coordinate: { lat: number; lng: number },
    radiusMeters: number,
    limit: number,
  ): Promise<SubwayStation[]> {
    const result = await this.pool.query(
      `SELECT ${subwayStationSelect()},
         ST_Distance(
           location,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS distance_meters
       FROM subway_station_lines
       WHERE active = true
         AND ST_DWithin(
           location,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
       ORDER BY distance_meters, station_name, line_name
       LIMIT $4`,
      [coordinate.lng, coordinate.lat, radiusMeters, limit],
    );
    return result.rows.map(rowToSubwayStation);
  }

  public async getSubwayRoutingGraph(
    dayGroup: "WEEKDAY" | "WEEKEND_HOLIDAY",
    timePeriod:
      | "EARLY_MORNING"
      | "MORNING_PEAK"
      | "DAYTIME"
      | "EVENING_PEAK"
      | "LATE_NIGHT",
  ): Promise<SubwayRoutingGraph> {
    const [stationResult, rideResult, transferResult] = await Promise.all([
      this.pool.query(`
        SELECT
          line_station.service_line_id,
          line_station.station_line_id,
          line_station.source_station_key,
          line_station.station_order,
          line_station.station_name,
          service_line.service_line_name,
          service_line.region_name,
          service_line.operator_name,
          ST_Y(station.location::geometry) AS latitude,
          ST_X(station.location::geometry) AS longitude
        FROM subway_line_stations AS line_station
        JOIN subway_service_lines AS service_line
          ON service_line.service_line_id = line_station.service_line_id
         AND service_line.is_route_ready = true
         AND service_line.active = true
        JOIN subway_station_lines AS station
          ON station.id = line_station.station_line_id
         AND station.active = true
        WHERE line_station.active = true
        ORDER BY line_station.service_line_id, line_station.station_order
      `),
      this.pool.query(
        `SELECT
           segment.service_line_id,
           segment.from_source_station_key,
           segment.to_source_station_key,
           segment.duration_seconds,
           segment.straight_distance_meters,
           segment.track_distance_meters,
           segment.geometry_source,
           ST_AsGeoJSON(segment.track_geometry)::jsonb AS track_geometry,
           COALESCE(headway.expected_wait_seconds, 300) AS expected_wait_seconds
         FROM subway_segments AS segment
         JOIN subway_service_lines AS service_line
           ON service_line.service_line_id = segment.service_line_id
          AND service_line.is_route_ready = true
          AND service_line.active = true
         LEFT JOIN subway_headways_fallback AS headway
           ON headway.service_line_id = segment.service_line_id
          AND headway.source_station_key = segment.from_source_station_key
          AND headway.next_source_station_key = segment.to_source_station_key
          AND headway.day_group = $1
          AND headway.time_period = $2
          AND headway.active = true
         WHERE segment.active = true`,
        [dayGroup, timePeriod],
      ),
      this.pool.query(`
        SELECT
          from_source_station_key,
          to_source_station_key,
          transfer_duration_seconds,
          straight_distance_meters,
          duration_is_estimated
        FROM subway_transfer_edges
        WHERE active = true
      `),
    ]);
    const stations = stationResult.rows.map((row): SubwayRoutingStation => ({
      nodeId: `${String(row.service_line_id)}:${String(row.source_station_key)}`,
      stationLineId: String(row.station_line_id),
      serviceLineId: String(row.service_line_id),
      sourceStationKey: String(row.source_station_key),
      stationOrder: Number(row.station_order),
      stationName: String(row.station_name),
      lineName: String(row.service_line_name),
      regionName: String(row.region_name),
      operatorName: String(row.operator_name),
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    }));
    const nodesByKey = new Map<string, SubwayRoutingStation[]>();
    for (const station of stations) {
      const nodes = nodesByKey.get(station.sourceStationKey) ?? [];
      nodes.push(station);
      nodesByKey.set(station.sourceStationKey, nodes);
    }
    const edges: SubwayRoutingEdge[] = [];
    for (const row of rideResult.rows) {
      const serviceLineId = String(row.service_line_id);
      const fromNodeId = `${serviceLineId}:${String(row.from_source_station_key)}`;
      const toNodeId = `${serviceLineId}:${String(row.to_source_station_key)}`;
      if (
        !stations.some((station) => station.nodeId === fromNodeId) ||
        !stations.some((station) => station.nodeId === toNodeId)
      ) {
        continue;
      }
      edges.push({
        fromNodeId,
        toNodeId,
        kind: "RIDE",
        durationSeconds: Number(row.duration_seconds),
        distanceMeters: Number(row.straight_distance_meters),
        expectedWaitSeconds: Number(row.expected_wait_seconds),
        serviceLineId,
        durationIsEstimated: false,
        trackCoordinates: lineStringCoordinates(
          row.track_geometry,
          `지하철 구간 ${serviceLineId}:${String(row.from_source_station_key)}:${String(row.to_source_station_key)}`,
        ),
        trackDistanceMeters:
          row.track_distance_meters === null ||
          row.track_distance_meters === undefined
            ? null
            : Number(row.track_distance_meters),
        geometrySource: nullableString(row.geometry_source),
      });
    }
    for (const row of transferResult.rows) {
      const fromNodes = nodesByKey.get(String(row.from_source_station_key)) ?? [];
      const toNodes = nodesByKey.get(String(row.to_source_station_key)) ?? [];
      for (const from of fromNodes) {
        for (const to of toNodes) {
          if (from.nodeId === to.nodeId) {
            continue;
          }
          edges.push({
            fromNodeId: from.nodeId,
            toNodeId: to.nodeId,
            kind: "TRANSFER",
            durationSeconds: Number(row.transfer_duration_seconds),
            distanceMeters: Number(row.straight_distance_meters),
            expectedWaitSeconds: 0,
            serviceLineId: null,
            durationIsEstimated: row.duration_is_estimated === true,
            trackCoordinates: null,
            trackDistanceMeters: null,
            geometrySource: null,
          });
        }
      }
    }
    return { stations, edges };
  }

  public async getBusSubwayTransferLinks(
    busStopIds: readonly string[],
  ): Promise<BusSubwayTransferLink[]> {
    if (busStopIds.length === 0) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT
         edge.bus_stop_id,
         edge.walk_distance_meters,
         edge.walk_duration_seconds,
         edge.tago_verified,
         ST_AsGeoJSON(edge.walking_geometry)::jsonb AS walking_geometry,
         ST_Y(bus_stop.location::geometry) AS bus_latitude,
         ST_X(bus_stop.location::geometry) AS bus_longitude,
         line_station.service_line_id,
         line_station.source_station_key,
         line_station.station_line_id,
         station.station_name,
         service_line.service_line_name,
         ST_Y(station.location::geometry) AS station_latitude,
         ST_X(station.location::geometry) AS station_longitude
       FROM bus_subway_transfer_edges AS edge
       JOIN bus_stops AS bus_stop ON bus_stop.id = edge.bus_stop_id
       JOIN subway_station_lines AS station
         ON station.id = edge.station_line_id
        AND station.active = true
       JOIN subway_line_stations AS line_station
         ON line_station.station_line_id = station.id
        AND line_station.active = true
       JOIN subway_service_lines AS service_line
         ON service_line.service_line_id = line_station.service_line_id
        AND service_line.active = true
        AND service_line.is_route_ready = true
       WHERE edge.active = true
         AND edge.bus_stop_id = ANY($1::bigint[])
       ORDER BY edge.bus_stop_id, edge.walk_duration_seconds,
                line_station.service_line_id`,
      [busStopIds],
    );
    return result.rows.flatMap((row): BusSubwayTransferLink[] => {
      const geometry = row.walking_geometry as {
        type?: unknown;
        coordinates?: unknown;
      } | null;
      if (
        geometry?.type !== "LineString" ||
        !Array.isArray(geometry.coordinates)
      ) {
        return [];
      }
      const coordinates = geometry.coordinates.flatMap(
        (coordinate): Array<{ lat: number; lng: number }> =>
          Array.isArray(coordinate) &&
          typeof coordinate[0] === "number" &&
          typeof coordinate[1] === "number"
            ? [{ lng: coordinate[0], lat: coordinate[1] }]
            : [],
      );
      if (coordinates.length < 2) {
        return [];
      }
      const serviceLineId = String(row.service_line_id);
      const sourceStationKey = String(row.source_station_key);
      return [{
        busStopId: String(row.bus_stop_id),
        subwayNodeId: `${serviceLineId}:${sourceStationKey}`,
        serviceLineId,
        stationLineId: String(row.station_line_id),
        sourceStationKey,
        stationName: String(row.station_name),
        lineName: String(row.service_line_name),
        busCoordinate: {
          lat: Number(row.bus_latitude),
          lng: Number(row.bus_longitude),
        },
        subwayCoordinate: {
          lat: Number(row.station_latitude),
          lng: Number(row.station_longitude),
        },
        walkDistanceMeters: Number(row.walk_distance_meters),
        walkDurationSeconds: Number(row.walk_duration_seconds),
        coordinates,
        tagoVerified: row.tago_verified === true,
      }];
    });
  }

  public async getBusSubwayTransferBuildCandidates(
    limit = 20_000,
  ): Promise<BusSubwayTransferCandidate[]> {
    const result = await this.pool.query(`
      WITH route_linked_stops AS (
        SELECT DISTINCT stop_internal_id FROM bus_route_stops
      ), ranked AS (
        SELECT
          bus_stop.id AS bus_stop_id,
          station.id AS station_line_id,
          bus_stop.name AS bus_name,
          station.station_name,
          ST_Y(bus_stop.location::geometry) AS bus_latitude,
          ST_X(bus_stop.location::geometry) AS bus_longitude,
          ST_Y(station.location::geometry) AS station_latitude,
          ST_X(station.location::geometry) AS station_longitude,
          round(ST_Distance(bus_stop.location, station.location))::integer
            AS straight_distance_meters,
          row_number() OVER (
            PARTITION BY station.id
            ORDER BY ST_Distance(bus_stop.location, station.location), bus_stop.id
          ) AS proximity_rank
        FROM subway_station_lines AS station
        JOIN subway_line_stations AS line_station
          ON line_station.station_line_id = station.id
         AND line_station.active = true
        JOIN subway_service_lines AS service_line
          ON service_line.service_line_id = line_station.service_line_id
         AND service_line.active = true
         AND service_line.is_route_ready = true
        JOIN bus_stops AS bus_stop
          ON ST_DWithin(bus_stop.location, station.location, 500)
        JOIN route_linked_stops AS linked
          ON linked.stop_internal_id = bus_stop.id
        WHERE station.active = true
      )
      SELECT DISTINCT ON (ranked.bus_stop_id, ranked.station_line_id)
        ranked.bus_stop_id, ranked.station_line_id,
        ranked.bus_name, ranked.station_name,
        ranked.bus_latitude, ranked.bus_longitude,
        ranked.station_latitude, ranked.station_longitude,
        ranked.straight_distance_meters,
        existing.source_hash AS existing_source_hash,
        existing.active AS existing_active
      FROM ranked
      LEFT JOIN bus_subway_transfer_edges AS existing
        ON existing.bus_stop_id = ranked.bus_stop_id
       AND existing.station_line_id = ranked.station_line_id
      WHERE proximity_rank <= 10
      ORDER BY ranked.bus_stop_id, ranked.station_line_id
      LIMIT $1
    `, [limit]);
    return result.rows.map((row): BusSubwayTransferCandidate => {
      const candidate = {
        busStopId: String(row.bus_stop_id),
        stationLineId: String(row.station_line_id),
        busName: String(row.bus_name),
        stationName: String(row.station_name),
        busCoordinate: {
          lat: Number(row.bus_latitude),
          lng: Number(row.bus_longitude),
        },
        subwayCoordinate: {
          lat: Number(row.station_latitude),
          lng: Number(row.station_longitude),
        },
        straightDistanceMeters: Number(row.straight_distance_meters),
      };
      const sourceHash = createHash("sha256")
        .update([
          candidate.busStopId,
          candidate.stationLineId,
          candidate.busCoordinate.lat.toFixed(7),
          candidate.busCoordinate.lng.toFixed(7),
          candidate.subwayCoordinate.lat.toFixed(7),
          candidate.subwayCoordinate.lng.toFixed(7),
        ].join("\u001f"))
        .digest("hex");
      return {
        ...candidate,
        sourceHash,
        needsRefresh:
          row.existing_active !== true ||
          String(row.existing_source_hash ?? "") !== sourceHash,
      };
    });
  }

  public async getSubwayTimingContext(input: {
    serviceLineId: string;
    stationLineId: string;
    fromSourceStationKey: string;
    toSourceStationKey: string;
  }): Promise<SubwayTimingContext | null> {
    const [stationResult, mappingResult, directionResult] = await Promise.all([
      this.pool.query(
        `SELECT
           station.id, station.station_name, station.road_address,
           service_line.service_line_name,
           source.station_order AS from_station_order,
           target.station_order AS to_station_order
         FROM subway_line_stations AS source
         JOIN subway_line_stations AS target
           ON target.service_line_id = source.service_line_id
          AND target.source_station_key = $4
          AND target.active = true
         JOIN subway_service_lines AS service_line
           ON service_line.service_line_id = source.service_line_id
          AND service_line.active = true
         JOIN subway_station_lines AS station
           ON station.id = source.station_line_id
          AND station.active = true
         WHERE source.service_line_id = $1
           AND source.station_line_id = $2
           AND source.source_station_key = $3
           AND source.active = true`,
        [
          input.serviceLineId,
          input.stationLineId,
          input.fromSourceStationKey,
          input.toSourceStationKey,
        ],
      ),
      this.pool.query(
        `SELECT provider, query_station_name, external_station_id,
                external_line_id, external_line_name, mapping_status
         FROM subway_provider_station_mappings
         WHERE service_line_id = $1 AND station_line_id = $2
         ORDER BY priority, provider`,
        [input.serviceLineId, input.stationLineId],
      ),
      this.pool.query(
        `SELECT provider, external_direction_code, destination_name,
                mapping_status
         FROM subway_provider_direction_mappings
         WHERE service_line_id = $1
           AND from_source_station_key = $2
           AND to_source_station_key = $3`,
        [
          input.serviceLineId,
          input.fromSourceStationKey,
          input.toSourceStationKey,
        ],
      ),
    ]);
    const row = stationResult.rows[0];
    if (row === undefined) {
      return null;
    }
    return {
      stationLineId: String(row.id),
      stationName: String(row.station_name),
      lineName: String(row.service_line_name),
      roadAddress: nullableString(row.road_address),
      fromStationOrder: Number(row.from_station_order),
      toStationOrder: Number(row.to_station_order),
      mappings: mappingResult.rows.map((mapping) => ({
        provider: String(mapping.provider) as "TAGO" | "SEOUL",
        queryStationName: String(mapping.query_station_name),
        externalStationId: nullableString(mapping.external_station_id),
        externalLineId: nullableString(mapping.external_line_id),
        externalLineName: nullableString(mapping.external_line_name),
        mappingStatus: String(mapping.mapping_status),
      })),
      directionMappings: directionResult.rows.map((mapping) => ({
        provider: String(mapping.provider) as "TAGO" | "SEOUL",
        externalDirectionCode: nullableString(
          mapping.external_direction_code,
        ),
        destinationName: nullableString(mapping.destination_name),
        mappingStatus: String(mapping.mapping_status),
      })),
    };
  }

  public async beginBusSubwayTransferBuild(
    runId: string,
    candidateCount: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO bus_subway_transfer_build_runs(
         id, status, candidate_count, started_at, updated_at
       ) VALUES ($1, 'RUNNING', $2, now(), now())
       ON CONFLICT(id) DO UPDATE SET
         status = 'RUNNING', candidate_count = EXCLUDED.candidate_count,
         completed_at = NULL, updated_at = now()`,
      [runId, candidateCount],
    );
  }

  public async saveBusSubwayTransferEdge(input: {
    runId: string;
    candidate: BusSubwayTransferCandidate;
    walkDistanceMeters: number;
    walkDurationSeconds: number;
    coordinates: Array<{ lat: number; lng: number }>;
    tagoVerified?: boolean;
  }): Promise<void> {
    const lineString = JSON.stringify({
      type: "LineString",
      coordinates: input.coordinates.map((point) => [point.lng, point.lat]),
    });
    await this.pool.query(
      `INSERT INTO bus_subway_transfer_edges(
         bus_stop_id, station_line_id, walk_distance_meters,
         walk_duration_seconds, walking_geometry, tago_verified,
         active, source_hash, build_run_id, calculated_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
         $6, true, $7, $8, now(), now()
       )
       ON CONFLICT(bus_stop_id, station_line_id) DO UPDATE SET
         walk_distance_meters = EXCLUDED.walk_distance_meters,
         walk_duration_seconds = EXCLUDED.walk_duration_seconds,
         walking_geometry = EXCLUDED.walking_geometry,
         tago_verified = EXCLUDED.tago_verified,
         active = true,
         source_hash = EXCLUDED.source_hash,
         build_run_id = EXCLUDED.build_run_id,
         calculated_at = now(),
         updated_at = now()`,
      [
        input.candidate.busStopId,
        input.candidate.stationLineId,
        input.walkDistanceMeters,
        input.walkDurationSeconds,
        lineString,
        input.tagoVerified ?? false,
        input.candidate.sourceHash,
        input.runId,
      ],
    );
  }

  public async finishBusSubwayTransferBuild(input: {
    runId: string;
    processed: number;
    saved: number;
    skipped: number;
    failed: number;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE bus_subway_transfer_build_runs
       SET status = $2, processed_count = $3, saved_count = $4,
           skipped_count = $5, failed_count = $6,
           completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [
        input.runId,
        input.failed === 0 ? "COMPLETED" : "FAILED",
        input.processed,
        input.saved,
        input.skipped,
        input.failed,
      ],
    );
  }

  public async getSubwayStation(id: string): Promise<SubwayStation | null> {
    const result = await this.pool.query(
      `SELECT ${subwayStationSelect()}
       FROM subway_station_lines
       WHERE id = $1 AND active = true`,
      [id],
    );
    return result.rows[0] === undefined
      ? null
      : rowToSubwayStation(result.rows[0]);
  }

  public async subwayStationsForMapping(
    limit = 10_000,
  ): Promise<SubwayStation[]> {
    const result = await this.pool.query(
      `SELECT ${subwayStationSelect()}
       FROM subway_station_lines
       WHERE active = true AND mapping_status <> 'MAPPED'
       ORDER BY station_name, line_name
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(rowToSubwayStation);
  }

  public async updateSubwayStationMapping(input: {
    id: string;
    status: SubwayStationMappingStatus;
    canonicalStatus?: "MAPPED" | "AMBIGUOUS" | "NOT_FOUND";
    tagoStationId: string | null;
    tagoRouteName: string | null;
  }): Promise<void> {
    await this.pool.query(
      `WITH updated_station AS (
         UPDATE subway_station_lines
         SET mapping_status = $2,
             tago_station_id = $3,
             tago_route_name = $4,
             mapping_checked_at = now(),
             updated_at = now()
         WHERE id = $1
         RETURNING id
       )
       UPDATE subway_provider_station_mappings AS mapping
       SET external_station_id = $3,
           external_line_name = $4,
           mapping_status = $5::varchar,
           mapping_checked_at = now(),
           last_success_at = CASE WHEN $5::varchar = 'MAPPED'
             THEN now() ELSE mapping.last_success_at END,
           updated_at = now()
       FROM updated_station
       WHERE mapping.station_line_id = updated_station.id
         AND mapping.provider = 'TAGO'`,
      [
        input.id,
        input.status,
        input.tagoStationId,
        input.tagoRouteName,
        input.canonicalStatus ??
          (input.status === "MAPPED" ? "MAPPED" : "NOT_FOUND"),
      ],
    );
  }

  public async stats(): Promise<TransitStats> {
    const result = await this.pool.query<{
      stops: string;
      linked_stops: string;
      routes: string;
      route_stops: string;
      subway_stations: string;
      active_subway_stations: string;
      mapped_subway_stations: string;
      subway_service_lines: string;
      route_ready_subway_lines: string;
      provider_mapped_stations: string;
      bus_subway_transfer_edges: string;
      route_ready_subway_segments: string;
      subway_track_geometry_segments: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM bus_stops)::text AS stops,
        (
          SELECT COUNT(*) FROM bus_stops
          WHERE city_code IS NOT NULL AND node_id IS NOT NULL
        )::text AS linked_stops,
        (SELECT COUNT(*) FROM bus_routes)::text AS routes,
        (SELECT COUNT(*) FROM bus_route_stops)::text AS route_stops,
        (SELECT COUNT(*) FROM subway_station_lines)::text AS subway_stations,
        (
          SELECT COUNT(*) FROM subway_station_lines WHERE active = true
        )::text AS active_subway_stations,
        (
          SELECT COUNT(*) FROM subway_station_lines
          WHERE active = true AND mapping_status = 'MAPPED'
        )::text AS mapped_subway_stations,
        (
          SELECT COUNT(*) FROM subway_service_lines WHERE active = true
        )::text AS subway_service_lines,
        (
          SELECT COUNT(*) FROM subway_service_lines
          WHERE active = true AND is_route_ready = true
        )::text AS route_ready_subway_lines,
        (
          SELECT COUNT(DISTINCT (service_line_id, station_line_id))
          FROM subway_provider_station_mappings
          WHERE mapping_status = 'MAPPED'
        )::text AS provider_mapped_stations,
        (
          SELECT COUNT(*) FROM bus_subway_transfer_edges WHERE active = true
        )::text AS bus_subway_transfer_edges,
        (
          SELECT COUNT(*)
          FROM subway_segments AS segment
          JOIN subway_service_lines AS service_line
            ON service_line.service_line_id = segment.service_line_id
           AND service_line.active = true
           AND service_line.is_route_ready = true
          WHERE segment.active = true
        )::text AS route_ready_subway_segments,
        (
          SELECT COUNT(*)
          FROM subway_segments AS segment
          JOIN subway_service_lines AS service_line
            ON service_line.service_line_id = segment.service_line_id
           AND service_line.active = true
           AND service_line.is_route_ready = true
          WHERE segment.active = true
            AND segment.track_geometry IS NOT NULL
        )::text AS subway_track_geometry_segments
    `);
    const row = result.rows[0];
    return {
      stops: Number(row?.stops ?? 0),
      linkedStops: Number(row?.linked_stops ?? 0),
      routes: Number(row?.routes ?? 0),
      routeStops: Number(row?.route_stops ?? 0),
      subwayStations: Number(row?.subway_stations ?? 0),
      activeSubwayStations: Number(row?.active_subway_stations ?? 0),
      mappedSubwayStations: Number(row?.mapped_subway_stations ?? 0),
      subwayServiceLines: Number(row?.subway_service_lines ?? 0),
      routeReadySubwayLines: Number(row?.route_ready_subway_lines ?? 0),
      providerMappedStations: Number(row?.provider_mapped_stations ?? 0),
      busSubwayTransferEdges: Number(row?.bus_subway_transfer_edges ?? 0),
      routeReadySubwaySegments: Number(
        row?.route_ready_subway_segments ?? 0,
      ),
      subwayTrackGeometrySegments: Number(
        row?.subway_track_geometry_segments ?? 0,
      ),
    };
  }

  public async subwayTrackGeometryCoverage(): Promise<
    SubwayTrackGeometryCoverage[]
  > {
    const result = await this.pool.query<{
      service_line_id: string;
      segment_count: string;
      geometry_count: string;
    }>(`
      SELECT
        service_line.service_line_id,
        COUNT(segment.*)::text AS segment_count,
        COUNT(segment.track_geometry)::text AS geometry_count
      FROM subway_service_lines AS service_line
      JOIN subway_segments AS segment
        ON segment.service_line_id = service_line.service_line_id
       AND segment.active = true
      WHERE service_line.active = true
        AND service_line.is_route_ready = true
      GROUP BY service_line.service_line_id
      ORDER BY service_line.service_line_id
    `);
    return result.rows.map((row) => ({
      serviceLineId: row.service_line_id,
      segmentCount: Number(row.segment_count),
      geometryCount: Number(row.geometry_count),
    }));
  }
}
