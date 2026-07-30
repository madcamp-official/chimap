import type {
  Coordinate,
  ParkRouteSnapshot,
  ReviewedParkRoute,
} from "@chimap/contracts";
import type { Pool } from "pg";

export type ActiveParkRouteDataset = {
  datasetId: string;
  datasetChecksum: string;
  generatedAt: string;
  activatedAt: string;
  routeCount: number;
};

export type ParkRouteDirection = {
  datasetId: string;
  routeId: string;
  officialParkId: string;
  parkName: string;
  entry: Coordinate;
  exit: Coordinate;
  coordinates: Coordinate[];
  pathWaypointIds: string[];
  distanceMeters: number;
  durationSeconds: number;
  reversed: boolean;
};

export type ParkRouteImportResult =
  | {
      status: "UNCHANGED";
      previousDatasetId?: never;
      activatedAt?: never;
    }
  | {
      status: "ACTIVATED";
      previousDatasetId: string | null;
      activatedAt: string;
    };

function lineStringGeoJson(route: ReviewedParkRoute): string {
  return JSON.stringify({
    type: "LineString",
    coordinates: route.coordinates.map(({ lng, lat }) => [lng, lat]),
  });
}

export class ParkRouteRepository {
  public constructor(private readonly pool: Pool) {}

  public async activeDataset(): Promise<ActiveParkRouteDataset | null> {
    const result = await this.pool.query<{
      dataset_id: string;
      dataset_checksum: string;
      generated_at: Date;
      activated_at: Date;
      route_count: number;
    }>(
      `SELECT d.dataset_id, d.dataset_checksum, d.generated_at,
              d.activated_at, d.route_count
       FROM active_park_route_dataset AS active
       JOIN park_route_datasets AS d ON d.dataset_id = active.dataset_id
       WHERE active.singleton = true AND d.status = 'ACTIVE'`,
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          datasetId: row.dataset_id,
          datasetChecksum: row.dataset_checksum,
          generatedAt: row.generated_at.toISOString(),
          activatedAt: row.activated_at.toISOString(),
          routeCount: row.route_count,
        };
  }

