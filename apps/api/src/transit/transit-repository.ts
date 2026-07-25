import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import {
  haversineDistanceMeters,
  type BusRoute,
  type BusRouteStop,
  type BusStop,
} from "@chimap/contracts";

import { TRANSIT_MIGRATIONS } from "./migrations.js";

type SqlRow = Record<string, SQLOutputValue>;

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

function now(): string {
  return new Date().toISOString();
}

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

function nullableString(value: SQLOutputValue | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function rowId(row: SqlRow): string {
  return String(row.id);
}

function rowToStop(row: SqlRow, distanceMeters?: number): BusStop {
  return {
    id: rowId(row),
    cityCode: nullableString(row.city_code),
    nodeId: nullableString(row.node_id),
    sourceStopNo: nullableString(row.source_stop_no),
    arsId: nullableString(row.ars_id),
    name: String(row.name),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    ...(distanceMeters === undefined
      ? {}
      : { distanceMeters: Math.round(distanceMeters) }),
    source: String(row.source) === "csv" ? "csv" : "tago",
  };
}

function rowToRoute(row: SqlRow): BusRoute {
  const cityCode = String(row.city_code);
  const routeId = String(row.route_id);
  return {
    id: `${cityCode}:${routeId}`,
    cityCode,
    routeId,
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

export class TransitRepository {
  readonly #database: DatabaseSync;

  public constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      const absolutePath = resolve(databasePath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      this.#database = new DatabaseSync(absolutePath);
    } else {
      this.#database = new DatabaseSync(":memory:");
    }
    this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  public migrate(): void {
    this.#database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    const hasVersion = this.#database.prepare(
      "SELECT 1 FROM schema_migrations WHERE version = ?",
    );
    const recordVersion = this.#database.prepare(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
    );
    for (const migration of TRANSIT_MIGRATIONS) {
      if (hasVersion.get(migration.version) !== undefined) {
        continue;
      }
      this.#database.exec("BEGIN IMMEDIATE");
      try {
        this.#database.exec(migration.sql);
        recordVersion.run(migration.version, now());
        this.#database.exec("COMMIT");
      } catch (error) {
        this.#database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  public close(): void {
    this.#database.close();
  }

  public findNearbyStops(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): BusStop[] {
    const latitudeDelta = radiusMeters / 111_320;
    const longitudeScale = Math.max(
      0.01,
      Math.cos((latitude * Math.PI) / 180),
    );
    const longitudeDelta = radiusMeters / (111_320 * longitudeScale);
    const rows = this.#database
      .prepare(
        `SELECT *
         FROM bus_stops
         WHERE latitude BETWEEN ? AND ?
           AND longitude BETWEEN ? AND ?`,
      )
      .all(
        latitude - latitudeDelta,
        latitude + latitudeDelta,
        longitude - longitudeDelta,
        longitude + longitudeDelta,
      ) as SqlRow[];
    return rows
      .map((row) => {
        const distance = haversineDistanceMeters(
          { lat: latitude, lng: longitude },
          { lat: Number(row.latitude), lng: Number(row.longitude) },
        );
        return { row, distance };
      })
      .filter(({ distance }) => distance <= radiusMeters)
      .sort((first, second) => first.distance - second.distance)
      .map(({ row, distance }) => rowToStop(row, distance));
  }

  public upsertCsvStops(stops: CsvBusStop[]): number {
    if (stops.length === 0) {
      return 0;
    }
    const timestamp = now();
    const statement = this.#database.prepare(
      `INSERT INTO bus_stops (
         city_code, node_id, source_stop_no, ars_id, region_name, name,
         latitude, longitude, source, source_updated_at, created_at, updated_at
       ) VALUES (NULL, NULL, ?, NULL, ?, ?, ?, ?, 'csv', ?, ?, ?)
       ON CONFLICT(source, source_stop_no, name, latitude, longitude)
       WHERE source = 'csv' AND source_stop_no IS NOT NULL
       DO UPDATE SET
         region_name = excluded.region_name,
         source_updated_at = excluded.source_updated_at,
         updated_at = excluded.updated_at`,
    );
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const stop of stops) {
        statement.run(
          stop.sourceStopNo,
          stop.regionName,
          stop.name,
          stop.latitude,
          stop.longitude,
          timestamp,
          timestamp,
          timestamp,
        );
      }
      this.#database.exec("COMMIT");
      return stops.length;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public reconcileTagoStop(tagoStop: BusStop): StopReconciliationResult {
    if (tagoStop.cityCode === null || tagoStop.nodeId === null) {
      throw new Error("TAGO 정류장에는 cityCode와 nodeId가 필요합니다.");
    }
    const exact = this.#database
      .prepare(
        "SELECT * FROM bus_stops WHERE city_code = ? AND node_id = ?",
      )
      .get(tagoStop.cityCode, tagoStop.nodeId) as SqlRow | undefined;
    if (exact !== undefined) {
      this.#updateTagoStop(exact, tagoStop);
      const refreshed = this.#database
        .prepare("SELECT * FROM bus_stops WHERE id = ?")
        .get(Number(exact.id)) as SqlRow;
      return { status: "existing", stop: rowToStop(refreshed) };
    }

    const candidates = this.findNearbyStops(
      tagoStop.latitude,
      tagoStop.longitude,
      30,
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
      this.#database
        .prepare(
          `UPDATE bus_stops
           SET city_code = ?, node_id = ?, ars_id = COALESCE(?, ars_id),
               name = ?, latitude = ?, longitude = ?,
               source_updated_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          tagoStop.cityCode,
          tagoStop.nodeId,
          tagoStop.arsId,
          tagoStop.name,
          tagoStop.latitude,
          tagoStop.longitude,
          now(),
          now(),
          Number(best.candidate.id),
        );
      const matched = this.#database
        .prepare("SELECT * FROM bus_stops WHERE id = ?")
        .get(Number(best.candidate.id)) as SqlRow;
      return { status: "matched", stop: rowToStop(matched) };
    }
    if (candidates.length > 1) {
      return {
        status: "ambiguous",
        stop: tagoStop,
        candidateIds: candidates.map(({ candidate }) => candidate.id),
      };
    }
    const inserted = this.#insertTagoStop(tagoStop);
    return { status: "inserted", stop: inserted };
  }

  #updateTagoStop(existing: SqlRow, stop: BusStop): void {
    this.#database
      .prepare(
        `UPDATE bus_stops
         SET ars_id = COALESCE(?, ars_id), name = ?, latitude = ?,
             longitude = ?, source_updated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        stop.arsId,
        stop.name,
        stop.latitude,
        stop.longitude,
        now(),
        now(),
        Number(existing.id),
      );
  }

  #insertTagoStop(stop: BusStop): BusStop {
    const timestamp = now();
    const result = this.#database
      .prepare(
        `INSERT INTO bus_stops (
           city_code, node_id, source_stop_no, ars_id, region_name, name,
           latitude, longitude, source, source_updated_at, created_at, updated_at
         ) VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, 'tago', ?, ?, ?)
         ON CONFLICT(city_code, node_id)
         WHERE city_code IS NOT NULL AND node_id IS NOT NULL
         DO UPDATE SET
           ars_id = COALESCE(excluded.ars_id, bus_stops.ars_id),
           name = excluded.name,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           source_updated_at = excluded.source_updated_at,
           updated_at = excluded.updated_at
         RETURNING *`,
      )
      .get(
        stop.cityCode,
        stop.nodeId,
        stop.arsId,
        stop.name,
        stop.latitude,
        stop.longitude,
        timestamp,
        timestamp,
        timestamp,
      ) as SqlRow;
    return rowToStop(result);
  }

  public upsertRoute(route: BusRoute): BusRoute {
    const timestamp = now();
    this.#database
      .prepare(
        `INSERT INTO bus_routes (
           city_code, route_id, route_no, route_name, route_type,
           start_stop_name, end_stop_name, first_bus_time, last_bus_time,
           weekday_interval_minutes, weekend_interval_minutes,
           source_updated_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(city_code, route_id) DO UPDATE SET
           route_no = excluded.route_no,
           route_name = excluded.route_name,
           route_type = excluded.route_type,
           start_stop_name = excluded.start_stop_name,
           end_stop_name = excluded.end_stop_name,
           first_bus_time = excluded.first_bus_time,
           last_bus_time = excluded.last_bus_time,
           weekday_interval_minutes = excluded.weekday_interval_minutes,
           weekend_interval_minutes = excluded.weekend_interval_minutes,
           source_updated_at = excluded.source_updated_at,
           updated_at = excluded.updated_at`,
      )
      .run(
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
        timestamp,
        timestamp,
        timestamp,
      );
    return this.getRoute(route.cityCode, route.routeId) ?? route;
  }

  public getRoute(cityCode: string, routeId: string): BusRoute | undefined {
    const row = this.#database
      .prepare(
        "SELECT * FROM bus_routes WHERE city_code = ? AND route_id = ?",
      )
      .get(cityCode, routeId) as SqlRow | undefined;
    return row === undefined ? undefined : rowToRoute(row);
  }

  public getRoutesByStop(cityCode: string, nodeId: string): BusRoute[] {
    return (
      this.#database
        .prepare(
          `SELECT DISTINCT route.*
           FROM bus_routes AS route
           JOIN bus_route_stops AS relation
             ON relation.route_internal_id = route.id
           JOIN bus_stops AS stop
             ON stop.id = relation.stop_internal_id
           WHERE stop.city_code = ? AND stop.node_id = ?
           ORDER BY route.route_no`,
        )
        .all(cityCode, nodeId) as SqlRow[]
    ).map(rowToRoute);
  }

  public replaceRouteStops(
    route: BusRoute,
    stops: BusRouteStop[],
  ): void {
    this.upsertRoute(route);
    const routeRow = this.#database
      .prepare(
        "SELECT id FROM bus_routes WHERE city_code = ? AND route_id = ?",
      )
      .get(route.cityCode, route.routeId) as SqlRow;
    const routeInternalId = Number(routeRow.id);
    const relation = this.#database.prepare(
      `INSERT INTO bus_route_stops (
         route_internal_id, stop_internal_id, node_order, direction,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(route_internal_id, node_order) DO UPDATE SET
         stop_internal_id = excluded.stop_internal_id,
         direction = excluded.direction,
         updated_at = excluded.updated_at`,
    );
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          "DELETE FROM bus_route_stops WHERE route_internal_id = ?",
        )
        .run(routeInternalId);
      for (const stop of stops) {
        const storedStop = this.reconcileTagoStop({
          id: stop.stopId,
          cityCode: stop.cityCode,
          nodeId: stop.nodeId,
          sourceStopNo: null,
          arsId: null,
          name: stop.stopName,
          latitude: stop.latitude,
          longitude: stop.longitude,
          source: "tago",
        });
        const resolvedStop =
          storedStop.status === "ambiguous"
            ? this.#insertTagoStop(storedStop.stop)
            : storedStop.stop;
        const timestamp = now();
        relation.run(
          routeInternalId,
          Number(resolvedStop.id),
          stop.nodeOrder,
          stop.direction,
          timestamp,
          timestamp,
        );
      }
      this.#database.exec("COMMIT");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public getRouteStops(
    cityCode: string,
    routeId: string,
  ): BusRouteStop[] {
    const rows = this.#database
      .prepare(
        `SELECT
           route.route_id,
           stop.id AS stop_id,
           stop.node_id,
           stop.name,
           stop.latitude,
           stop.longitude,
           relation.node_order,
           relation.direction
         FROM bus_routes AS route
         JOIN bus_route_stops AS relation
           ON relation.route_internal_id = route.id
         JOIN bus_stops AS stop
           ON stop.id = relation.stop_internal_id
         WHERE route.city_code = ? AND route.route_id = ?
           AND stop.node_id IS NOT NULL
         ORDER BY relation.node_order`,
      )
      .all(cityCode, routeId) as SqlRow[];
    return rows.map((row) => ({
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

  public stats(): {
    stops: number;
    linkedStops: number;
    routes: number;
    routeStops: number;
  } {
    const count = (table: string, where = ""): number => {
      const row = this.#database
        .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
        .get() as SqlRow;
      return Number(row.count);
    };
    return {
      stops: count("bus_stops"),
      linkedStops: count(
        "bus_stops",
        "WHERE city_code IS NOT NULL AND node_id IS NOT NULL",
      ),
      routes: count("bus_routes"),
      routeStops: count("bus_route_stops"),
    };
  }
}
