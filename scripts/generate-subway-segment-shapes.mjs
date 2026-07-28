import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_SOURCE_URL =
  "https://api.openstreetmap.org/api/0.6/relation/{relationId}/full.json";
const ENDPOINT_TOLERANCE_METERS = 250;
const WAY_JOIN_TOLERANCE_METERS = 100;

function delay(milliseconds) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function haversine(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.lat - first.lat);
  const longitudeDelta = radians(second.lng - first.lng);
  const firstLatitude = radians(first.lat);
  const secondLatitude = radians(second.lat);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return (
    2 *
    6_371_000 *
    Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
}

function distinctCoordinates(coordinates) {
  const result = [];
  for (const coordinate of coordinates) {
    if (
      result.length === 0 ||
      haversine(result.at(-1), coordinate) > 0.05
    ) {
      result.push(coordinate);
    }
  }
  return result;
}

function relationPolyline(relation) {
  const wayMembers = relation.members.filter(
    (member) =>
      member.type === "way" &&
      member.role !== "platform" &&
      member.role !== "stop" &&
      Array.isArray(member.geometry) &&
      member.geometry.length >= 2,
  );
  if (wayMembers.length === 0) {
    throw new Error(`OSM relation ${relation.id}: geometry way가 없습니다.`);
  }
  const firstStop = relation.members.find(
    (member) =>
      member.type === "node" &&
      member.role === "stop" &&
      Number.isFinite(member.lat) &&
      Number.isFinite(member.lon),
  );
  let result = [];
  for (const [index, member] of wayMembers.entries()) {
    let coordinates = member.geometry.map(({ lat, lon }) => ({ lat, lng: lon }));
    if (index === 0 && wayMembers.length > 1) {
      const next = wayMembers[1].geometry.map(({ lat, lon }) => ({
        lat,
        lng: lon,
      }));
      const directGap = Math.min(
        haversine(coordinates.at(-1), next[0]),
        haversine(coordinates.at(-1), next.at(-1)),
      );
      const reverseGap = Math.min(
        haversine(coordinates[0], next[0]),
        haversine(coordinates[0], next.at(-1)),
      );
      if (reverseGap < directGap) {
        coordinates = coordinates.reverse();
      }
    } else if (index === 0 && firstStop !== undefined) {
      const stop = { lat: firstStop.lat, lng: firstStop.lon };
      if (haversine(coordinates.at(-1), stop) < haversine(coordinates[0], stop)) {
        coordinates = coordinates.reverse();
      }
    } else if (result.length > 0) {
      const directGap = haversine(result.at(-1), coordinates[0]);
      const reverseGap = haversine(result.at(-1), coordinates.at(-1));
      if (reverseGap < directGap) {
        coordinates = coordinates.reverse();
      }
      const gap = haversine(result.at(-1), coordinates[0]);
      if (gap > WAY_JOIN_TOLERANCE_METERS) {
        throw new Error(
          `OSM relation ${relation.id}: way ${member.ref} 연결 간격이 ${Math.round(gap)}m입니다.`,
        );
      }
    }
    result = [
      ...result,
      ...coordinates.slice(result.length === 0 ? 0 : 1),
    ];
  }
  return distinctCoordinates(result);
}

function hydrateRelation(response, relationId) {
  const relation = response.elements?.find(
    (element) => element.type === "relation" && element.id === relationId,
  );
  if (relation === undefined) {
    throw new Error(`OSM relation ${relationId} 응답이 비어 있습니다.`);
  }
  const nodes = new Map(
    response.elements
      .filter((element) => element.type === "node")
      .map((node) => [node.id, node]),
  );
  const ways = new Map(
    response.elements
      .filter((element) => element.type === "way")
      .map((way) => [way.id, way]),
  );
  return {
    ...relation,
    members: relation.members.map((member) => {
      if (member.type === "node" && !Number.isFinite(member.lat)) {
        const node = nodes.get(member.ref);
        return node === undefined
          ? member
          : { ...member, lat: node.lat, lon: node.lon };
      }
      if (member.type === "way" && !Array.isArray(member.geometry)) {
        const way = ways.get(member.ref);
        const geometry = way?.nodes?.map((nodeId) => nodes.get(nodeId));
        return geometry === undefined || geometry.some((node) => node === undefined)
          ? member
          : {
              ...member,
              geometry: geometry.map((node) => ({ lat: node.lat, lon: node.lon })),
            };
      }
      return member;
    }),
  };
}

