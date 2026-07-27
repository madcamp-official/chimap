import type { SubwayStation } from "@chimap/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getNearbySubwayStations,
  getSubwayDepartures,
} from "./api.js";

const station: SubwayStation = {
  id: "42",
  stationCode: "DJB104",
  name: "대전",
  lineCode: "1",
  lineName: "대전 1호선",
  englishName: "Daejeon",
  hanjaName: null,
  transferType: null,
  transferLineCode: null,
  transferLineName: null,
  latitude: 36.3315,
  longitude: 127.4331,
  operatorName: "대전교통공사",
  roadAddress: "대전광역시 동구 중앙로 지하 218",
  phoneNumber: null,
  dataDate: "2026-07-27",
  tagoStationId: "MTR_DJB_104",
  tagoRouteName: "대전도시철도 1호선",
  mappingStatus: "MAPPED",
  active: true,
  distanceMeters: 95,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subway api client", () => {
  it("좌표·반경·개수로 주변 역 API를 호출하고 계약을 검증한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ items: [station], total: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getNearbySubwayStations({
        coordinate: { lat: 36.332, lng: 127.434 },
        radiusMeters: 1_500,
        limit: 4,
      }),
    ).resolves.toEqual({ items: [station], total: 1 });

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8080/api/v1/transit/subway/stations/nearby?lat=36.332&lng=127.434&radiusMeters=1500&limit=4",
    );
    expect(request.credentials).toBe("include");
  });

  it("역 ID와 방향으로 시간표 기반 응답을 읽는다", async () => {
    const response = {
      items: [],
      scheduleAvailable: false,
      unavailableReason: "NO_UPCOMING_DEPARTURES",
      scheduleBased: true,
      realtimeAvailable: false,
      fetchedAt: "2026-07-27T23:30:00+09:00",
    } as const;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(response),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getSubwayDepartures({
        stationId: "42",
        direction: "D",
        at: "2026-07-27T23:30:00+09:00",
        limit: 2,
      }),
    ).resolves.toEqual(response);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:8080/api/v1/transit/subway/stations/42/departures?direction=D&limit=2&at=2026-07-27T23%3A30%3A00%2B09%3A00",
    );
  });
});
