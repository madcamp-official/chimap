import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseSubwayStationsCsvBuffer } from "./subway-csv-importer.js";

const header =
  "역번호,역사명,노선번호,노선명,영문역사명,한자역사명,환승역구분,환승노선번호,환승노선명,역위도,역경도,운영기관명,역사도로명주소,역사전화번호,데이터기준일자";

describe("지하철역 CSV importer", () => {
  it("제공된 전국 파일의 BOM과 최신 중복행을 정규화한다", () => {
    const parsed = parseSubwayStationsCsvBuffer(
      readFileSync(resolve(process.cwd(), "../../data/subway_data.csv")),
    );

    expect(parsed.sourceRowCount).toBe(1_099);
    expect(parsed.rows).toHaveLength(1_097);
    expect(parsed.duplicateRows).toBe(2);
    expect(
      parsed.rows.find(
        (row) => row.name === "대전" && row.lineName === "대전 도시철도 1호선",
      ),
    ).toMatchObject({
      stationCode: "104",
      latitude: 36.331583,
      longitude: 127.433118,
    });
    expect(parsed.rows.some((row) => row.dataDate === "5383")).toBe(true);
  });

  it("필수 헤더가 다르면 전체 파일을 거절한다", () => {
    expect(() =>
      parseSubwayStationsCsvBuffer(Buffer.from("역번호,역사명\n101,판암")),
    ).toThrow(/헤더/u);
  });

  it("잘못된 좌표가 한 행이라도 있으면 전체 파일을 거절한다", () => {
    const source = `${header}\n101,판암,I1,1호선,Panam,板岩,,,,91,127,대전교통공사,,,2026-01-01`;
    expect(() =>
      parseSubwayStationsCsvBuffer(Buffer.from(source)),
    ).toThrow(/위도\/경도/u);
  });
});
