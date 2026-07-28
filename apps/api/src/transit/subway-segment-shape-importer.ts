import { haversineDistanceMeters, type Coordinate } from "@chimap/contracts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

import { parseSubwayStationsCsvBuffer } from "./subway-csv-importer.js";
import { parseSubwayTopologyDirectory } from "./subway-topology-importer.js";
import type {
  CsvSubwayStation,
  CsvSubwayTopology,
  SubwaySegmentShape,
  SubwaySegmentShapeDataset,
  TransitRepository,
} from "./transit-repository.js";

export const SUBWAY_SEGMENT_SHAPES_FILE = "subway_segment_shapes.geojson";
export const SUBWAY_SHAPE_ENDPOINT_TOLERANCE_METERS = 250;
export const SUBWAY_SHAPE_CONTINUITY_TOLERANCE_METERS = 75;

const lngLatSchema = z.tuple([
  z.number().finite().min(123).max(133),
  z.number().finite().min(32).max(40),
]);

const featureSchema = z
  .object({
    type: z.literal("Feature"),
    properties: z
      .object({
        service_line_id: z.string().trim().min(1).max(32),
        from_source_station_key: z.string().trim().min(1).max(120),
        to_source_station_key: z.string().trim().min(1).max(120),
        geometry_source: z.string().trim().min(1).max(160),
        geometry_source_url: z.url().max(2_048),
        geometry_source_hash: z.string().regex(/^[a-f0-9]{64}$/u),
        geometry_license: z.string().trim().min(1).max(240),
        geometry_version: z.string().trim().min(1).max(120),
        geometry_updated_at: z.iso.datetime({ offset: true }),
      })
      .strict(),
    geometry: z
      .object({
        type: z.literal("LineString"),
        coordinates: z.array(lngLatSchema).min(2),
      })
      .strict(),
  })
  .strict();

const featureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(featureSchema),
  })
  .strict();

type ShapeFeature = z.infer<typeof featureSchema>;

export type SubwayShapeCoverage = {
  serviceLineId: string;
  segmentCount: number;
  geometryCount: number;
  coverage: number;
};

export type SubwaySegmentShapeValidationReport = {
  checksum: string;
  featureCount: number;
  reversedCount: number;
  sourceCounts: Record<string, number>;
  coverage: SubwayShapeCoverage[];
};

export type ValidatedSubwaySegmentShapeDataset = SubwaySegmentShapeDataset & {
  report: SubwaySegmentShapeValidationReport;
};

function segmentKey(input: {
  serviceLineId: string;
  fromSourceStationKey: string;
  toSourceStationKey: string;
}): string {
  return [
    input.serviceLineId,
    input.fromSourceStationKey,
    input.toSourceStationKey,
  ].join(":");
}

function normalizeStationName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/역$/u, "")
    .replace(/[^가-힣a-z0-9]/gu, "");
}

