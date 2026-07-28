import { describe, expect, it } from "vitest";

import type {
  CsvSubwayStation,
  CsvSubwayTopology,
} from "./transit-repository.js";
import { validateSubwaySegmentShapeGeoJson } from "./subway-segment-shape-importer.js";

const stations: CsvSubwayStation[] = [
  station("A", "36.3500", "127.3800"),
  station("B", "36.3500", "127.3900"),
  station("C", "36.3500", "127.4000"),
];

function station(
  stationCode: string,
  latitude: string,
  longitude: string,
): CsvSubwayStation {
  return {
    stationCode,
    name: stationCode,
    lineCode: "L",
    lineName: "테스트선",
    englishName: null,
    hanjaName: null,
    transferType: null,
    transferLineCode: null,
    transferLineName: null,
    latitude: Number(latitude),
    longitude: Number(longitude),
    operatorName: "테스트공사",
    roadAddress: null,
    phoneNumber: null,
    dataDate: "2026-07-28",
  };
}

const topology: CsvSubwayTopology = {
  serviceLines: [
    {
      serviceLineId: "LINE",
      regionCode: "30",
      regionName: "대전",
      operatorName: "테스트공사",
      serviceLineName: "테스트선",
      stationCount: 3,
      matchedStationCount: 3,
      segmentCount: 4,
      fallbackHeadwayCount: 0,
      isBranching: false,
      isRouteReady: true,
      timingProviderDefault: "FALLBACK",
    },
  ],
  lineStations: ["A", "B", "C"].map((key, index) => ({
    serviceLineId: "LINE",
    stationOrder: index + 1,
    orderConflict: false,
    sourceLineId: "L",
    sourceStationId: key,
    sourceStationKey: `L|${key}`,
    stationName: key,
  })),
  segments: [
    ["L|A", "L|B"],
    ["L|B", "L|A"],
    ["L|B", "L|C"],
    ["L|C", "L|B"],
  ].map(([fromSourceStationKey, toSourceStationKey]) => ({
    serviceLineId: "LINE",
    fromSourceStationKey: fromSourceStationKey!,
    toSourceStationKey: toSourceStationKey!,
    durationSeconds: 60,
    averageDurationSeconds: 60,
    straightDistanceMeters: 900,
    sampleCount: 1,
    durationMethod: "TEST",
  })),
  headways: [],
  transfers: [],
};

const points = {
  "L|A": [127.38, 36.35],
  "L|B": [127.39, 36.35],
  "L|C": [127.4, 36.35],
} as const;

function feature(from: keyof typeof points, to: keyof typeof points) {
  const start = points[from];
  const end = points[to];
  return {
    type: "Feature",
    properties: {
      service_line_id: "LINE",
      from_source_station_key: from,
      to_source_station_key: to,
      geometry_source: "OpenStreetMap relation 1",
      geometry_source_url: "https://www.openstreetmap.org/relation/1",
      geometry_source_hash: "a".repeat(64),
      geometry_license: "ODbL-1.0",
      geometry_version: "osm-2026-07-28",
      geometry_updated_at: "2026-07-28T00:00:00Z",
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [...start],
        [(start[0] + end[0]) / 2, start[1] + 0.001],
        [...end],
      ],
    },
  };
}

function collection(features = [
  feature("L|A", "L|B"),
  feature("L|B", "L|A"),
  feature("L|B", "L|C"),
  feature("L|C", "L|B"),
]) {
  return { type: "FeatureCollection", features };
}

describe("지하철 구간 선로 GeoJSON 검증", () => {
  it("전 구간 coverage와 출처를 검증한다", () => {
    const result = validateSubwaySegmentShapeGeoJson({
      source: collection(),
      checksum: "dataset-checksum",
      topology,
      stations,
    });

    expect(result.rows).toHaveLength(4);
    expect(result.report.coverage).toEqual([
      {
        serviceLineId: "LINE",
        segmentCount: 4,
        geometryCount: 4,
        coverage: 1,
      },
    ]);
    expect(result.report.sourceCounts).toEqual({
      "OpenStreetMap relation 1": 4,
    });
  });

  it("반대 방향 좌표를 자동으로 정규화한다", () => {
    const reversed = feature("L|A", "L|B");
    reversed.geometry.coordinates.reverse();
    const result = validateSubwaySegmentShapeGeoJson({
      source: collection([
        reversed,
        feature("L|B", "L|A"),
        feature("L|B", "L|C"),
        feature("L|C", "L|B"),
      ]),
      checksum: "dataset-checksum",
      topology,
      stations,
    });

    expect(result.report.reversedCount).toBe(1);
    expect(result.rows[0]?.coordinates[0]).toEqual({ lat: 36.35, lng: 127.38 });
  });

  it("중복 구간과 불완전 coverage를 거부한다", () => {
    expect(() =>
      validateSubwaySegmentShapeGeoJson({
        source: collection([
          feature("L|A", "L|B"),
          feature("L|A", "L|B"),
        ]),
        checksum: "dataset-checksum",
        topology,
        stations,
      }),
    ).toThrow(/중복 지하철 구간/u);
    expect(() =>
      validateSubwaySegmentShapeGeoJson({
        source: collection([feature("L|A", "L|B")]),
        checksum: "dataset-checksum",
        topology,
        stations,
      }),
    ).toThrow(/완전하지 않습니다/u);
  });

  it("한국 영역 밖 좌표와 라이선스 없는 feature를 거부한다", () => {
    const invalidCoordinate = feature("L|A", "L|B");
    invalidCoordinate.geometry.coordinates[1] = [10, 10];
    expect(() =>
      validateSubwaySegmentShapeGeoJson({
        source: collection([invalidCoordinate]),
        checksum: "dataset-checksum",
        topology,
        stations,
        requireComplete: false,
      }),
    ).toThrow();

    const invalidLicense = feature("L|A", "L|B");
    invalidLicense.properties.geometry_license = "";
    expect(() =>
      validateSubwaySegmentShapeGeoJson({
        source: collection([invalidLicense]),
        checksum: "dataset-checksum",
        topology,
        stations,
        requireComplete: false,
      }),
    ).toThrow();
  });

  it("역 끝점은 허용 범위지만 인접 구간이 크게 끊기면 거부한다", () => {
    const before = feature("L|A", "L|B");
    before.geometry.coordinates.at(-1)![0] = 127.388;
    const after = feature("L|B", "L|C");
    after.geometry.coordinates[0]![0] = 127.392;
    expect(() =>
      validateSubwaySegmentShapeGeoJson({
        source: collection([
          before,
          feature("L|B", "L|A"),
          after,
          feature("L|C", "L|B"),
        ]),
        checksum: "dataset-checksum",
        topology,
        stations,
      }),
    ).toThrow(/연속 구간 간격/u);
  });
});
