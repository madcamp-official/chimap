import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

import {
  mapBusStopHeaders,
  parseBusStopsCsvBuffer,
} from "./csv-importer.js";
import { TransitRepository } from "./transit-repository.js";

const CSV =
  "정류장번호,정류장명,위도,경도,지자체\n1001,테스트정류장,36.3723,127.3604,대전광역시\n";

describe("전국 정류장 CSV import", () => {
  it("컬럼 별칭과 UTF-8 BOM을 처리한다", () => {
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
    const parsed = parseBusStopsCsvBuffer(
      Buffer.from(`\uFEFF${CSV}`, "utf8"),
    );
    expect(parsed.encoding).toBe("utf-8");
    expect(parsed.rows[0]).toMatchObject({
      sourceStopNo: "1001",
      name: "테스트정류장",
      regionName: "대전광역시",
    });
  });

  it("CP949 파일을 감지해 읽는다", () => {
    const parsed = parseBusStopsCsvBuffer(iconv.encode(CSV, "cp949"));
    expect(parsed.encoding).toBe("cp949");
    expect(parsed.rows[0]?.name).toBe("테스트정류장");
  });

  it("재실행은 upsert하고 파일 정류장번호와 TAGO nodeId를 분리한다", () => {
    const repository = new TransitRepository(":memory:");
    try {
      const parsed = parseBusStopsCsvBuffer(Buffer.from(CSV));
      repository.upsertCsvStops(parsed.rows);
      repository.upsertCsvStops(parsed.rows);
      expect(repository.stats().stops).toBe(1);

      const reconciled = repository.reconcileTagoStop({
        id: "25:DJB1001",
        cityCode: "25",
        nodeId: "DJB1001",
        sourceStopNo: null,
        arsId: "1001",
        name: "테스트정류장",
        latitude: 36.37231,
        longitude: 127.36041,
        source: "tago",
      });
      expect(reconciled.status).toBe("matched");
      const stop = repository.findNearbyStops(
        36.3723,
        127.3604,
        30,
      )[0];
      expect(stop).toMatchObject({
        sourceStopNo: "1001",
        nodeId: "DJB1001",
        cityCode: "25",
      });
    } finally {
      repository.close();
    }
  });

  it("필수 헤더가 없으면 누락 컬럼을 명확히 알린다", () => {
    expect(() =>
      mapBusStopHeaders(["정류장명", "위도"]),
    ).toThrow(/정류장번호.*경도/u);
  });
});
