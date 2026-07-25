import type { RecommendationRequest } from "@chimap/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { MockMobilityProvider } from "./test-fixtures/mock-provider.js";
import type { TransitService } from "./transit/transit-service.js";

const fixedNow = new Date("2026-07-24T08:00:00.000Z");
const config = loadConfig({
  NODE_ENV: "test",
  KAKAO_MODE: "mock",
  LOG_LEVEL: "silent",
});

function recommendationInput(
  overrides: Partial<RecommendationRequest> = {},
): RecommendationRequest {
  return {
    origin: {
      id: "kaist",
      name: "한국과학기술원 KAIST",
      address: "대전 유성구 구성동 23",
      roadAddress: "대전 유성구 대학로 291",
      category: "교육 > 대학교",
      location: { lng: 127.3604, lat: 36.3723 },
    },
    destination: {
      id: "daejeon-station",
      name: "대전역",
      address: "대전 동구 정동 1-1",
      roadAddress: "대전 동구 중앙로 215",
      category: "교통 > 기차역",
      location: { lng: 127.4342, lat: 36.3321 },
    },
    deadline: "2026-07-24T09:00:00.000Z",
    currentSteps: 5200,
    goalSteps: 8000,
    maxExtraMinutes: 25,
    strideLengthMeters: 0.7,
    safetyBufferMinutes: 3,
    ...overrides,
  };
}

function app(options?: {
  provider?: MockMobilityProvider;
  placesMax?: number;
  transitService?: TransitService;
}) {
  return createApp({
    config,
    provider: options?.provider ?? new MockMobilityProvider(),
    ...(options?.transitService === undefined
      ? {}
      : { transitService: options.transitService }),
    logger: createLogger(config),
    clock: () => new Date(fixedNow),
    ...(options?.placesMax === undefined
      ? {}
      : {
          rateLimits: {
            placesMax: options.placesMax,
            recommendationsMax: 10,
            windowMs: 60_000,
          },
        }),
  });
}

