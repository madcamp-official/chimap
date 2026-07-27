import type { SubwayStation } from "@chimap/contracts";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { AppMetrics } from "./monitoring/metrics.js";
import type { TransitRepository } from "./transit/transit-repository.js";
import type { TransitService } from "./transit/transit-service.js";

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
  tagoStationId: null,
  tagoRouteName: null,
  mappingStatus: "UNRESOLVED",
  active: true,
};

function testApp(overrides: Partial<TransitService> = {}) {
  const config = loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "test-kakao-key",
  });
  const repository = {
    pool: { totalCount: 0, idleCount: 0, waitingCount: 0 },
    status: async () => ({
      connected: true,
      postgis: true,
      migrationsCurrent: true,
    }),
    stats: async () => ({
      stops: 0,
      linkedStops: 0,
      routes: 0,
      routeStops: 0,
      subwayStations: 1,
      activeSubwayStations: 1,
      mappedSubwayStations: 0,
    }),
  } as unknown as TransitRepository;
  const transitService = {
    repository,
    searchSubwayStations: vi.fn().mockResolvedValue([daejeonStation]),
    findNearbySubwayStations: vi.fn().mockResolvedValue([
      { ...daejeonStation, distanceMeters: 120 },
    ]),
    getSubwayDepartures: vi.fn().mockResolvedValue({
      station: daejeonStation,
      items: [],
      scheduleAvailable: false,
      unavailableReason: "TAGO_STATION_UNRESOLVED",
      fetchedAt: "2026-07-27T03:00:00.000Z",
    }),
    ...overrides,
  } as unknown as TransitService;
  const metrics = new AppMetrics({ config, repository });
  return { app: createApp({ config, transitService, metrics }), transitService };
}

describe("지하철 공개 API", () => {
  it("역명 검색과 좌표 기반 근처 역을 계약 schema로 반환한다", async () => {
    const context = testApp();
    const [searchResponse, nearbyResponse] = await Promise.all([
      request(context.app).get(
        "/api/v1/transit/subway/stations/search?query=%EB%8C%80%EC%A0%84&limit=5",
      ),
      request(context.app).get(
        "/api/v1/transit/subway/stations/nearby?lat=36.3315&lng=127.4331&radiusMeters=500&limit=5",
      ),
    ]);

    expect(searchResponse.status).toBe(200);
    expect(searchResponse.body).toMatchObject({
      total: 1,
      items: [{ id: "223", name: "대전" }],
    });
    expect(nearbyResponse.status).toBe(200);
    expect(nearbyResponse.body.items[0].distanceMeters).toBe(120);
  });

  it("미매핑 역은 404 대신 시간표 불가 사유와 빈 배열을 반환한다", async () => {
    const response = await request(testApp().app).get(
      "/api/v1/transit/subway/stations/223/departures?direction=U&at=2026-07-27T12%3A00%3A00%2B09%3A00&limit=3",
    );

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      items: [],
      scheduleAvailable: false,
      unavailableReason: "TAGO_STATION_UNRESOLVED",
      scheduleBased: true,
      realtimeAvailable: false,
      fetchedAt: "2026-07-27T03:00:00.000Z",
    });
  });

  it("존재하지 않는 역 ID는 404를 반환한다", async () => {
    const context = testApp({
      getSubwayDepartures: vi.fn().mockResolvedValue({
        station: null,
        items: [],
        scheduleAvailable: false,
        unavailableReason: "TAGO_STATION_UNRESOLVED",
        fetchedAt: "2026-07-27T03:00:00.000Z",
      }),
    });
    const response = await request(context.app).get(
      "/api/v1/transit/subway/stations/999/departures?direction=D",
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });
});
