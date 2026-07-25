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
];