describe("CHIMap API", () => {
  it("health에서 비밀 없이 mock 상태를 반환한다", async () => {
    const response = await request(app()).get("/api/v1/health").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      mode: "mock",
      timestamp: fixedNow.toISOString(),
    });
    expect(JSON.stringify(response.body)).not.toContain("KAKAO");
  });

  it("production 웹 정적 파일과 SPA fallback을 같은 origin에서 제공한다", async () => {
    const webDistPath = await mkdtemp(join(tmpdir(), "chimap-web-"));
    try {
      await mkdir(join(webDistPath, "assets"));
      await writeFile(
        join(webDistPath, "index.html"),
        "<!doctype html><title>CHIMap production</title>",
      );
      await writeFile(
        join(webDistPath, "assets", "app.js"),
        "globalThis.chimap = true;",
      );
      const productionConfig = {
        ...config,
        nodeEnv: "production",
        webDistPath,
      };
      const productionApp = createApp({
        config: productionConfig,
        provider: new MockMobilityProvider(),
        logger: createLogger(productionConfig),
        clock: () => new Date(fixedNow),
      });

      const root = await request(productionApp).get("/").expect(200);
      expect(root.text).toContain("CHIMap production");
      expect(root.headers["cache-control"]).toBe("no-cache");

      const spaRoute = await request(productionApp)
        .get("/saved-route")
        .expect(200);
      expect(spaRoute.text).toContain("CHIMap production");

      const asset = await request(productionApp)
        .get("/assets/app.js")
        .expect(200);
      expect(asset.headers["cache-control"]).toContain("immutable");

      const missingApi = await request(productionApp)
        .get("/api/v1/missing")
        .expect(404);
      expect(missingApi.body.error.code).toBe("NOT_FOUND");
    } finally {
      await rm(webDistPath, { recursive: true, force: true });
    }
  });

  it("설정한 웹 origin만 CORS로 허용한다", async () => {
    const allowed = await request(app())
      .get("/api/v1/health")
      .set("origin", "http://localhost:5173")
      .expect(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:5173",
    );

    const denied = await request(app())
      .get("/api/v1/health")
      .set("origin", "https://untrusted.example")
      .expect(403);
    expect(denied.body.error.code).toBe("VALIDATION_ERROR");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("mock 장소 검색을 정규화해 반환한다", async () => {
    const response = await request(app())
      .get("/api/v1/places")
      .query({ query: "KAIST", x: 127.36, y: 36.37 })
      .expect(200);
    expect(response.body.items[0]).toMatchObject({
      id: "kaist",
      name: expect.stringContaining("KAIST"),
      location: { lng: 127.3604, lat: 36.3723 },
    });
  });

  it("정상 추천과 mock 경고, 서로 다른 경로를 반환한다", async () => {
    const response = await request(app())
      .post("/api/v1/recommendations")
      .send(recommendationInput())
      .expect(200);

    expect(response.body.mode).toBe("mock");
    expect(response.body.recommendations.length).toBeGreaterThanOrEqual(2);
    expect(response.body.recommendations.length).toBeLessThanOrEqual(3);
    expect(
      new Set(response.body.recommendations.map((item: { id: string }) => item.id))
        .size,
    ).toBe(response.body.recommendations.length);
    expect(response.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DEMO_DATA" }),
        expect.objectContaining({ code: "ESTIMATED_STEPS" }),
      ]),
    );
  });

  it("입력 검증 실패에 requestId와 fieldErrors를 포함한다", async () => {
    const response = await request(app())
      .post("/api/v1/recommendations")
      .send(recommendationInput({ strideLengthMeters: 0.1 }))
      .expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.requestId).toMatch(
      /^[0-9a-f-]{36}$/u,
    );
    expect(response.body.error.fieldErrors).toBeDefined();
  });

  it("잘못된 JSON을 일관된 검증 오류로 반환한다", async () => {
    const response = await request(app())
      .post("/api/v1/recommendations")
      .set("content-type", "application/json")
      .send('{"origin":')
      .expect(400);
    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "올바른 JSON 요청 본문을 보내 주세요.",
    });
    expect(response.body.error.requestId).toBeDefined();
  });

  it("32KB보다 큰 JSON 요청을 제한한다", async () => {
    const response = await request(app())
      .post("/api/v1/recommendations")
      .send({ oversized: "x".repeat(33 * 1024) })
      .expect(413);
    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "요청 본문은 32KB를 넘을 수 없어요.",
    });
    expect(response.body.error.requestId).toBeDefined();
  });

  it("마감시간 안에 baseline도 도착하지 못하면 명시적으로 실패한다", async () => {
    const response = await request(app())
      .post("/api/v1/recommendations")
      .send(
        recommendationInput({
          deadline: "2026-07-24T08:40:00.000Z",
        }),
      )
      .expect(404);
    expect(response.body.error.code).toBe("NO_ROUTE_WITHIN_DEADLINE");
  });

  it("일부 후보 실패 시 성공 결과와 warning을 함께 반환한다", async () => {
    const response = await request(
      app({
        provider: new MockMobilityProvider({
          scenario: "PARTIAL_CANDIDATE_FAILURE",
        }),
      }),
    )
      .post("/api/v1/recommendations")
      .send(recommendationInput())
      .expect(200);
    expect(response.body.recommendations.length).toBeGreaterThan(0);
    expect(response.body.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PARTIAL_CANDIDATE_FAILURE" }),
      ]),
    );
  });

  it("엔드포인트별 rate limit을 일관된 오류로 반환한다", async () => {
    const limitedApp = app({ placesMax: 1 });
    await request(limitedApp)
      .get("/api/v1/places")
      .query({ query: "KAIST" })
      .expect(200);
    const response = await request(limitedApp)
      .get("/api/v1/places")
      .query({ query: "대전역" })
      .expect(429);
    expect(response.body.error.code).toBe("RATE_LIMITED");
    expect(response.body.error.requestId).toBeDefined();
  });

  it("정류장, 도착, 노선 차량 API를 공유 계약으로 반환한다", async () => {
    const fetchedAt = fixedNow.toISOString();
    const transitService = {
      async getNearbyStops() {
        return {
          partial: false,
          items: [
            {
              id: "25:DJB1",
              cityCode: "25",
              nodeId: "DJB1",
              sourceStopNo: null,
              arsId: "1001",
              name: "테스트 정류장",
              latitude: 36.37,
              longitude: 127.36,
              distanceMeters: 30,
              source: "tago",
            },
          ],
        };
      },
      async getArrivals() {
        return [
          {
            cityCode: "25",
            nodeId: "DJB1",
            routeId: "DJB104",
            routeNo: "104",
            routeType: "간선",
            remainingStops: 2,
            arrivalSeconds: 180,
            arrivalMinutes: 3,
            vehicleType: "저상버스",
            isRealtime: true,
            fetchedAt,
          },
        ];
      },
      async getVehiclePositions() {
        return [
          {
            cityCode: "25",
            routeId: "DJB104",
            routeNo: "104",
            vehicleNo: null,
            latitude: 36.36,
            longitude: 127.38,
            nodeId: "DJB2",
            nodeName: "다음 정류장",
            nodeOrder: 2,
            routeType: "간선",
            fetchedAt,
          },
        ];
      },
    } as unknown as TransitService;
    const transitApp = app({ transitService });

    const nearby = await request(transitApp)
      .get("/api/v1/transit/bus/stops/nearby")
      .query({ lat: 36.37, lng: 127.36 })
      .expect(200);
    expect(nearby.body).toMatchObject({
      partial: false,
      items: [expect.objectContaining({ nodeId: "DJB1" })],
    });

    const arrivals = await request(transitApp)
      .get("/api/transit/bus/stops/DJB1/arrivals")
      .query({ cityCode: "25" })
      .expect(200);
    expect(arrivals.body).toMatchObject({
      realtimeAvailable: true,
      items: [expect.objectContaining({ arrivalMinutes: 3 })],
    });

    const vehicles = await request(transitApp)
      .get("/api/v1/transit/bus/routes/DJB104/vehicles")
      .query({ cityCode: "25" })
      .expect(200);
    expect(vehicles.body).toMatchObject({
      realtimeAvailable: true,
      items: [expect.objectContaining({ routeNo: "104" })],
    });
  });
});
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
