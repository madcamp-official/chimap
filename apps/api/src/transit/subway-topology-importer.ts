import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCsv } from "./csv-importer.js";
import type {
  CsvSubwayTopology,
  TransitRepository,
} from "./transit-repository.js";

const FILES = {
  serviceLines: "subway_service_lines.csv",
  lineStations: "subway_line_stations.csv",
  segments: "subway_segments.csv",
  headways: "subway_headways_fallback.csv",
  transfers: "subway_transfer_edges.csv",
} as const;

const HEADERS = {
  serviceLines: [
    "service_line_id", "region_code", "region_name", "operator_name",
    "service_line_name", "station_count", "matched_station_count",
    "segment_count", "fallback_headway_count", "is_branching",
    "is_route_ready", "timing_provider_default",
  ],
  lineStations: [
    "service_line_id", "region_code", "region_name", "operator_name",
    "service_line_name", "station_order", "order_conflict",
    "source_line_id", "source_station_id", "source_station_key",
    "station_name",
  ],
  segments: [
    "service_line_id", "from_source_line_id", "from_source_station_id",
    "from_source_station_key", "from_station_name", "to_source_line_id",
    "to_source_station_id", "to_source_station_key", "to_station_name",
    "duration_seconds", "average_duration_seconds",
    "straight_distance_meters", "sample_count", "duration_method",
  ],
  headways: [
    "service_line_id", "source_line_id", "source_station_id",
    "source_station_key", "station_name", "next_source_line_id",
    "next_source_station_id", "next_source_station_key", "next_station_name",
    "day_group", "time_period", "median_headway_seconds",
    "expected_wait_seconds", "departure_count", "interval_sample_count",
  ],
  transfers: [
    "from_source_line_id", "from_source_station_id",
    "from_source_station_key", "from_station_name", "to_source_line_id",
    "to_source_station_id", "to_source_station_key", "to_station_name",
    "transfer_duration_seconds", "straight_distance_meters",
    "duration_is_estimated",
  ],
} as const;

type Records = string[][];

function records(buffer: Buffer, expected: readonly string[], file: string): Records {
  const parsed = parseCsv(
    new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/u, ""),
    ",",
  );
  const header = parsed[0];
  if (
    header === undefined ||
    header.length !== expected.length ||
    expected.some((value, index) => header[index] !== value)
  ) {
    throw new Error(`${file}: CSV 헤더가 예상 형식과 다릅니다.`);
  }
  parsed.slice(1).forEach((row, index) => {
    if (row.length !== expected.length) {
      throw new Error(`${file} ${index + 2}행: 열 개수가 올바르지 않습니다.`);
    }
  });
  return parsed.slice(1);
}

function required(row: string[], index: number, context: string): string {
  const value = row[index]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${context}: 필수 값이 비어 있습니다.`);
  }
  return value;
}

function integer(
  row: string[],
  index: number,
  context: string,
  minimum = 0,
): number {
  const value = Number(required(row, index, context));
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${context}: 0 이상의 정수가 필요합니다.`);
  }
  return value;
}

function boolean(row: string[], index: number, context: string): boolean {
  const value = required(row, index, context).toLocaleLowerCase();
  if (value !== "true" && value !== "false") {
    throw new Error(`${context}: true 또는 false가 필요합니다.`);
  }
  return value === "true";
}

function assertUnique(values: string[], context: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`${context}: 중복 키 ${value}`);
    }
    seen.add(value);
  }
}