function cumulativeDistances(polyline) {
  const values = [0];
  for (let index = 1; index < polyline.length; index += 1) {
    values.push(values.at(-1) + haversine(polyline[index - 1], polyline[index]));
  }
  return values;
}

function nearestLocation(polyline, cumulative, point) {
  const latitudeScale = 110_540;
  const longitudeScale =
    111_320 * Math.cos((point.lat * Math.PI) / 180);
  let best;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const from = polyline[index];
    const to = polyline[index + 1];
    const dx = (to.lng - from.lng) * longitudeScale;
    const dy = (to.lat - from.lat) * latitudeScale;
    const px = (point.lng - from.lng) * longitudeScale;
    const py = (point.lat - from.lat) * latitudeScale;
    const denominator = dx * dx + dy * dy;
    const t =
      denominator === 0
        ? 0
        : Math.max(0, Math.min(1, (px * dx + py * dy) / denominator));
    const snapped = {
      lng: from.lng + (to.lng - from.lng) * t,
      lat: from.lat + (to.lat - from.lat) * t,
    };
    const distance = haversine(point, snapped);
    if (best === undefined || distance < best.distance) {
      best = {
        segmentIndex: index,
        t,
        coordinate: snapped,
        distance,
        position:
          cumulative[index] +
          haversine(polyline[index], snapped),
      };
    }
  }
  return best;
}

function sliceForward(polyline, from, to) {
  if (to.position <= from.position) {
    return null;
  }
  const coordinates = [from.coordinate];
  for (
    let index = from.segmentIndex + 1;
    index <= to.segmentIndex;
    index += 1
  ) {
    coordinates.push(polyline[index]);
  }
  coordinates.push(to.coordinate);
  return distinctCoordinates(coordinates);
}

function sliceCandidate(polyline, fromPoint, toPoint) {
  const cumulative = cumulativeDistances(polyline);
  const from = nearestLocation(polyline, cumulative, fromPoint);
  const to = nearestLocation(polyline, cumulative, toPoint);
  if (
    from.distance > ENDPOINT_TOLERANCE_METERS ||
    to.distance > ENDPOINT_TOLERANCE_METERS
  ) {
    return null;
  }
  let coordinates = sliceForward(polyline, from, to);
  const closed = haversine(polyline[0], polyline.at(-1)) <= 100;
  if (coordinates === null && closed) {
    const end = {
      segmentIndex: polyline.length - 2,
      coordinate: polyline.at(-1),
      position: cumulative.at(-1),
    };
    const start = {
      segmentIndex: 0,
      coordinate: polyline[0],
      position: 0,
    };
    const first = sliceForward(polyline, from, end);
    const second = sliceForward(polyline, start, to);
    if (first !== null && second !== null) {
      coordinates = distinctCoordinates([...first, ...second]);
    }
  }
  if (coordinates === null || coordinates.length < 2) {
    return null;
  }
  return {
    coordinates,
    endpointError: from.distance + to.distance,
    distanceMeters: cumulativeDistances(coordinates).at(-1),
  };
}

async function fetchRelation(relationId, cacheDirectory, sourceUrl) {
  const cachePath = resolve(cacheDirectory, `${relationId}.json`);
  let source;
  try {
    source = await readFile(cachePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    let lastError;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const isRelationApi = sourceUrl.includes("{relationId}");
        const query = `[out:json][timeout:120];relation(${relationId});out geom;`;
        const response = await fetch(sourceUrl.replace("{relationId}", String(relationId)), {
          method: isRelationApi ? "GET" : "POST",
          headers: isRelationApi
            ? { "user-agent": "CHIMap/0.1 subway geometry importer" }
            : {
                "content-type": "application/x-www-form-urlencoded",
                "user-agent": "CHIMap/0.1 subway geometry importer",
              },
          ...(isRelationApi ? {} : { body: new URLSearchParams({ data: query }) }),
          signal: AbortSignal.timeout(180_000),
        });
        if (!response.ok) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterSeconds =
            retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
          const error = new Error(`HTTP ${response.status}`);
          error.retryAfterMilliseconds = Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds * 1_000
            : undefined;
          throw error;
        }
        source = await response.text();
        await writeFile(cachePath, source);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 8) {
          const backoff = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
          await delay(error.retryAfterMilliseconds ?? backoff);
        }
      }
    }
    if (lastError !== undefined) {
      throw new Error(`OSM relation ${relationId} 조회 실패`, {
        cause: lastError,
      });
    }
  }
  const response = JSON.parse(source);
  const relation = hydrateRelation(response, relationId);
  const polyline = relationPolyline(relation);
  return {
    relationId,
    polyline,
    reversePolyline: [...polyline].reverse(),
    timestamp: response.osm3s?.timestamp_osm_base ?? relation.timestamp,
    hash: createHash("sha256").update(source).digest("hex"),
  };
}

