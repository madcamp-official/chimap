CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version bigint PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

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
