import type { BusStop, SubwayStation } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { createLogger } from "../logger.js";
import { TagoApiError, type TagoClient } from "./tago-client.js";
import type { TransitRepository } from "./transit-repository.js";
import { TransitService } from "./transit-service.js";

const kaistNorthGate: BusStop = {
  id: "46278",
  cityCode: "25",
  nodeId: "DJB8007520",
  sourceStopNo: "DJB8007520",
  arsId: "41620",
  name: "한국과학기술원북문",
  latitude: 36.3751,
  longitude: 127.363884,
  distanceMeters: 441,
  source: "csv",
};

const kaistMainBuilding: BusStop = {
  id: "46284",
  cityCode: null,
  nodeId: null,
  sourceStopNo: "DJB8007527",
  arsId: null,
  name: "한국과학기술원본관",
  latitude: 36.37007,
  longitude: 127.360664,
  distanceMeters: 249,
  source: "csv",
};

const linkedMainBuilding: BusStop = {
  ...kaistMainBuilding,
  id: "25:DJB8007527",
  cityCode: "25",
  nodeId: "DJB8007527",
  sourceStopNo: null,
  source: "tago",
};

function serviceWith(input: {
  databaseStops: BusStop[];
  providerStops?: BusStop[];
  providerError?: Error;
}) {
  const getNearbyStops =
    input.providerError === undefined
      ? vi.fn().mockResolvedValue(input.providerStops ?? [])
      : vi.fn().mockRejectedValue(input.providerError);
  const repository = {
    findNearbyStops: vi.fn().mockResolvedValue(input.databaseStops),
    reconcileTagoStop: vi.fn(async (stop: BusStop) => ({
      status: "matched" as const,
      stop,
    })),
  } as unknown as TransitRepository;
  const client = {
    getNearbyStops,
  } as unknown as TagoClient;
  const config = loadConfig({ NODE_ENV: "test" });
  return {
    getNearbyStops,
    repository,
    service: new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client,
    }),
  };
}

describe("TransitService 주변 정류장 보강", () => {
  it("연결된 정류장이 일부 있어도 TAGO를 조회해 나머지 정류장을 연결한다", async () => {
    const context = serviceWith({
      databaseStops: [kaistMainBuilding, kaistNorthGate],
      providerStops: [linkedMainBuilding, kaistNorthGate],
    });

    const result = await context.service.getNearbyStops(
      { lat: 36.3723, lng: 127.3604 },
      500,
    );

    expect(context.getNearbyStops).toHaveBeenCalledOnce();
    expect(context.repository.reconcileTagoStop).toHaveBeenCalledTimes(2);
    expect(result.partial).toBe(false);
    expect(result.items.map((stop) => stop.nodeId)).toEqual([
      "DJB8007527",
      "DJB8007520",
    ]);
  });

  it("TAGO가 일시 실패하면 기존 실제 정류장을 유지하고 일부 결과임을 표시한다", async () => {
    const context = serviceWith({
      databaseStops: [kaistNorthGate],
      providerError: new TagoApiError({
        service: "stop",
        operation: "getCrdntPrxmtSttnList",
        resultCode: "HTTP_503",
        safeMessage: "TAGO 정류장 조회가 일시 지연되었습니다.",
        retryable: true,
      }),
    });

    const result = await context.service.getNearbyStops(
      { lat: 36.3723, lng: 127.3604 },
      500,
    );

    expect(result).toEqual({
      items: [kaistNorthGate],
      partial: true,
    });
  });
});

const daejeonStation: SubwayStation = {
  id: "223",
  stationCode: "104",
  name: "대전",
  lineCode: "S3001",
  lineName: "대전 도시철도 1호선",
  englishName: "Daejeon",
  hanjaName: "大田",
  transferType: "일반역",
  transferLineCode: null,
  transferLineName: null,
  latitude: 36.331583,
  longitude: 127.433118,
  operatorName: "대전교통공사",
  roadAddress: "대전광역시 동구 중앙로 지하 218 (중동)",
  phoneNumber: "042-539-3604",
  dataDate: "2026-06-25",
  tagoStationId: "MTRDJ10004",
  tagoRouteName: "1호선",
  mappingStatus: "MAPPED",
  active: true,
};