async function concurrentMap(values, concurrency, task) {
  const result = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await task(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return result;
}

const dataDirectory = resolve(argument("data-dir", "data"));
const cacheDirectory = resolve(
  argument("cache-dir", "/tmp/chimap-osm-route-relations"),
);
const sourceUrl = argument("source-url", DEFAULT_SOURCE_URL);
await mkdir(cacheDirectory, { recursive: true });

const [manifest, serviceRows, stationRows, segmentRows] = await Promise.all([
  readFile(resolve(dataDirectory, "subway_geometry_sources.json"), "utf8").then(
    JSON.parse,
  ),
  readFile(resolve(dataDirectory, "subway_service_lines.csv"), "utf8").then(
    (text) => parseCsv(text.replace(/^\uFEFF/u, "")),
  ),
  readFile(resolve(dataDirectory, "subway_data.csv"), "utf8").then((text) =>
    parseCsv(text.replace(/^\uFEFF/u, "")),
  ),
  readFile(resolve(dataDirectory, "subway_segments.csv"), "utf8").then(
    (text) => parseCsv(text.replace(/^\uFEFF/u, "")),
  ),
]);

const routeReadyIds = new Set(
  serviceRows
    .slice(1)
    .filter((row) => row[10]?.toLocaleLowerCase() === "true")
    .map((row) => row[0]),
);
const routeReadyServiceRows = serviceRows
  .slice(1)
  .filter((row) => routeReadyIds.has(row[0]));
const mappings = new Map(
  manifest.mappings.map((mapping) => [mapping.service_line_id, mapping]),
);
for (const serviceLineId of routeReadyIds) {
  if (!mappings.has(serviceLineId)) {
    throw new Error(`노선 ${serviceLineId}: OSM relation mapping이 없습니다.`);
  }
}
const stationCoordinates = new Map();
for (const row of stationRows.slice(1)) {
  const key = `${row[2]}|${row[0]}`;
  const coordinate = { lat: Number(row[9]), lng: Number(row[10]) };
  const values = stationCoordinates.get(key) ?? [];
  values.push(coordinate);
  stationCoordinates.set(key, values);
}
function coordinateFor(key) {
  const values = stationCoordinates.get(key) ?? [];
  if (values.length === 0) {
    throw new Error(`역 ${key}: 좌표가 없습니다.`);
  }
  return values[0];
}

const relationIds = [
  ...new Set(
    manifest.mappings.flatMap((mapping) => mapping.osm_relation_ids),
  ),
];
const relationConcurrency = Number(argument("concurrency", "1"));
if (!Number.isInteger(relationConcurrency) || relationConcurrency < 1) {
  throw new Error("--concurrency는 1 이상의 정수여야 합니다.");
}
const relations = await concurrentMap(relationIds, relationConcurrency, async (relationId) => {
  const relation = await fetchRelation(
    relationId,
    cacheDirectory,
    sourceUrl,
  );
  process.stderr.write(`OSM relation ${relationId} (${relation.polyline.length} points)\n`);
  return relation;
});
const relationById = new Map(
  relations.map((relation) => [relation.relationId, relation]),
);

const features = [];
const missing = [];
const selectedRelations = new Map();
for (const row of segmentRows.slice(1)) {
  const serviceLineId = row[0];
  if (!routeReadyIds.has(serviceLineId)) {
    continue;
  }
  const fromKey = row[3];
  const toKey = row[7];
  const from = coordinateFor(fromKey);
  const to = coordinateFor(toKey);
  // The legacy straight_distance_meters field contains a small number of
  // known source-data errors and must remain untouched because it participates
  // in existing routing behavior. Geometry plausibility is therefore checked
  // against the geodesic distance between the current station coordinates.
  const stationDistance = haversine(from, to);
  const relationCandidates = mappings.get(serviceLineId).osm_relation_ids.flatMap(
    (relationId) => {
      const relation = relationById.get(relationId);
      return [relation.polyline, relation.reversePolyline].flatMap((polyline) => {
        const candidate = sliceCandidate(polyline, from, to);
        if (candidate === null) {
          return [];
        }
        const maximumDistance = Math.max(
          stationDistance * 6,
          stationDistance + 5_000,
        );
        if (
          candidate.distanceMeters < stationDistance * 0.75 ||
          candidate.distanceMeters > maximumDistance
        ) {
          return [];
        }
        return [{
          ...candidate,
          relation,
          score:
            candidate.endpointError +
            Math.abs(candidate.distanceMeters - stationDistance) * 0.02,
        }];
      });
    },
  );
  relationCandidates.sort((left, right) => left.score - right.score);
  const selected = relationCandidates[0];
  if (selected === undefined) {
    const diagnostics = mappings
      .get(serviceLineId)
      .osm_relation_ids.map((relationId) => {
        const relation = relationById.get(relationId);
        const cumulative = cumulativeDistances(relation.polyline);
        const fromLocation = nearestLocation(relation.polyline, cumulative, from);
        const toLocation = nearestLocation(relation.polyline, cumulative, to);
        const directDistance = Math.abs(toLocation.position - fromLocation.position);
        const closed = haversine(relation.polyline[0], relation.polyline.at(-1)) <= 100;
        const alongDistance = closed
          ? Math.min(directDistance, cumulative.at(-1) - directDistance)
          : directDistance;
        return {
          relationId,
          endpointError: Math.max(fromLocation.distance, toLocation.distance),
          alongDistance,
        };
      })
      .sort((left, right) => left.endpointError - right.endpointError)
      .slice(0, 2)
      .map(
        (diagnostic) =>
          `${diagnostic.relationId}:endpoint=${Math.round(diagnostic.endpointError)}m/path=${Math.round(diagnostic.alongDistance)}m`,
      )
      .join(",");
    missing.push(`${serviceLineId}:${fromKey}:${toKey} [${diagnostics}]`);
    continue;
  }
  selectedRelations.set(
    selected.relation.relationId,
    (selectedRelations.get(selected.relation.relationId) ?? 0) + 1,
  );
  const timestamp = selected.relation.timestamp;
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(
      `OSM relation ${selected.relation.relationId}: snapshot 시간이 없습니다.`,
    );
  }
  features.push({
    type: "Feature",
    properties: {
      service_line_id: serviceLineId,
      from_source_station_key: fromKey,
      to_source_station_key: toKey,
      geometry_source: `OpenStreetMap relation ${selected.relation.relationId}`,
      geometry_source_url: `https://www.openstreetmap.org/relation/${selected.relation.relationId}`,
      geometry_source_hash: selected.relation.hash,
      geometry_license: "ODbL-1.0",
      geometry_version: `osm-${timestamp.slice(0, 10)}`,
      geometry_updated_at: timestamp,
    },
    geometry: {
      type: "LineString",
      coordinates: selected.coordinates.map(({ lat, lng }) => [
        Number(lng.toFixed(7)),
        Number(lat.toFixed(7)),
      ]),
    },
  });
}

