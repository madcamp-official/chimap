import { readFile } from "node:fs/promises";

import { parseCsv } from "./csv-importer.js";
import type {
  CsvSubwayStation,
  TransitRepository,
} from "./transit-repository.js";

const SUBWAY_HEADERS = [
  "역번호",
  "역사명",
  "노선번호",
  "노선명",
  "영문역사명",
  "한자역사명",
  "환승역구분",
  "환승노선번호",
  "환승노선명",
  "역위도",
  "역경도",
  "운영기관명",
  "역사도로명주소",
  "역사전화번호",
  "데이터기준일자",
] as const;

export type SubwayStationsCsvParseResult = {
  sourceRowCount: number;
  rows: CsvSubwayStation[];
  duplicateRows: number;
};

function nullable(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? null
    : normalized;
}

function naturalKey(row: CsvSubwayStation): string {
  return [row.stationCode, row.lineCode, row.lineName, row.operatorName].join(
    "\u001f",
  );
}

function dataDateRank(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return Number.NEGATIVE_INFINITY;
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

export function parseSubwayStationsCsvBuffer(
  buffer: Buffer,
): SubwayStationsCsvParseResult {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  const records = parseCsv(text.replace(/^\uFEFF/u, ""), ",");
  const headers = records[0];
  if (headers === undefined) {
    throw new Error("지하철역 CSV가 비어 있습니다.");
  }
  if (
    headers.length !== SUBWAY_HEADERS.length ||
    SUBWAY_HEADERS.some((header, index) => headers[index]?.trim() !== header)
  ) {
    throw new Error(
      `지하철역 CSV 헤더가 예상 형식과 다릅니다. 확인된 헤더: ${headers.join(", ")}`,
    );
  }

  const parsed: CsvSubwayStation[] = records.slice(1).map((record, index) => {
    const line = index + 2;
    if (record.length !== SUBWAY_HEADERS.length) {
      throw new Error(
        `${line}행: 열 개수가 ${SUBWAY_HEADERS.length}개가 아닙니다.`,
      );
    }
    const stationCode = record[0]?.trim();
    const name = record[1]?.trim();
    const lineCode = record[2]?.trim();
    const lineName = record[3]?.trim();
    const latitude = Number(record[9]);
    const longitude = Number(record[10]);
    const operatorName = record[11]?.trim();
    const dataDate = record[14]?.trim();
    if (
      stationCode === undefined ||
      stationCode.length === 0 ||
      name === undefined ||
      name.length === 0 ||
      lineCode === undefined ||
      lineCode.length === 0 ||
      lineName === undefined ||
      lineName.length === 0 ||
      operatorName === undefined ||
      operatorName.length === 0 ||
      dataDate === undefined ||
      dataDate.length === 0
    ) {
      throw new Error(`${line}행: 필수 역·노선·기관·기준일 값이 잘못됐습니다.`);
    }
    if (
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      throw new Error(`${line}행: 위도/경도가 올바르지 않습니다.`);
    }
    return {
      stationCode,
      name,
      lineCode,
      lineName,
      englishName: nullable(record[4]),
      hanjaName: nullable(record[5]),
      transferType: nullable(record[6]),
      transferLineCode: nullable(record[7]),
      transferLineName: nullable(record[8]),
      latitude,
      longitude,
      operatorName,
      roadAddress: nullable(record[12]),
      phoneNumber: nullable(record[13]),
      dataDate,
    };
  });

  const latestByKey = new Map<string, CsvSubwayStation>();
  for (const row of parsed) {
    const key = naturalKey(row);
    const existing = latestByKey.get(key);
    const existingRank =
      existing === undefined
        ? Number.NEGATIVE_INFINITY
        : dataDateRank(existing.dataDate);
    const candidateRank = dataDateRank(row.dataDate);
    if (
      existing === undefined ||
      existingRank < candidateRank ||
      (existingRank === candidateRank && existing.dataDate < row.dataDate)
    ) {
      latestByKey.set(key, row);
    }
  }
  return {
    sourceRowCount: parsed.length,
    rows: [...latestByKey.values()],
    duplicateRows: parsed.length - latestByKey.size,
  };
}

export async function importSubwayStationsFile(
  path: string,
  repository: TransitRepository,
): Promise<SubwayStationsCsvParseResult> {
  const parsed = parseSubwayStationsCsvBuffer(await readFile(path));
  await repository.importSubwayStations(parsed.rows);
  return parsed;
}
