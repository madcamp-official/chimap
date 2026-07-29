import type { AppMigration } from "../migrations.js";

export const PARK_ROUTE_MIGRATION: AppMigration = {
  version: 12,
  name: "reviewed_park_route_snapshots",
  sql: `
    CREATE TABLE park_route_datasets (
      dataset_id text PRIMARY KEY,
      schema_version text NOT NULL,
      region_code text NOT NULL,
      source_system text NOT NULL,
      review_schema_version text NOT NULL,
      dataset_checksum char(64) NOT NULL,
      generated_at timestamptz NOT NULL,
      route_count integer NOT NULL CHECK (route_count > 0),
      status text NOT NULL CHECK (status IN ('STAGING', 'ACTIVE', 'SUPERSEDED')),
      created_at timestamptz NOT NULL DEFAULT now(),
      activated_at timestamptz,
      superseded_at timestamptz
    );

    CREATE TABLE reviewed_park_routes (
      dataset_id text NOT NULL REFERENCES park_route_datasets(dataset_id)
        ON DELETE CASCADE,
      route_id text NOT NULL,
      official_park_id text NOT NULL,
      park_name text NOT NULL,
      route_type text NOT NULL CHECK (route_type IN ('THROUGH', 'LOOP', 'OUT_AND_BACK')),
      direction_policy text NOT NULL CHECK (direction_policy IN ('FORWARD_ONLY', 'BOTH')),
      entry_waypoint_id text NOT NULL,
      exit_waypoint_id text NOT NULL,
      entry_location geography(Point, 4326) NOT NULL,
      exit_location geography(Point, 4326) NOT NULL,
      waypoints jsonb NOT NULL,
      path_waypoint_ids jsonb NOT NULL,
      excluded_waypoint_ids jsonb NOT NULL,
      route_geometry geometry(LineString, 4326) NOT NULL,
      distance_meters integer NOT NULL CHECK (distance_meters > 0),
      duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
      routing_engine text NOT NULL CHECK (routing_engine = 'VALHALLA'),
      routing_costing text NOT NULL CHECK (routing_costing = 'pedestrian'),
      reviewer text NOT NULL,
      reviewed_at timestamptz NOT NULL,
      source_hash char(64) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (dataset_id, route_id),
      CONSTRAINT reviewed_park_routes_geometry CHECK (
        ST_SRID(route_geometry) = 4326
        AND GeometryType(route_geometry) = 'LINESTRING'
        AND ST_NPoints(route_geometry) >= 2
        AND ST_IsValid(route_geometry)
      )
    );

    CREATE INDEX reviewed_park_routes_geometry_gist
      ON reviewed_park_routes USING gist(route_geometry);
    CREATE INDEX reviewed_park_routes_entry_gist
      ON reviewed_park_routes USING gist(entry_location);
    CREATE INDEX reviewed_park_routes_exit_gist
      ON reviewed_park_routes USING gist(exit_location);
    CREATE INDEX reviewed_park_routes_official_park_id
      ON reviewed_park_routes(official_park_id);
    CREATE INDEX reviewed_park_routes_dataset_source_hash
      ON reviewed_park_routes(dataset_id, source_hash);

    CREATE TABLE active_park_route_dataset (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      dataset_id text NOT NULL REFERENCES park_route_datasets(dataset_id),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `,
};