if (missing.length > 0) {
  throw new Error(
    `${missing.length}개 route-ready segment의 OSM geometry를 만들지 못했습니다.\n${missing
      .join("\n")}`,
  );
}
const output = `${JSON.stringify({ type: "FeatureCollection", features })}\n`;
await writeFile(
  resolve(dataDirectory, "subway_segment_shapes.geojson"),
  output,
);
const report = {
  generatedAt: new Date().toISOString(),
  routeReadyLines: routeReadyIds.size,
  routeReadyStations: routeReadyServiceRows.reduce(
    (total, row) => total + Number(row[5]),
    0,
  ),
  matchedRouteReadyStations: routeReadyServiceRows.reduce(
    (total, row) => total + Number(row[6]),
    0,
  ),
  features: features.length,
  coverage: [...routeReadyIds]
    .sort()
    .map((serviceLineId) => {
      const segmentCount = segmentRows
        .slice(1)
        .filter((row) => row[0] === serviceLineId).length;
      const geometryCount = features.filter(
        (feature) => feature.properties.service_line_id === serviceLineId,
      ).length;
      return {
        serviceLineId,
        segmentCount,
        geometryCount,
        coverage: segmentCount === 0 ? 1 : geometryCount / segmentCount,
      };
    }),
  relations: Object.fromEntries(
    [...selectedRelations].sort(([left], [right]) => left - right),
  ),
  sha256: createHash("sha256").update(output).digest("hex"),
};
await writeFile(
  resolve(dataDirectory, "subway_segment_shapes.report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
