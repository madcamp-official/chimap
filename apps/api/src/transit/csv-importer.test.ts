import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

import {
  mapBusStopHeaders,
  parseBusStopsCsvBuffer,
} from "./csv-importer.js";

const sourcePath = new URL(
  "../../test-data/bus-stops-public-sample-20251031.csv",
  import.meta.url,
);
const metadataPath = new URL(
  "../../test-data/bus-stops-public-sample-20251031.metadata.json",
  import.meta.url,
);
const source = readFileSync(sourcePath);
const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as {
  source: string;
  sourceRows: string;
  checksum: string;
};

describe("전국 정류장 공개 자료 parser", () => {
  it("출처와 UTF-8 변환본 checksum을 검증한다", () => {
    expect(metadata.source).toBe("전국버스정류장 위치정보 CSV");
    expect(metadata.sourceRows).toBe(
      "header, rows 2-4, 46284 and 47156",
    );
    expect(createHash("sha256").update(source).digest("hex")).toBe(
      metadata.checksum,
    );
  });

  it("공개 자료의 컬럼과 정류장 좌표를 읽는다", () => {
    const parsed = parseBusStopsCsvBuffer(source);
    expect(parsed.encoding).toBe("utf-8");
    expect(parsed.rows).toHaveLength(5);
    expect(parsed.rows[0]).toEqual({
      sourceStopNo: "ADB354000001",
      name: "길안정류장",
      latitude: 36.458658,
      longitude: 128.891228,
      regionName: "경상북도 안동시",
    });
  });

  it("같은 공개 자료의 CP949 encoding을 감지한다", () => {
    const encoded = iconv.encode(source.toString("utf8"), "cp949");
    const parsed = parseBusStopsCsvBuffer(encoded);
    expect(parsed.encoding).toBe("cp949");
    expect(parsed.rows[1]?.name).toBe("고란.계명산휴양림입구");
  });

  it("지원하는 영문 header 별칭을 유지한다", () => {
    expect(
      mapBusStopHeaders([
        "stop_no",
        "stop_name",
        "latitude",
        "longitude",
      ]),
    ).toMatchObject({
      sourceStopNo: 0,
      name: 1,
      latitude: 2,
      longitude: 3,
    });
  });
});
