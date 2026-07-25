export const TRANSIT_MIGRATIONS: ReadonlyArray<{
  version: number;
  sql: string;
}> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bus_stops (
        id INTEGER PRIMARY KEY,
        city_code TEXT,
        node_id TEXT,
        source_stop_no TEXT,
        ars_id TEXT,
        region_name TEXT,
        name TEXT NOT NULL,
        latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
        source TEXT NOT NULL CHECK (source IN ('csv', 'tago')),
        source_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS bus_stops_city_node_unique
        ON bus_stops(city_code, node_id)
        WHERE city_code IS NOT NULL AND node_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS bus_stops_csv_identity_unique
        ON bus_stops(source, source_stop_no, name, latitude, longitude)
        WHERE source = 'csv' AND source_stop_no IS NOT NULL;
      CREATE INDEX IF NOT EXISTS bus_stops_coordinate_index
        ON bus_stops(latitude, longitude);
      CREATE INDEX IF NOT EXISTS bus_stops_source_stop_no_index
        ON bus_stops(source_stop_no);

      CREATE TABLE IF NOT EXISTS bus_routes (
        id INTEGER PRIMARY KEY,
        city_code TEXT NOT NULL,
        route_id TEXT NOT NULL,
        route_no TEXT NOT NULL,
        route_name TEXT NOT NULL,
        route_type TEXT,
        start_stop_name TEXT,
        end_stop_name TEXT,
        first_bus_time TEXT,
        last_bus_time TEXT,
        weekday_interval_minutes INTEGER,
        weekend_interval_minutes INTEGER,
        source_updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(city_code, route_id)
      );
      CREATE INDEX IF NOT EXISTS bus_routes_number_index
        ON bus_routes(city_code, route_no);

      CREATE TABLE IF NOT EXISTS bus_route_stops (
        route_internal_id INTEGER NOT NULL
          REFERENCES bus_routes(id) ON DELETE CASCADE,
        stop_internal_id INTEGER NOT NULL
          REFERENCES bus_stops(id) ON DELETE CASCADE,
        node_order INTEGER NOT NULL,
        direction TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(route_internal_id, stop_internal_id, node_order),
        UNIQUE(route_internal_id, node_order)
      );
      CREATE INDEX IF NOT EXISTS bus_route_stops_stop_index
        ON bus_route_stops(stop_internal_id);
    `,
  },
];
