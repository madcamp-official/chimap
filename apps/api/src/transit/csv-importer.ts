import { readFile } from "node:fs/promises";

import iconv from "iconv-lite";

import type { CsvBusStop, TransitRepository } from "./transit-repository.js";

type CsvColumn = "sourceStopNo" | "name" | "latitude" | "longitude" | "region";

const HEADER_ALIASES: Record<CsvColumn, readonly string[]> = {
  sourceStopNo: [
    "정류장번호",
    "정류소번호",
    "정류소ID",
    "stop_id",
    "stop_no",
  ],
  name: ["정류장명", "정류소명", "stop_name"],
  latitude: ["위도", "latitude", "gpslati"],
  longitude: ["경도", "longitude", "gpslong"],
  region: [
    "지자체",
    "관리지자체",
    "관리도시명",
    "도시명",
    "시도",
    "시군구",
  ],
};

export type BusStopsCsvParseResult = {
  encoding: "utf-8" | "cp949";
  rows: CsvBusStop[];
  headers: string[];
  rejectedRows: number;
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_-]+/gu, "");
}

function decodeBuffer(
  buffer: Buffer,
): { encoding: "utf-8" | "cp949"; text: string } {
  const hasUtf8Bom =
    buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      hasUtf8Bom ? buffer.subarray(3) : buffer,
    );
    return { encoding: "utf-8", text };
  } catch {
    return {
      encoding: "cp949",
      text: iconv.decode(buffer, "cp949"),
    };
  }
}

function firstRecord(text: string): string {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === "\n" || character === "\r")) {
      return text.slice(0, index);
    }
  }
  return text;
}

function detectDelimiter(text: string): "," | "\t" | ";" {
  const header = firstRecord(text);
  const candidates = [",", "\t", ";"] as const;
  return candidates
    .map((delimiter) => ({
      delimiter,
      count: header.split(delimiter).length - 1,
    }))
    .sort((first, second) => second.count - first.count)[0]!.delimiter;
}

export function parseCsv(
  text: string,
  delimiter = detectDelimiter(text),
): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  const pushField = () => {
    record.push(field.trim());
    field = "";
  };
  const pushRecord = () => {
    pushField();
    if (record.some((value) => value.length > 0)) {
      records.push(record);
    }
    record = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      pushField();
    } else if (character === "\n") {
      pushRecord();
    } else if (character === "\r") {
      if (text[index + 1] === "\n") {
        index += 1;
      }
      pushRecord();
    } else {
      field += character;
    }
  }
  if (quoted) {
    throw new Error("CSV의 따옴표가 닫히지 않았습니다.");
  }
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }
  return records;
}

export function mapBusStopHeaders(
  headers: string[],
): Record<CsvColumn, number | undefined> {
  const normalized = headers.map(normalizeHeader);
  const find = (column: CsvColumn): number | undefined => {
    const aliases = new Set(HEADER_ALIASES[column].map(normalizeHeader));
    const index = normalized.findIndex((header) => aliases.has(header));
    return index < 0 ? undefined : index;
  };
  const mapping: Record<CsvColumn, number | undefined> = {
    sourceStopNo: find("sourceStopNo"),
    name: find("name"),
    latitude: find("latitude"),
    longitude: find("longitude"),
    region: find("region"),
  };
  const required: CsvColumn[] = [
    "sourceStopNo",
    "name",
    "latitude",
    "longitude",
  ];
  const missing = required.filter((column) => mapping[column] === undefined);
  if (missing.length > 0) {
    const labels: Record<CsvColumn, string> = {
      sourceStopNo: "정류장번호",
      name: "정류장명",
      latitude: "위도",
      longitude: "경도",
      region: "지자체",
    };
    throw new Error(
      `전국 정류장 파일에 필수 컬럼이 없습니다: ${missing.map((column) => labels[column]).join(", ")}. 확인된 헤더: ${headers.join(", ")}`,
    );
  }
  return mapping;
}

function valueAt(
  row: string[],
  index: number | undefined,
): string | undefined {
  if (index === undefined) {
    return undefined;
  }
  const value = row[index]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export function parseBusStopsCsvBuffer(
  buffer: Buffer,
): BusStopsCsvParseResult {
  const decoded = decodeBuffer(buffer);
  const records = parseCsv(decoded.text);
  const headers = records[0];
  if (headers === undefined) {
    throw new Error("전국 정류장 파일이 비어 있습니다.");
  }
  const mapping = mapBusStopHeaders(headers);
  const rows: CsvBusStop[] = [];
  const errors: string[] = [];

  records.slice(1).forEach((record, index) => {
    const line = index + 2;
    const sourceStopNo = valueAt(record, mapping.sourceStopNo);
    const name = valueAt(record, mapping.name);
    const latitudeText = valueAt(record, mapping.latitude);
    const longitudeText = valueAt(record, mapping.longitude);
    if (
      sourceStopNo === undefined ||
      name === undefined ||
      latitudeText === undefined ||
      longitudeText === undefined
    ) {
      errors.push(`${line}행: 필수 값 누락`);
      return;
    }
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      errors.push(`${line}행: 잘못된 위도/경도`);
      return;
    }
    rows.push({
      sourceStopNo,
      name,
      latitude,
      longitude,
      regionName: valueAt(record, mapping.region) ?? null,
    });
  });

  const dataRowCount = Math.max(records.length - 1, 0);
  const rejectionRate =
    dataRowCount === 0 ? 1 : errors.length / dataRowCount;
  if (rows.length === 0 || rejectionRate > 0.01) {
    throw new Error(
      `전국 정류장 파일 검증에 실패했습니다 (제외 ${errors.length}/${dataRowCount}건): ${errors.slice(0, 10).join("; ")}`,
    );
  }
  return {
    encoding: decoded.encoding,
    rows,
    headers,
    rejectedRows: errors.length,
  };
}

export async function importBusStopsFile(
  path: string,
  repository: TransitRepository,
): Promise<BusStopsCsvParseResult & { imported: number }> {
  const buffer = await readFile(path);
  const parsed = parseBusStopsCsvBuffer(buffer);
  const imported = await repository.upsertCsvStops(parsed.rows);
  return { ...parsed, imported };
}
