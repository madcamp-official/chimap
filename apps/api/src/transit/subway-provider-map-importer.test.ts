import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSubwayProviderMapFile } from "./subway-provider-map-importer.js";

const fixture = fileURLToPath(
  new URL(
    "../../../../data/subway_provider_station_map_template.csv",
    import.meta.url,
  ),
);

describe("지하철 provider mapping CSV", () => {
  it("BOM과 원본 역 키, provider 값을 검증한다", async () => {
    const rows = await parseSubwayProviderMapFile(fixture);

    expect(rows).toHaveLength(1_099);
    expect(rows.find((row) => row.sourceStationKey === "S3001|104"))
      .toMatchObject({
        stationName: "대전",
        preferredProvider: "TAGO_TIMETABLE",
      });
  });
});