describe("TransitService TAGO 지하철 시간표", () => {
  it.each([
    ["평일", "2026-07-27T11:00:00+09:00", "U", "01"],
    ["토요일", "2026-07-25T11:00:00+09:00", "D", "02"],
    ["일요일", "2026-07-26T11:00:00+09:00", "U", "03"],
  ] as const)("%s의 요일 코드와 %s 방향을 사용한다", async (_label, at, direction, dailyTypeCode) => {
    const getSubwaySchedules = vi.fn().mockResolvedValue([
      {
        stationId: "MTRDJ10004",
        stationName: "대전",
        subwayRouteId: "MTRDJ1",
        terminalStationId: "MTRDJ10001",
        terminalStationName: "판암(대전대)",
        departureTime: "120000",
        arrivalTime: "120000",
        dailyTypeCode,
        direction,
      },
    ]);
    const repository = {
      getSubwayStation: vi.fn().mockResolvedValue(daejeonStation),
    } as unknown as TransitRepository;
    const client = { getSubwaySchedules } as unknown as TagoClient;
    const config = loadConfig({
      NODE_ENV: "test",
      DATA_GO_KR_SERVICE_KEY: "subway-key",
    });
    const service = new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client,
    });

    const result = await service.getSubwayDepartures({
      stationId: daejeonStation.id,
      direction,
      at: new Date(at),
      limit: 3,
    });

    expect(getSubwaySchedules).toHaveBeenCalledWith(
      "MTRDJ10004",
      dailyTypeCode,
      direction,
      undefined,
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        dailyTypeCode,
        direction,
        rawDepartureTime: "120000",
        departureAt: at.replace("11:00:00", "12:00:00"),
        scheduleBased: true,
      }),
    ]);
  });

  it("TAGO 미매핑 역에는 명시적인 사유와 빈 시간표를 반환한다", async () => {
    const repository = {
      getSubwayStation: vi.fn().mockResolvedValue({
        ...daejeonStation,
        tagoStationId: null,
        tagoRouteName: null,
        mappingStatus: "UNRESOLVED",
      }),
    } as unknown as TransitRepository;
    const config = loadConfig({ NODE_ENV: "test" });
    const service = new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client: {} as TagoClient,
    });

    await expect(
      service.getSubwayDepartures({
        stationId: daejeonStation.id,
        direction: "U",
        at: new Date("2026-07-27T11:00:00+09:00"),
        limit: 3,
      }),
    ).resolves.toMatchObject({
      items: [],
      scheduleAvailable: false,
      unavailableReason: "TAGO_STATION_UNRESOLVED",
    });
  });
});

