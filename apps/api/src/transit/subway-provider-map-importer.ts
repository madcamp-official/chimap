import { readFile } from "node:fs/promises";

import { parseCsv } from "./csv-importer.js";
import type {
  CsvSubwayProviderMapping,
  TransitRepository,
} from "./transit-repository.js";

const HEADERS = [
  "source_line_id",
  "source_station_id",
  "source_station_key",
  "station_name",
  "line_name",
  "region_code",
  "preferred_timing_provider",
  "tago_station_id",
  "seoul_subway_id",
  "seoul_station_id",
  "mapping_status",
] as const;

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function parseSubwayProviderMapFile(
  path: string,
): Promise<CsvSubwayProviderMapping[]> {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(await readFile(path))
    .replace(/^\uFEFF/u, "");
  const records = parseCsv(text, ",");
  const header = records[0];
  if (
    header === undefined ||
    header.length !== HEADERS.length ||
    HEADERS.some((value, index) => header[index] !== value)
  ) {
    throw new Error("지하철 provider mapping CSV 헤더가 예상 형식과 다릅니다.");
  }
  return records.slice(1).map((row, index) => {
    const context = `${index + 2}행`;
    if (row.length !== HEADERS.length) {
      throw new Error(`${context}: 열 개수가 올바르지 않습니다.`);
    }
    const required = (column: number): string => {
      const value = row[column]?.trim();
      if (value === undefined || value.length === 0) {
        throw new Error(`${context}: 필수 값이 비어 있습니다.`);
      }
      return value;
    };
    const sourceLineId = required(0);
    const sourceStationId = required(1);
    const sourceStationKey = required(2);
    if (sourceStationKey !== `${sourceLineId}|${sourceStationId}`) {
      throw new Error(`${context}: source_station_key가 원본 키와 다릅니다.`);
    }
    const preferred = required(6);
    if (preferred !== "SEOUL_REALTIME" && preferred !== "TAGO_TIMETABLE") {
      throw new Error(`${context}: 지원하지 않는 timing provider입니다.`);
    }
    return {
      sourceStationKey,
      stationName: required(3),
      lineName: required(4),
      regionCode: required(5),
      preferredProvider: preferred,
      tagoStationId: nullable(row[7] ?? ""),
      seoulSubwayId: nullable(row[8] ?? ""),
      seoulStationId: nullable(row[9] ?? ""),
      mappingStatus: required(10),
    };
  });
}

export async function importSubwayProviderMapFile(
  path: string,
  repository: TransitRepository,
): Promise<CsvSubwayProviderMapping[]> {
  const rows = await parseSubwayProviderMapFile(path);
  await repository.importSubwayProviderMappings(rows);
  return rows;
}
