import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseSubwayTopologyDirectory } from "./subway-topology-importer.js";

const fixtureDirectory = fileURLToPath(
  new URL("../../../../data/", import.meta.url),
);

describe("지하철 경로 토폴로지 CSV", () => {
  it("BOM과 다섯 토폴로지 파일의 형식·키를 검증한다", async () => {
    const result = await parseSubwayTopologyDirectory(fixtureDirectory);

    expect(result.serviceLines).toHaveLength(46);
    expect(result.serviceLines.filter((line) => line.isRouteReady)).toHaveLength(
      30,
    );
    expect(result.lineStations).toHaveLength(1_056);
    expect(result.segments).toHaveLength(2_314);
    expect(result.headways).toHaveLength(17_614);
    expect(result.transfers).toHaveLength(341);
    expect(
      result.lineStations.find(
        (station) => station.sourceStationKey === "S3001|104",
      ),
    ).toMatchObject({ stationName: "대전", stationOrder: 4 });
  });
});
