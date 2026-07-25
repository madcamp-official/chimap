import {
  type BusRoute,
  type BusRouteStop,
  type BusStop,
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
import { TRANSIT_MIGRATIONS } from "./migrations.js";

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
      for (const migration of TRANSIT_MIGRATIONS) {
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
        this.pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM schema_migrations",
        ),
      ]);
      return {
        connected: true,
        postgis: postgis.rows[0]?.installed === true,
        migrationsCurrent:
          Number(migrations.rows[0]?.count ?? 0) ===
          TRANSIT_MIGRATIONS.length,
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

  public async stats(): Promise<TransitStats> {
    const result = await this.pool.query<{
      stops: string;
      linked_stops: string;
      routes: string;
      route_stops: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM bus_stops)::text AS stops,
        (
          SELECT COUNT(*) FROM bus_stops
          WHERE city_code IS NOT NULL AND node_id IS NOT NULL
        )::text AS linked_stops,
        (SELECT COUNT(*) FROM bus_routes)::text AS routes,
        (SELECT COUNT(*) FROM bus_route_stops)::text AS route_stops
    `);
    const row = result.rows[0];
    return {
      stops: Number(row?.stops ?? 0),
      linkedStops: Number(row?.linked_stops ?? 0),
      routes: Number(row?.routes ?? 0),
      routeStops: Number(row?.route_stops ?? 0),
    };
  }
}
