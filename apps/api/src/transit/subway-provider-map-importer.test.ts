import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSubwayProviderMapFile } from "./subway-provider-map-importer.js";

const fixture = fileURLToPath(
  new URL("./fixtures/subway-provider-map.csv", import.meta.url),
);

describe("지하철 provider mapping CSV", () => {
  it("BOM과 원본 역 키, provider 값을 검증한다", async () => {
    const rows = await parseSubwayProviderMapFile(fixture);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.sourceStationKey === "S3001|104"))
      .toMatchObject({
        stationName: "대전",
        preferredProvider: "TAGO_TIMETABLE",
      });
    expect(rows.find((row) => row.sourceStationKey === "1001|0150"))
      .toMatchObject({
        stationName: "서울역",
        preferredProvider: "SEOUL_REALTIME",
        seoulSubwayId: "1001",
        seoulStationId: "0150",
      });
  });
});