function stationCoordinate(
  sourceStationKey: string,
  stationName: string | undefined,
  stationsByKey: ReadonlyMap<string, CsvSubwayStation[]>,
  geometryEndpoints: readonly Coordinate[],
): Coordinate {
  const candidates = stationsByKey.get(sourceStationKey) ?? [];
  const exact =
    stationName === undefined
      ? []
      : candidates.filter(
          (station) =>
            normalizeStationName(station.name) ===
            normalizeStationName(stationName),
        );
  const matches = exact.length > 0 ? exact : candidates;
  if (matches.length === 0) {
    throw new Error(
      `역 ${sourceStationKey}: 좌표를 찾지 못했습니다.`,
    );
  }
  const first = matches[0]!;
  const firstCoordinate = {
    lat: first.latitude,
    lng: first.longitude,
  };
  if (
    matches.some(
      (candidate) =>
        haversineDistanceMeters(firstCoordinate, {
          lat: candidate.latitude,
          lng: candidate.longitude,
        }) > 50,
    )
  ) {
    const closest = matches
      .map((candidate) => ({
        candidate,
        distance: Math.min(
          ...geometryEndpoints.map((endpoint) =>
            haversineDistanceMeters(endpoint, {
              lat: candidate.latitude,
              lng: candidate.longitude,
            }),
          ),
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0]!.candidate;
    return { lat: closest.latitude, lng: closest.longitude };
  }
  return firstCoordinate;
}

function orientFeature(
  feature: ShapeFeature,
  from: Coordinate,
  to: Coordinate,
): { coordinates: Coordinate[]; reversed: boolean } {
  const coordinates = feature.geometry.coordinates.map(([lng, lat]) => ({
    lat,
    lng,
  }));
  const first = coordinates[0]!;
  const last = coordinates.at(-1)!;
  const forwardScore =
    haversineDistanceMeters(first, from) +
    haversineDistanceMeters(last, to);
  const reverseScore =
    haversineDistanceMeters(first, to) +
    haversineDistanceMeters(last, from);
  const reversed = reverseScore < forwardScore;
  const oriented = reversed ? coordinates.reverse() : coordinates;
  const startDistance = haversineDistanceMeters(oriented[0]!, from);
  const endDistance = haversineDistanceMeters(oriented.at(-1)!, to);
  if (
    startDistance > SUBWAY_SHAPE_ENDPOINT_TOLERANCE_METERS ||
    endDistance > SUBWAY_SHAPE_ENDPOINT_TOLERANCE_METERS
  ) {
    throw new Error(
      `구간 ${feature.properties.service_line_id}:${feature.properties.from_source_station_key}:${feature.properties.to_source_station_key}: 역 끝점 오차가 ${Math.round(startDistance)}m/${Math.round(endDistance)}m입니다.`,
    );
  }
  return { coordinates: oriented, reversed };
}

function validateContinuity(
  topology: CsvSubwayTopology,
  rowsByKey: ReadonlyMap<string, SubwaySegmentShape>,
): void {
  const byLine = new Map<string, CsvSubwayTopology["lineStations"]>();
  for (const station of topology.lineStations) {
    const stations = byLine.get(station.serviceLineId) ?? [];
    stations.push(station);
    byLine.set(station.serviceLineId, stations);
  }
  for (const [serviceLineId, stations] of byLine) {
    stations.sort((left, right) => left.stationOrder - right.stationOrder);
    for (let index = 0; index < stations.length - 2; index += 1) {
      const first = stations[index]!;
      const middle = stations[index + 1]!;
      const last = stations[index + 2]!;
      const pairs = [
        [first, middle, last],
        [last, middle, first],
      ] as const;
      for (const [from, via, to] of pairs) {
        const before = rowsByKey.get(
          segmentKey({
            serviceLineId,
            fromSourceStationKey: from.sourceStationKey,
            toSourceStationKey: via.sourceStationKey,
          }),
        );
        const after = rowsByKey.get(
          segmentKey({
            serviceLineId,
            fromSourceStationKey: via.sourceStationKey,
            toSourceStationKey: to.sourceStationKey,
          }),
        );
        if (before === undefined || after === undefined) {
          continue;
        }
        const gap = haversineDistanceMeters(
          before.coordinates.at(-1)!,
          after.coordinates[0]!,
        );
        if (gap > SUBWAY_SHAPE_CONTINUITY_TOLERANCE_METERS) {
          throw new Error(
            `노선 ${serviceLineId} ${via.sourceStationKey}: 연속 구간 간격이 ${Math.round(gap)}m입니다.`,
          );
        }
      }
    }
  }
}

export function validateSubwaySegmentShapeGeoJson(input: {
  source: unknown;
  checksum: string;
  topology: CsvSubwayTopology;
  stations: readonly CsvSubwayStation[];
  requireComplete?: boolean;
}): ValidatedSubwaySegmentShapeDataset {
  const collection = featureCollectionSchema.parse(input.source);
  const segmentKeys = new Set(input.topology.segments.map(segmentKey));
  const serviceLines = new Map(
    input.topology.serviceLines.map((line) => [line.serviceLineId, line]),
  );
  const lineStations = new Map(
    input.topology.lineStations.map((station) => [
      `${station.serviceLineId}:${station.sourceStationKey}`,
      station,
    ]),
  );
  const stationsByKey = new Map<string, CsvSubwayStation[]>();
  for (const station of input.stations) {
    const key = `${station.lineCode}|${station.stationCode}`;
    const matches = stationsByKey.get(key) ?? [];
    matches.push(station);
    stationsByKey.set(key, matches);
  }

  const rowsByKey = new Map<string, SubwaySegmentShape>();
  const sourceCounts: Record<string, number> = {};
  let reversedCount = 0;
  for (const feature of collection.features) {
    const properties = feature.properties;
    const key = segmentKey({
      serviceLineId: properties.service_line_id,
      fromSourceStationKey: properties.from_source_station_key,
      toSourceStationKey: properties.to_source_station_key,
    });
    if (!segmentKeys.has(key)) {
      throw new Error(`알 수 없는 지하철 구간 geometry: ${key}`);
    }
    if (rowsByKey.has(key)) {
      throw new Error(`중복 지하철 구간 geometry: ${key}`);
    }
    const fromStation = lineStations.get(
      `${properties.service_line_id}:${properties.from_source_station_key}`,
    );
    const toStation = lineStations.get(
      `${properties.service_line_id}:${properties.to_source_station_key}`,
    );
    const geometryEndpoints = [
      feature.geometry.coordinates[0]!,
      feature.geometry.coordinates.at(-1)!,
    ].map(([lng, lat]) => ({ lat, lng }));
    const oriented = orientFeature(
      feature,
      stationCoordinate(
        properties.from_source_station_key,
        fromStation?.stationName,
        stationsByKey,
        geometryEndpoints,
      ),
      stationCoordinate(
        properties.to_source_station_key,
        toStation?.stationName,
        stationsByKey,
        geometryEndpoints,
      ),
    );
    reversedCount += oriented.reversed ? 1 : 0;
    sourceCounts[properties.geometry_source] =
      (sourceCounts[properties.geometry_source] ?? 0) + 1;
    rowsByKey.set(key, {
      serviceLineId: properties.service_line_id,
      fromSourceStationKey: properties.from_source_station_key,
      toSourceStationKey: properties.to_source_station_key,
      coordinates: oriented.coordinates,
      geometrySource: properties.geometry_source,
      geometryLicense: properties.geometry_license,
      geometryVersion: properties.geometry_version,
      geometryUpdatedAt: properties.geometry_updated_at,
    });
  }

  validateContinuity(input.topology, rowsByKey);
  const coverage = [...serviceLines.values()]
    .filter((line) => line.isRouteReady)
    .map((line): SubwayShapeCoverage => {
      const segments = input.topology.segments.filter(
        (segment) => segment.serviceLineId === line.serviceLineId,
      );
      const geometryCount = segments.filter((segment) =>
        rowsByKey.has(segmentKey(segment)),
      ).length;
      return {
        serviceLineId: line.serviceLineId,
        segmentCount: segments.length,
        geometryCount,
        coverage: segments.length === 0 ? 1 : geometryCount / segments.length,
      };
    })
    .sort((left, right) => left.serviceLineId.localeCompare(right.serviceLineId));
  const incomplete = coverage.filter(
    (line) => line.geometryCount !== line.segmentCount,
  );
  if ((input.requireComplete ?? true) && incomplete.length > 0) {
    throw new Error(
      `route-ready 선로 geometry가 완전하지 않습니다: ${incomplete
        .slice(0, 10)
        .map(
          (line) =>
            `${line.serviceLineId} ${line.geometryCount}/${line.segmentCount}`,
        )
        .join(", ")}`,
    );
  }
  return {
    checksum: input.checksum,
    rows: [...rowsByKey.values()],
    report: {
      checksum: input.checksum,
      featureCount: rowsByKey.size,
      reversedCount,
      sourceCounts,
      coverage,
    },
  };
}

export async function parseSubwaySegmentShapesDirectory(
  directory: string,
  options: { requireComplete?: boolean } = {},
): Promise<ValidatedSubwaySegmentShapeDataset> {
  const [topology, stationBuffer, shapeBuffer] = await Promise.all([
    parseSubwayTopologyDirectory(directory),
    readFile(join(directory, "subway_data.csv")),
    readFile(join(directory, SUBWAY_SEGMENT_SHAPES_FILE)),
  ]);
  const checksum = createHash("sha256").update(shapeBuffer).digest("hex");
  return validateSubwaySegmentShapeGeoJson({
    source: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(shapeBuffer)),
    checksum,
    topology,
    stations: parseSubwayStationsCsvBuffer(stationBuffer).rows,
    ...(options.requireComplete === undefined
      ? {}
      : { requireComplete: options.requireComplete }),
  });
}

export async function importSubwaySegmentShapesDirectory(
  directory: string,
  repository: TransitRepository,
): Promise<SubwaySegmentShapeValidationReport> {
  const validated = await parseSubwaySegmentShapesDirectory(directory);
  await repository.importSubwaySegmentShapes(validated);
  return validated.report;
}