describe("TransitService TAGO 역 매핑", () => {
  it("역명과 노선번호가 정확한 단일 후보만 매핑하고 같은 역명 검색을 공유한다", async () => {
    const stations = [
      { ...daejeonStation, id: "223", tagoStationId: null, mappingStatus: "PENDING" as const },
      { ...daejeonStation, id: "224", tagoStationId: null, mappingStatus: "UNRESOLVED" as const },
    ];
    const updateSubwayStationMapping = vi.fn().mockResolvedValue(undefined);
    const repository = {
      subwayStationsForMapping: vi.fn().mockResolvedValue(stations),
      updateSubwayStationMapping,
    } as unknown as TransitRepository;
    const searchSubwayStations = vi.fn().mockResolvedValue([
      { stationId: "MTRDJ10004", name: "대전역", routeName: "1호선" },
      { stationId: "WRONG", name: "대전", routeName: "11호선" },
    ]);
    const config = loadConfig({
      NODE_ENV: "test",
      DATA_GO_KR_SERVICE_KEY: "subway-key",
    });
    const service = new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client: { searchSubwayStations } as unknown as TagoClient,
    });

    await expect(service.syncSubwayStationMappings(4)).resolves.toEqual({
      mapped: 2,
      unresolved: 0,
      failed: 0,
      checked: 2,
    });
    expect(searchSubwayStations).toHaveBeenCalledOnce();
    expect(updateSubwayStationMapping).toHaveBeenCalledTimes(2);
    expect(updateSubwayStationMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "MAPPED",
        tagoStationId: "MTRDJ10004",
      }),
    );
  });

  it("역명·노선 후보가 복수이면 fuzzy 선택 없이 UNRESOLVED로 남긴다", async () => {
    const updateSubwayStationMapping = vi.fn().mockResolvedValue(undefined);
    const repository = {
      subwayStationsForMapping: vi.fn().mockResolvedValue([
        { ...daejeonStation, tagoStationId: null, mappingStatus: "PENDING" },
      ]),
      updateSubwayStationMapping,
    } as unknown as TransitRepository;
    const config = loadConfig({
      NODE_ENV: "test",
      DATA_GO_KR_SERVICE_KEY: "subway-key",
    });
    const service = new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client: {
        searchSubwayStations: vi.fn().mockResolvedValue([
          { stationId: "A", name: "대전", routeName: "1호선" },
          { stationId: "B", name: "대전역", routeName: "대전 도시철도 1호선" },
        ]),
      } as unknown as TagoClient,
    });

    await expect(service.syncSubwayStationMappings()).resolves.toEqual({
      mapped: 0,
      unresolved: 1,
      failed: 0,
      checked: 1,
    });
    expect(updateSubwayStationMapping).toHaveBeenCalledWith({
      id: daejeonStation.id,
      status: "UNRESOLVED",
      canonicalStatus: "AMBIGUOUS",
      tagoStationId: null,
      tagoRouteName: null,
    });
  });

  it("TAGO 일시 실패 역만 보류하고 나머지 매핑을 계속한다", async () => {
    const stations = [
      {
        ...daejeonStation,
        id: "223",
        tagoStationId: null,
        mappingStatus: "PENDING" as const,
      },
      {
        ...daejeonStation,
        id: "224",
        tagoStationId: null,
        mappingStatus: "PENDING" as const,
      },
    ];
    const updateSubwayStationMapping = vi.fn().mockResolvedValue(undefined);
    const repository = {
      subwayStationsForMapping: vi.fn().mockResolvedValue(stations),
      updateSubwayStationMapping,
    } as unknown as TransitRepository;
    const searchSubwayStations = vi
      .fn()
      .mockRejectedValueOnce(
        new TagoApiError({
          service: "subway",
          operation: "GetKwrdFndSubwaySttnList",
          resultCode: "TIMEOUT",
          safeMessage: "TAGO API 요청 시간이 초과되었습니다.",
          retryable: true,
        }),
      )
      .mockResolvedValueOnce([
        { stationId: "MTRDJ10004", name: "대전역", routeName: "1호선" },
      ]);
    const config = loadConfig({
      NODE_ENV: "test",
      DATA_GO_KR_SERVICE_KEY: "subway-key",
    });
    const service = new TransitService({
      config,
      logger: createLogger(config),
      repository,
      client: { searchSubwayStations } as unknown as TagoClient,
    });

    await expect(service.syncSubwayStationMappings(1)).resolves.toEqual({
      mapped: 1,
      unresolved: 0,
      failed: 1,
      checked: 2,
    });
    expect(updateSubwayStationMapping).toHaveBeenCalledOnce();
    expect(updateSubwayStationMapping).toHaveBeenCalledWith(
      expect.objectContaining({ id: "224", status: "MAPPED" }),
    );
  });
});