export async function parseSubwayTopologyDirectory(
  directory: string,
): Promise<CsvSubwayTopology> {
  const buffers = await Promise.all(
    Object.values(FILES).map((file) => readFile(join(directory, file))),
  );
  const serviceRecords = records(buffers[0]!, HEADERS.serviceLines, FILES.serviceLines);
  const stationRecords = records(buffers[1]!, HEADERS.lineStations, FILES.lineStations);
  const segmentRecords = records(buffers[2]!, HEADERS.segments, FILES.segments);
  const headwayRecords = records(buffers[3]!, HEADERS.headways, FILES.headways);
  const transferRecords = records(buffers[4]!, HEADERS.transfers, FILES.transfers);

  const serviceLines: CsvSubwayTopology["serviceLines"] = serviceRecords.map(
    (row, index) => ({
      serviceLineId: required(row, 0, `노선 ${index + 2}행`),
      regionCode: required(row, 1, `노선 ${index + 2}행`),
      regionName: required(row, 2, `노선 ${index + 2}행`),
      operatorName: required(row, 3, `노선 ${index + 2}행`),
      serviceLineName: required(row, 4, `노선 ${index + 2}행`),
      stationCount: integer(row, 5, `노선 ${index + 2}행`, 1),
      matchedStationCount: integer(row, 6, `노선 ${index + 2}행`),
      segmentCount: integer(row, 7, `노선 ${index + 2}행`),
      fallbackHeadwayCount: integer(row, 8, `노선 ${index + 2}행`),
      isBranching: boolean(row, 9, `노선 ${index + 2}행`),
      isRouteReady: boolean(row, 10, `노선 ${index + 2}행`),
      timingProviderDefault: required(row, 11, `노선 ${index + 2}행`),
    }),
  );
  const lineStations: CsvSubwayTopology["lineStations"] = stationRecords.map(
    (row, index) => ({
      serviceLineId: required(row, 0, `역 순서 ${index + 2}행`),
      stationOrder: integer(row, 5, `역 순서 ${index + 2}행`, 1),
      orderConflict: boolean(row, 6, `역 순서 ${index + 2}행`),
      sourceLineId: required(row, 7, `역 순서 ${index + 2}행`),
      sourceStationId: required(row, 8, `역 순서 ${index + 2}행`),
      sourceStationKey: required(row, 9, `역 순서 ${index + 2}행`),
      stationName: required(row, 10, `역 순서 ${index + 2}행`),
    }),
  );
  const segments: CsvSubwayTopology["segments"] = segmentRecords.map(
    (row, index) => ({
      serviceLineId: required(row, 0, `구간 ${index + 2}행`),
      fromSourceStationKey: required(row, 3, `구간 ${index + 2}행`),
      toSourceStationKey: required(row, 7, `구간 ${index + 2}행`),
      durationSeconds: integer(row, 9, `구간 ${index + 2}행`, 1),
      averageDurationSeconds: integer(row, 10, `구간 ${index + 2}행`, 1),
      straightDistanceMeters: integer(row, 11, `구간 ${index + 2}행`),
      sampleCount: integer(row, 12, `구간 ${index + 2}행`),
      durationMethod: required(row, 13, `구간 ${index + 2}행`),
    }),
  );
  const headways: CsvSubwayTopology["headways"] = headwayRecords.map(
    (row, index) => ({
      serviceLineId: required(row, 0, `배차 ${index + 2}행`),
      sourceStationKey: required(row, 3, `배차 ${index + 2}행`),
      nextSourceStationKey: required(row, 7, `배차 ${index + 2}행`),
      dayGroup: required(row, 9, `배차 ${index + 2}행`),
      timePeriod: required(row, 10, `배차 ${index + 2}행`),
      medianHeadwaySeconds: integer(row, 11, `배차 ${index + 2}행`, 1),
      expectedWaitSeconds: integer(row, 12, `배차 ${index + 2}행`),
      departureCount: integer(row, 13, `배차 ${index + 2}행`),
      intervalSampleCount: integer(row, 14, `배차 ${index + 2}행`),
    }),
  );
  const parsedTransfers: CsvSubwayTopology["transfers"] = transferRecords.map(
    (row, index) => ({
      fromSourceStationKey: required(row, 2, `환승 ${index + 2}행`),
      toSourceStationKey: required(row, 6, `환승 ${index + 2}행`),
      transferDurationSeconds: integer(row, 8, `환승 ${index + 2}행`, 1),
      straightDistanceMeters: integer(row, 9, `환승 ${index + 2}행`),
      durationIsEstimated: boolean(row, 10, `환승 ${index + 2}행`),
    }),
  );

  const transfersByKey = new Map<string, CsvSubwayTopology["transfers"][number]>();
  for (const transfer of parsedTransfers) {
    const key = `${transfer.fromSourceStationKey}:${transfer.toSourceStationKey}`;
    const existing = transfersByKey.get(key);
    if (
      existing === undefined ||
      transfer.transferDurationSeconds < existing.transferDurationSeconds ||
      (transfer.transferDurationSeconds === existing.transferDurationSeconds &&
        transfer.straightDistanceMeters < existing.straightDistanceMeters)
    ) {
      transfersByKey.set(key, transfer);
    }
  }
  const transfers = [...transfersByKey.values()];

  assertUnique(serviceLines.map((line) => line.serviceLineId), "지하철 노선");
  assertUnique(
    lineStations.map((station) => `${station.serviceLineId}:${station.sourceStationKey}`),
    "지하철 노선 역",
  );
  assertUnique(
    segments.map((segment) =>
      `${segment.serviceLineId}:${segment.fromSourceStationKey}:${segment.toSourceStationKey}`,
    ),
    "지하철 구간",
  );
  const serviceIds = new Set(serviceLines.map((line) => line.serviceLineId));
  for (const station of lineStations) {
    if (!serviceIds.has(station.serviceLineId)) {
      throw new Error(`역 ${station.sourceStationKey}: 알 수 없는 노선입니다.`);
    }
    if (station.sourceStationKey !== `${station.sourceLineId}|${station.sourceStationId}`) {
      throw new Error(`역 ${station.sourceStationKey}: 원본 역 키가 일치하지 않습니다.`);
    }
  }
  for (const segment of segments) {
    if (!serviceIds.has(segment.serviceLineId)) {
      throw new Error(`구간 ${segment.serviceLineId}: 알 수 없는 노선입니다.`);
    }
  }
  for (const headway of headways) {
    if (!serviceIds.has(headway.serviceLineId)) {
      throw new Error(`배차 ${headway.serviceLineId}: 알 수 없는 노선입니다.`);
    }
  }
  return { serviceLines, lineStations, segments, headways, transfers };
}

export async function importSubwayTopologyDirectory(
  directory: string,
  repository: TransitRepository,
): Promise<CsvSubwayTopology> {
  const parsed = await parseSubwayTopologyDirectory(directory);
  await repository.importSubwayTopology(parsed);
  return parsed;
}