  public async importSnapshot(
    snapshot: ParkRouteSnapshot,
  ): Promise<ParkRouteImportResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`chimap:park-route-dataset:${snapshot.datasetId}`],
      );
      const existing = await client.query<{ dataset_checksum: string }>(
        `SELECT dataset_checksum
         FROM park_route_datasets
         WHERE dataset_id = $1
         FOR UPDATE`,
        [snapshot.datasetId],
      );
      const existingChecksum = existing.rows[0]?.dataset_checksum;
      if (existingChecksum !== undefined) {
        if (existingChecksum !== snapshot.datasetChecksum) {
          const conflict = new Error(
            "동일 datasetId에 다른 checksum이 이미 존재합니다.",
          );
          Object.assign(conflict, { code: "PARK_DATASET_CONFLICT" });
          throw conflict;
        }
        await client.query("COMMIT");
        return { status: "UNCHANGED" };
      }

      const previous = await client.query<{ dataset_id: string }>(
        `SELECT dataset_id
         FROM active_park_route_dataset
         WHERE singleton = true
         FOR UPDATE`,
      );
      const previousDatasetId = previous.rows[0]?.dataset_id ?? null;
      await client.query(
        `INSERT INTO park_route_datasets(
           dataset_id, schema_version, region_code, source_system,
           review_schema_version, dataset_checksum, generated_at,
           route_count, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'STAGING')`,
        [
          snapshot.datasetId,
          snapshot.schemaVersion,
          snapshot.regionCode,
          snapshot.source.system,
          snapshot.source.reviewSchemaVersion,
          snapshot.datasetChecksum,
          snapshot.generatedAt,
          snapshot.routes.length,
        ],
      );

      let inserted = 0;
      for (const route of snapshot.routes) {
        const result = await client.query(
          `INSERT INTO reviewed_park_routes(
             dataset_id, route_id, official_park_id, park_name,
             route_type, direction_policy, entry_waypoint_id,
             exit_waypoint_id, entry_location, exit_location, waypoints,
             path_waypoint_ids, excluded_waypoint_ids, route_geometry,
             distance_meters, duration_seconds, routing_engine,
             routing_costing, reviewer, reviewed_at, source_hash
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8,
             ST_SetSRID(ST_MakePoint($9, $10), 4326)::geography,
             ST_SetSRID(ST_MakePoint($11, $12), 4326)::geography,
             $13::jsonb, $14::jsonb, $15::jsonb,
             ST_SetSRID(ST_GeomFromGeoJSON($16), 4326),
             $17, $18, $19, $20, $21, $22, $23
           )`,
          [
            snapshot.datasetId,
            route.routeId,
            route.officialParkId,
            route.parkName,
            route.routeType,
            route.directionPolicy,
            route.entry.waypointId,
            route.exit.waypointId,
            route.entry.location.lng,
            route.entry.location.lat,
            route.exit.location.lng,
            route.exit.location.lat,
            JSON.stringify(route.waypoints),
            JSON.stringify(route.pathWaypointIds),
            JSON.stringify(route.excludedWaypointIds),
            lineStringGeoJson(route),
            route.distanceMeters,
            route.durationSeconds,
            route.routing.engine,
            route.routing.costing,
            route.review.reviewer,
            route.review.reviewedAt,
            route.sourceHash,
          ],
        );
        inserted += result.rowCount ?? 0;
      }
      if (inserted !== snapshot.routes.length) {
        throw new Error("선언한 route count와 실제 insert count가 다릅니다.");
      }

      if (previousDatasetId !== null) {
        await client.query(
          `UPDATE park_route_datasets
           SET status = 'SUPERSEDED', superseded_at = now()
           WHERE dataset_id = $1 AND status = 'ACTIVE'`,
          [previousDatasetId],
        );
      }
      const activated = await client.query<{ activated_at: Date }>(
        `UPDATE park_route_datasets
         SET status = 'ACTIVE', activated_at = now()
         WHERE dataset_id = $1
         RETURNING activated_at`,
        [snapshot.datasetId],
      );
      await client.query(
        `INSERT INTO active_park_route_dataset(singleton, dataset_id, updated_at)
         VALUES (true, $1, now())
         ON CONFLICT (singleton) DO UPDATE
         SET dataset_id = EXCLUDED.dataset_id, updated_at = EXCLUDED.updated_at`,
        [snapshot.datasetId],
      );
      await client.query("COMMIT");
      return {
        status: "ACTIVATED",
        previousDatasetId,
        activatedAt: activated.rows[0]!.activated_at.toISOString(),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async findNearRoute(input: {
    coordinates: Coordinate[];
    radiusMeters: number;
    limit: number;
  }): Promise<ParkRouteDirection[]> {
    if (input.coordinates.length < 2) return [];
    const routeGeoJson = JSON.stringify({
      type: "LineString",
      coordinates: input.coordinates.map(({ lng, lat }) => [lng, lat]),
    });
    const result = await this.pool.query<{
      dataset_id: string;
      route_id: string;
      official_park_id: string;
      park_name: string;
      direction_policy: "FORWARD_ONLY" | "BOTH";
      entry_lng: number;
      entry_lat: number;
      exit_lng: number;
      exit_lat: number;
      coordinates: { coordinates: [number, number][] };
      path_waypoint_ids: string[];
      distance_meters: number;
      duration_seconds: number;
    }>(
      `WITH requested_route AS (
         SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography AS geometry
       )
       SELECT r.dataset_id, r.route_id, r.official_park_id, r.park_name,
              r.direction_policy,
              ST_X(r.entry_location::geometry) AS entry_lng,
              ST_Y(r.entry_location::geometry) AS entry_lat,
              ST_X(r.exit_location::geometry) AS exit_lng,
              ST_Y(r.exit_location::geometry) AS exit_lat,
              ST_AsGeoJSON(r.route_geometry, 15)::json AS coordinates,
              r.path_waypoint_ids, r.distance_meters, r.duration_seconds
       FROM requested_route
       CROSS JOIN active_park_route_dataset AS active
       JOIN park_route_datasets AS d
         ON d.dataset_id = active.dataset_id AND d.status = 'ACTIVE'
       JOIN reviewed_park_routes AS r ON r.dataset_id = d.dataset_id
       WHERE active.singleton = true
         AND (
           ST_DWithin(r.entry_location, requested_route.geometry, $2)
           OR ST_DWithin(r.exit_location, requested_route.geometry, $2)
         )
       ORDER BY LEAST(
         ST_Distance(r.entry_location, requested_route.geometry),
         ST_Distance(r.exit_location, requested_route.geometry)
       ), r.distance_meters DESC
       LIMIT $3`,
      [routeGeoJson, input.radiusMeters, input.limit],
    );
    return result.rows.flatMap((row) => {
      const entry = { lng: Number(row.entry_lng), lat: Number(row.entry_lat) };
      const exit = { lng: Number(row.exit_lng), lat: Number(row.exit_lat) };
      const coordinates = row.coordinates.coordinates.map(([lng, lat]) => ({
        lng,
        lat,
      }));
      const forward: ParkRouteDirection = {
        datasetId: row.dataset_id,
        routeId: row.route_id,
        officialParkId: row.official_park_id,
        parkName: row.park_name,
        entry,
        exit,
        coordinates,
        pathWaypointIds: row.path_waypoint_ids,
        distanceMeters: row.distance_meters,
        durationSeconds: row.duration_seconds,
        reversed: false,
      };
      return row.direction_policy === "BOTH"
        ? [
            forward,
            {
              ...forward,
              entry: exit,
              exit: entry,
              coordinates: [...coordinates].reverse(),
              pathWaypointIds: [...row.path_waypoint_ids].reverse(),
              reversed: true,
            },
          ]
        : [forward];
    });
  }
}
