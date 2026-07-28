export const TRANSIT_MIGRATIONS: ReadonlyArray<{
  version: number;
  name: string;
  sql: string;
}> = [
  {
    version: 1,
    name: "transit_postgis",
    sql: `
      CREATE EXTENSION IF NOT EXISTS postgis;

      CREATE TABLE IF NOT EXISTS bus_stops (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        city_code varchar(20),
        node_id varchar(100),
        source_stop_no varchar(100),
        ars_id varchar(100),
        region_name varchar(200),
        name varchar(200) NOT NULL,
        location geography(Point, 4326) NOT NULL,
        source varchar(20) NOT NULL CHECK (source IN ('csv', 'tago')),
        source_identity text,
        source_updated_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS bus_stops_city_node_unique
        ON bus_stops(city_code, node_id)
        WHERE city_code IS NOT NULL AND node_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS bus_stops_source_identity_unique
        ON bus_stops(source_identity)
        WHERE source_identity IS NOT NULL;
      CREATE INDEX IF NOT EXISTS bus_stops_location_gist
        ON bus_stops USING gist(location);
      CREATE INDEX IF NOT EXISTS bus_stops_source_stop_no_index
        ON bus_stops(source_stop_no);

      CREATE TABLE IF NOT EXISTS bus_routes (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        city_code varchar(20) NOT NULL,
        route_id varchar(100) NOT NULL,
        route_no varchar(100) NOT NULL,
        route_name varchar(200) NOT NULL,
        route_type varchar(100),
        start_stop_name varchar(200),
        end_stop_name varchar(200),
        first_bus_time varchar(20),
        last_bus_time varchar(20),
        weekday_interval_minutes integer
          CHECK (weekday_interval_minutes IS NULL OR weekday_interval_minutes > 0),
        weekend_interval_minutes integer
          CHECK (weekend_interval_minutes IS NULL OR weekend_interval_minutes > 0),
        source_updated_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE(city_code, route_id)
      );
      CREATE INDEX IF NOT EXISTS bus_routes_number_index
        ON bus_routes(city_code, route_no);

      CREATE TABLE IF NOT EXISTS bus_route_stops (
        route_internal_id bigint NOT NULL
          REFERENCES bus_routes(id) ON DELETE CASCADE,
        stop_internal_id bigint NOT NULL
          REFERENCES bus_stops(id) ON DELETE CASCADE,
        node_order integer NOT NULL CHECK (node_order >= 0),
        direction varchar(100),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY(route_internal_id, stop_internal_id, node_order),
        UNIQUE(route_internal_id, node_order)
      );
      CREATE INDEX IF NOT EXISTS bus_route_stops_stop_index
        ON bus_route_stops(stop_internal_id);
    `,
  },
  {
    version: 2,
    name: "merge_exact_tago_stop_numbers",
    sql: `
      CREATE TEMP TABLE exact_stop_merges ON COMMIT DROP AS
      SELECT
        csv.id AS keep_id,
        tago.id AS remove_id,
        tago.city_code,
        tago.node_id,
        tago.ars_id,
        tago.name,
        tago.location,
        tago.source_updated_at
      FROM bus_stops AS csv
      JOIN bus_stops AS tago
        ON csv.node_id IS NULL
       AND csv.source_stop_no = tago.node_id
       AND tago.city_code IS NOT NULL
       AND tago.node_id IS NOT NULL;

      UPDATE bus_route_stops AS relation
      SET stop_internal_id = merge.keep_id,
          updated_at = now()
      FROM exact_stop_merges AS merge
      WHERE relation.stop_internal_id = merge.remove_id;

      DELETE FROM bus_stops AS stop
      USING exact_stop_merges AS merge
      WHERE stop.id = merge.remove_id;

      UPDATE bus_stops AS stop
      SET city_code = merge.city_code,
          node_id = merge.node_id,
          ars_id = COALESCE(merge.ars_id, stop.ars_id),
          name = merge.name,
          location = merge.location,
          source_updated_at = merge.source_updated_at,
          updated_at = now()
      FROM exact_stop_merges AS merge
      WHERE stop.id = merge.keep_id;
    `,
  },
  {
    version: 3,
    name: "kakao_users_and_sessions",
    sql: `
      CREATE TABLE IF NOT EXISTS app_users (
        id uuid PRIMARY KEY,
        display_name varchar(100),
        profile_image_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_login_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS oauth_accounts (
        provider varchar(20) NOT NULL CHECK (provider IN ('KAKAO')),
        provider_user_id varchar(100) NOT NULL,
        user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(provider, provider_user_id),
        UNIQUE(provider, user_id)
      );
      CREATE INDEX IF NOT EXISTS oauth_accounts_user_index
        ON oauth_accounts(user_id);

      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash char(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_index
        ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry_index
        ON auth_sessions(expires_at);
    `,
  },
  {
    version: 7,
    name: "subway_station_lines",
    sql: `
      CREATE TABLE IF NOT EXISTS subway_station_lines (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        station_code varchar(50) NOT NULL,
        station_name varchar(200) NOT NULL,
        line_code varchar(50) NOT NULL,
        line_name varchar(200) NOT NULL,
        english_name varchar(200),
        hanja_name varchar(200),
        transfer_type varchar(100),
        transfer_line_code varchar(200),
        transfer_line_name varchar(500),
        location geography(Point, 4326) NOT NULL,
        operator_name varchar(200) NOT NULL,
        road_address varchar(500),
        phone_number varchar(100),
        data_date text NOT NULL,
        tago_station_id varchar(100),
        tago_route_name varchar(200),
        mapping_status varchar(20) NOT NULL DEFAULT 'PENDING'
          CHECK (mapping_status IN ('PENDING', 'MAPPED', 'UNRESOLVED')),
        mapping_checked_at timestamptz,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(station_code, line_code, line_name, operator_name)
      );

      CREATE INDEX IF NOT EXISTS subway_station_lines_location_gist
        ON subway_station_lines USING gist(location);
      CREATE INDEX IF NOT EXISTS subway_station_lines_name_index
        ON subway_station_lines(lower(station_name));
      CREATE INDEX IF NOT EXISTS subway_station_lines_tago_station_index
        ON subway_station_lines(tago_station_id)
        WHERE tago_station_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS subway_station_lines_mapping_index
        ON subway_station_lines(mapping_status, active);
    `,
  },
  {
    version: 8,
    name: "subway_routing_topology",
    sql: `
      CREATE TABLE IF NOT EXISTS subway_service_lines (
        service_line_id varchar(32) PRIMARY KEY,
        region_code varchar(10) NOT NULL,
        region_name varchar(50) NOT NULL,
        operator_name varchar(100) NOT NULL,
        service_line_name varchar(100) NOT NULL,
        station_count integer NOT NULL CHECK (station_count >= 1),
        matched_station_count integer NOT NULL CHECK (matched_station_count >= 0),
        segment_count integer NOT NULL CHECK (segment_count >= 0),
        fallback_headway_count integer NOT NULL CHECK (fallback_headway_count >= 0),
        is_branching boolean NOT NULL,
        is_route_ready boolean NOT NULL,
        timing_provider_default varchar(30) NOT NULL,
        imported_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS subway_line_stations (
        service_line_id varchar(32) NOT NULL
          REFERENCES subway_service_lines(service_line_id) ON DELETE CASCADE,
        station_order integer NOT NULL CHECK (station_order > 0),
        order_conflict boolean NOT NULL,
        source_line_id varchar(50) NOT NULL,
        source_station_id varchar(50) NOT NULL,
        source_station_key varchar(120) NOT NULL,
        station_name varchar(120) NOT NULL,
        PRIMARY KEY(service_line_id, source_station_key),
        UNIQUE(service_line_id, station_order, source_station_key)
      );
      CREATE INDEX IF NOT EXISTS subway_line_stations_station_index
        ON subway_line_stations(source_station_key);

      CREATE TABLE IF NOT EXISTS subway_segments (
        service_line_id varchar(32) NOT NULL
          REFERENCES subway_service_lines(service_line_id) ON DELETE CASCADE,
        from_source_station_key varchar(120) NOT NULL,
        to_source_station_key varchar(120) NOT NULL,
        duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
        average_duration_seconds integer NOT NULL CHECK (average_duration_seconds > 0),
        straight_distance_meters integer NOT NULL CHECK (straight_distance_meters >= 0),
        sample_count integer NOT NULL CHECK (sample_count >= 0),
        duration_method varchar(40) NOT NULL,
        PRIMARY KEY(service_line_id, from_source_station_key, to_source_station_key)
      );
      CREATE INDEX IF NOT EXISTS subway_segments_from_index
        ON subway_segments(from_source_station_key);

      CREATE TABLE IF NOT EXISTS subway_headways_fallback (
        service_line_id varchar(32) NOT NULL
          REFERENCES subway_service_lines(service_line_id) ON DELETE CASCADE,
        source_station_key varchar(120) NOT NULL,
        next_source_station_key varchar(120) NOT NULL,
        day_group varchar(30) NOT NULL,
        time_period varchar(30) NOT NULL,
        median_headway_seconds integer NOT NULL CHECK (median_headway_seconds > 0),
        expected_wait_seconds integer NOT NULL CHECK (expected_wait_seconds >= 0),
        departure_count integer NOT NULL CHECK (departure_count >= 0),
        interval_sample_count integer NOT NULL CHECK (interval_sample_count >= 0),
        PRIMARY KEY(
          service_line_id, source_station_key, next_source_station_key,
          day_group, time_period
        )
      );

      CREATE TABLE IF NOT EXISTS subway_transfer_edges (
        from_source_station_key varchar(120) NOT NULL,
        to_source_station_key varchar(120) NOT NULL,
        transfer_duration_seconds integer NOT NULL
          CHECK (transfer_duration_seconds > 0),
        straight_distance_meters integer NOT NULL
          CHECK (straight_distance_meters >= 0),
        duration_is_estimated boolean NOT NULL,
        PRIMARY KEY(from_source_station_key, to_source_station_key)
      );
      CREATE INDEX IF NOT EXISTS subway_transfer_edges_from_index
        ON subway_transfer_edges(from_source_station_key);
    `,
  },
  {
    version: 9,
    name: "request_scoped_multimodal_routing",
    sql: `
      ALTER TABLE subway_service_lines
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE subway_line_stations
        ADD COLUMN IF NOT EXISTS station_line_id bigint,
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE subway_segments
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE subway_headways_fallback
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE subway_transfer_edges
        ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

      WITH candidate AS (
        SELECT
          line_station.service_line_id,
          line_station.source_station_key,
          min(station.id) AS station_line_id
        FROM subway_line_stations AS line_station
        JOIN subway_station_lines AS station
          ON station.line_code = line_station.source_line_id
         AND station.station_code = line_station.source_station_id
        WHERE line_station.station_line_id IS NULL
        GROUP BY line_station.service_line_id, line_station.source_station_key
        HAVING COUNT(*) = 1
      )
      UPDATE subway_line_stations AS line_station
      SET station_line_id = candidate.station_line_id,
          updated_at = now()
      FROM candidate
      WHERE line_station.service_line_id = candidate.service_line_id
        AND line_station.source_station_key = candidate.source_station_key;

      WITH candidate AS (
        SELECT DISTINCT ON (
          line_station.service_line_id, line_station.source_station_key
        )
          line_station.service_line_id,
          line_station.source_station_key,
          station.id AS station_line_id
        FROM subway_line_stations AS line_station
        JOIN subway_service_lines AS service_line
          ON service_line.service_line_id = line_station.service_line_id
        JOIN subway_station_lines AS station
          ON station.line_code = line_station.source_line_id
         AND station.station_code = line_station.source_station_id
         AND regexp_replace(
               lower(station.line_name),
               '(도시철도|수도권|광역철도|서울교통공사|코레일|선|\\s)',
               '', 'g'
             ) = regexp_replace(
               lower(service_line.service_line_name),
               '(도시철도|수도권|광역철도|서울교통공사|코레일|선|\\s)',
               '', 'g'
             )
        WHERE line_station.station_line_id IS NULL
        ORDER BY
          line_station.service_line_id,
          line_station.source_station_key,
          station.active DESC,
          station.data_date DESC,
          station.id
      )
      UPDATE subway_line_stations AS line_station
      SET station_line_id = candidate.station_line_id,
          updated_at = now()
      FROM candidate
      WHERE line_station.service_line_id = candidate.service_line_id
        AND line_station.source_station_key = candidate.source_station_key;

      DO $$
      DECLARE
        unresolved_count bigint;
      BEGIN
        SELECT COUNT(*) INTO unresolved_count
        FROM subway_line_stations
        WHERE station_line_id IS NULL;
        IF unresolved_count > 0 THEN
          RAISE EXCEPTION
            'subway_line_stations station_line_id backfill unresolved: %',
            unresolved_count;
        END IF;
      END $$;

      ALTER TABLE subway_line_stations
        ALTER COLUMN station_line_id SET NOT NULL;
      ALTER TABLE subway_line_stations
        ADD CONSTRAINT subway_line_stations_station_line_fk
        FOREIGN KEY (station_line_id)
        REFERENCES subway_station_lines(id) ON DELETE RESTRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS subway_line_stations_service_station_unique
        ON subway_line_stations(service_line_id, station_line_id);
      CREATE INDEX IF NOT EXISTS subway_line_stations_station_line_index
        ON subway_line_stations(station_line_id);

      CREATE TABLE IF NOT EXISTS subway_provider_station_mappings (
        service_line_id varchar(32) NOT NULL,
        station_line_id bigint NOT NULL,
        provider varchar(20) NOT NULL
          CHECK (provider IN ('TAGO', 'SEOUL')),
        query_station_name varchar(200) NOT NULL,
        external_station_id varchar(100),
        external_line_id varchar(100),
        external_line_name varchar(200),
        mapping_status varchar(20) NOT NULL DEFAULT 'PENDING'
          CHECK (
            mapping_status IN (
              'PENDING', 'MAPPED', 'AMBIGUOUS', 'NOT_FOUND', 'DISABLED'
            )
          ),
        priority smallint NOT NULL DEFAULT 100 CHECK (priority >= 0),
        mapping_checked_at timestamptz,
        last_success_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(service_line_id, station_line_id, provider),
        FOREIGN KEY (service_line_id, station_line_id)
          REFERENCES subway_line_stations(service_line_id, station_line_id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS subway_provider_station_status_index
        ON subway_provider_station_mappings(provider, mapping_status);

      INSERT INTO subway_provider_station_mappings(
        service_line_id, station_line_id, provider, query_station_name,
        external_station_id, external_line_name, mapping_status,
        priority, mapping_checked_at, last_success_at
      )
      SELECT
        line_station.service_line_id,
        line_station.station_line_id,
        'TAGO',
        station.station_name,
        station.tago_station_id,
        station.tago_route_name,
        CASE
          WHEN station.mapping_status = 'MAPPED'
            AND station.tago_station_id IS NOT NULL THEN 'MAPPED'
          WHEN station.mapping_status = 'UNRESOLVED' THEN 'NOT_FOUND'
          ELSE 'PENDING'
        END,
        200,
        station.mapping_checked_at,
        CASE
          WHEN station.mapping_status = 'MAPPED' THEN station.mapping_checked_at
          ELSE NULL
        END
      FROM subway_line_stations AS line_station
      JOIN subway_station_lines AS station
        ON station.id = line_station.station_line_id
      ON CONFLICT(service_line_id, station_line_id, provider) DO NOTHING;

      CREATE TABLE IF NOT EXISTS subway_provider_direction_mappings (
        service_line_id varchar(32) NOT NULL,
        from_source_station_key varchar(120) NOT NULL,
        to_source_station_key varchar(120) NOT NULL,
        provider varchar(20) NOT NULL
          CHECK (provider IN ('TAGO', 'SEOUL')),
        external_direction_code varchar(30),
        destination_name varchar(200),
        mapping_status varchar(20) NOT NULL DEFAULT 'PENDING'
          CHECK (
            mapping_status IN (
              'PENDING', 'MAPPED', 'AMBIGUOUS', 'NOT_FOUND', 'DISABLED'
            )
          ),
        mapping_checked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(
          service_line_id, from_source_station_key,
          to_source_station_key, provider
        ),
        FOREIGN KEY (
          service_line_id, from_source_station_key,
          to_source_station_key
        ) REFERENCES subway_segments(
          service_line_id, from_source_station_key,
          to_source_station_key
        ) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS bus_subway_transfer_build_runs (
        id varchar(100) PRIMARY KEY,
        status varchar(20) NOT NULL
          CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
        candidate_count integer NOT NULL DEFAULT 0,
        processed_count integer NOT NULL DEFAULT 0,
        saved_count integer NOT NULL DEFAULT 0,
        skipped_count integer NOT NULL DEFAULT 0,
        failed_count integer NOT NULL DEFAULT 0,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS bus_subway_transfer_edges (
        bus_stop_id bigint NOT NULL REFERENCES bus_stops(id) ON DELETE CASCADE,
        station_line_id bigint NOT NULL
          REFERENCES subway_station_lines(id) ON DELETE CASCADE,
        walk_distance_meters integer NOT NULL
          CHECK (walk_distance_meters >= 0 AND walk_distance_meters <= 500),
        walk_duration_seconds integer NOT NULL
          CHECK (walk_duration_seconds >= 0),
        walking_geometry geometry(LineString, 4326) NOT NULL,
        tago_verified boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        source_hash char(64) NOT NULL,
        build_run_id varchar(100)
          REFERENCES bus_subway_transfer_build_runs(id) ON DELETE SET NULL,
        calculated_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(bus_stop_id, station_line_id)
      );
      CREATE INDEX IF NOT EXISTS bus_subway_transfer_station_index
        ON bus_subway_transfer_edges(station_line_id)
        WHERE active = true;
      CREATE INDEX IF NOT EXISTS bus_subway_transfer_stop_index
        ON bus_subway_transfer_edges(bus_stop_id)
        WHERE active = true;

      CREATE TABLE IF NOT EXISTS transit_dataset_versions (
        dataset varchar(50) PRIMARY KEY,
        generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
        checksum char(64),
        row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
        imported_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO transit_dataset_versions(dataset, generation, row_counts)
      VALUES ('subway_topology', 1, '{}'::jsonb)
      ON CONFLICT(dataset) DO NOTHING;
    `,
  },
  {
    version: 10,
    name: "subway_track_geometry",
    sql: `
      ALTER TABLE subway_segments
        ADD COLUMN IF NOT EXISTS track_geometry geometry(LineString, 4326),
        ADD COLUMN IF NOT EXISTS track_distance_meters integer,
        ADD COLUMN IF NOT EXISTS geometry_source varchar(160),
        ADD COLUMN IF NOT EXISTS geometry_license varchar(240),
        ADD COLUMN IF NOT EXISTS geometry_version varchar(120),
        ADD COLUMN IF NOT EXISTS geometry_updated_at timestamptz;

      ALTER TABLE subway_segments
        ADD CONSTRAINT subway_segments_track_distance_check
          CHECK (
            track_distance_meters IS NULL OR track_distance_meters > 0
          ),
        ADD CONSTRAINT subway_segments_track_geometry_check
          CHECK (
            track_geometry IS NULL OR (
              ST_SRID(track_geometry) = 4326
              AND GeometryType(track_geometry) = 'LINESTRING'
              AND ST_NPoints(track_geometry) >= 2
            )
          ),
        ADD CONSTRAINT subway_segments_track_metadata_check
          CHECK (
            (
              track_geometry IS NULL
              AND track_distance_meters IS NULL
              AND geometry_source IS NULL
              AND geometry_license IS NULL
              AND geometry_version IS NULL
              AND geometry_updated_at IS NULL
            ) OR (
              track_geometry IS NOT NULL
              AND track_distance_meters IS NOT NULL
              AND geometry_source IS NOT NULL
              AND length(trim(geometry_source)) > 0
              AND geometry_license IS NOT NULL
              AND length(trim(geometry_license)) > 0
              AND geometry_version IS NOT NULL
              AND length(trim(geometry_version)) > 0
              AND geometry_updated_at IS NOT NULL
            )
          );
    `,
  },
  {
    version: 11,
    name: "bus_segment_geometries",
    sql: `
      CREATE TABLE IF NOT EXISTS bus_segment_geometries (
        route_internal_id bigint NOT NULL
          REFERENCES bus_routes(id) ON DELETE CASCADE,
        from_node_order integer NOT NULL CHECK (from_node_order >= 0),
        to_node_order integer NOT NULL CHECK (to_node_order > from_node_order),
        road_geometry geometry(LineString, 4326) NOT NULL,
        distance_meters integer NOT NULL CHECK (distance_meters > 0),
        geometry_source varchar(60) NOT NULL,
        geometry_version varchar(80) NOT NULL,
        source_hash char(64) NOT NULL,
        fresh_until timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        last_used_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(route_internal_id, from_node_order, to_node_order),
        CHECK (expires_at > fresh_until),
        CHECK (
          ST_SRID(road_geometry) = 4326
          AND GeometryType(road_geometry) = 'LINESTRING'
          AND ST_NPoints(road_geometry) >= 2
          AND ST_IsValid(road_geometry)
        )
      );
      CREATE INDEX IF NOT EXISTS bus_segment_geometries_expiry_index
        ON bus_segment_geometries(expires_at);
    `,
  },
];
