import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import {
  parseTagoResponsePage,
  TagoApiError,
  TagoClient,
  type TagoRouteProviderObservation,
} from "./tago-client.js";

const source = JSON.parse(
  readFileSync(
    new URL(
      "../../test-data/tago-responses-20260725.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  provider: string;
  capturedAt: string;
  documentationCheckedAt: string;
  captures: Array<{
    api: string;
    request: string;
    checksum: string;
    response: unknown;
  }>;
};

const subwaySource = JSON.parse(
  readFileSync(
    new URL(
      "../../test-data/tago-subway-daejeon-20260727.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  provider: string;
  capturedAt: string;
  credentialIncluded: boolean;
  captures: Array<{
    operation: string;
    request: Record<string, string>;
    checksum: string;
    response: unknown;
  }>;
};

describe("실제 TAGO 응답 parser", () => {
  it("출처와 checksum을 검증하고 단일 item을 배열로 정규화한다", () => {
    expect(source.provider).toBe("TAGO");
    expect(Date.parse(source.capturedAt)).not.toBeNaN();
    expect(source.documentationCheckedAt).toBe("2026-07-25");
    for (const item of source.captures) {
      expect(
        createHash("sha256")
          .update(JSON.stringify(item.response))
          .digest("hex"),
      ).toBe(item.checksum);
    }
    const capture = source.captures[0]!;
    expect(capture.request).toContain("nodeid=DJB9002737");

    const page = parseTagoResponsePage(capture.response, {
      service: "stop",
      operation: "getSttnThrghRouteList",
    });
    expect(page.resultCode).toBe("00");
    expect(page.totalCount).toBe(1);
    expect(page.items).toEqual([
      {
        endnodenm: "충대농대종점",
        routeid: "DJB30300043",
        routeno: 108,
        routetp: "간선버스",
        startnodenm: "낭월공영차고지기점",
      },
    ]);
  });

  it("실제 108번 노선 정류장 배열과 순서를 읽는다", () => {
    const capture = source.captures.find((item) =>
      item.api.includes("getRouteAcctoThrghSttnList"),
    );
    expect(capture).toBeDefined();
    const page = parseTagoResponsePage(capture?.response, {
      service: "route",
      operation: "getRouteAcctoThrghSttnList",
    });
    expect(page.totalCount).toBe(89);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.nodeord)).toEqual([1, 2]);
    expect(page.items.map((item) => item.nodeid)).toEqual([
      "DJB8003109",
      "DJB9005538",
    ]);
  });
});

describe("TAGO 지하철 client", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_GO_KR_SERVICE_KEY: "subway-key",
  });

  it("역 검색의 단일 item을 정규화한다", async () => {
    const client = new TagoClient(config, async (input) => {
      expect(String(input)).toContain(
        "/SubwayInfo/GetKwrdFndSubwaySttnList",
      );
      expect(String(input)).toContain("subwayStationName=%EB%8C%80%EC%A0%84");
      return new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              items: {
                item: {
                  subwayStationId: "MTRDJ10004",
                  subwayStationName: "대전",
                  subwayRouteName: "1호선",
                },
              },
              totalCount: 1,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(client.searchSubwayStations("대전")).resolves.toEqual([
      {
        stationId: "MTRDJ10004",
        name: "대전",
        routeName: "1호선",
      },
    ]);
  });

  it("실제 대전역 fixture에서 인증정보 제거와 checksum을 검증한다", () => {
    expect(subwaySource.provider).toBe("TAGO");
    expect(subwaySource.credentialIncluded).toBe(false);
    expect(Date.parse(subwaySource.capturedAt)).not.toBeNaN();
    expect(JSON.stringify(subwaySource)).not.toContain("serviceKey");
    for (const capture of subwaySource.captures) {
      expect(
        createHash("sha256")
          .update(JSON.stringify(capture.response))
          .digest("hex"),
      ).toBe(capture.checksum);
    }
    expect(subwaySource.captures[1]?.request).toEqual({
      subwayStationId: "MTRDJ10004",
      dailyTypeCode: "01",
      upDownTypeCode: "U",
    });
  });

  it("요일과 방향을 전달하고 시간표 필드를 정규화한다", async () => {
    const client = new TagoClient(config, async (input) => {
      expect(String(input)).toContain("dailyTypeCode=01");
      expect(String(input)).toContain("upDownTypeCode=U");
      return new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              items: {
                item: [
                  {
                    subwayStationId: "MTRDJ10004",
                    subwayStationNm: "대전",
                    subwayRouteId: "MTRDJ1",
                    endSubwayStationId: "MTRDJ10001",
                    endSubwayStationNm: "판암(대전대)",
                    depTime: "054500",
                    arrTime: "054500",
                  },
                ],
              },
              totalCount: 1,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(
      client.getSubwaySchedules("MTRDJ10004", "01", "U"),
    ).resolves.toEqual([
      {
        stationId: "MTRDJ10004",
        stationName: "대전",
        subwayRouteId: "MTRDJ1",
        terminalStationId: "MTRDJ10001",
        terminalStationName: "판암(대전대)",
        departureTime: "054500",
        arrivalTime: "054500",
        dailyTypeCode: "01",
        direction: "U",
      },
    ]);
  });

  it("지하철 역 검색도 totalCount에 따라 모든 page를 조회한다", async () => {
    const requestedPages: string[] = [];
    const client = new TagoClient(config, async (input) => {
      const pageNo = new URL(String(input)).searchParams.get("pageNo") ?? "1";
      requestedPages.push(pageNo);
      return new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              items: {
                item: {
                  subwayStationId: `STATION-${pageNo}`,
                  subwayStationName: `대전-${pageNo}`,
                  subwayRouteName: "1호선",
                },
              },
              totalCount: 1001,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(client.searchSubwayStations("대전")).resolves.toHaveLength(2);
    expect(requestedPages).toEqual(["1", "2"]);
  });

  it("지하철 공급자 오류에서도 공통 service key를 마스킹한다", async () => {
    const rawKey = "raw+subway/key";
    const errorConfig = loadConfig({
      NODE_ENV: "test",
      DATA_GO_KR_SERVICE_KEY: rawKey,
      TAGO_HTTP_RETRY_COUNT: "0",
    });
    const client = new TagoClient(errorConfig, async () =>
      new Response(
        JSON.stringify({
          response: {
            header: {
              resultCode: "30",
              resultMsg: `serviceKey=${rawKey}&detail=invalid ${rawKey}`,
            },
            body: {},
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const error = await client.searchSubwayStations("대전").catch((caught) => caught);
    expect(error).toBeInstanceOf(TagoApiError);
    expect((error as TagoApiError).safeMessage).toContain("[REDACTED]");
    expect((error as TagoApiError).safeMessage).not.toContain(rawKey);
  });
});

describe("TAGO route provider 관측", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    DATA_GO_KR_SERVICE_KEY: "route-provider-key",
    TAGO_HTTP_RETRY_COUNT: "0",
  });

  it("고정 operation enum과 결과만 기록하고 요청 좌표는 기록하지 않는다", async () => {
    const observations: TagoRouteProviderObservation[] = [];
    const client = new TagoClient(config, async () =>
      new Response(
        JSON.stringify({
          response: {
            header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
            body: {
              items: { item: { citycode: "25", cityname: "대전" } },
              totalCount: 1,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    await client.getCityCodes();

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      provider: "TAGO",
      operation: "CITY_CODES",
      outcome: "SUCCESS",
      timeoutOrigin: "NONE",
    });
    expect(observations[0]?.durationMilliseconds).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(observations)).not.toContain("serviceKey");
  });

  it("tagged planning abort를 provider timeout과 구분한다", async () => {
    const observations: TagoRouteProviderObservation[] = [];
    const client = new TagoClient(config, async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted === true) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }));
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );
    const controller = new AbortController();
    const pending = client.getNearbyStops(
      { lat: 36.35, lng: 127.37 },
      controller.signal,
    );
    controller.abort({ chimapTimeoutOrigin: "PLANNING" });

    await expect(pending).rejects.toMatchObject({ resultCode: "ABORTED" });
    expect(observations).toEqual([
      expect.objectContaining({
        provider: "TAGO",
        operation: "NEARBY_STOPS",
        outcome: "TIMEOUT",
        timeoutOrigin: "PLANNING",
      }),
    ]);
  });

  it("provider 호출에 건 timeout signal을 provider timeout으로 기록한다", async () => {
    const observations: TagoRouteProviderObservation[] = [];
    const client = new TagoClient(config, async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted === true) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }));
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    await expect(client.getNearbyStops(
      { lat: 36.35, lng: 127.37 },
      AbortSignal.timeout(1),
    )).rejects.toMatchObject({ resultCode: "ABORTED" });

    expect(observations).toEqual([
      expect.objectContaining({
        provider: "TAGO",
        operation: "NEARBY_STOPS",
        outcome: "TIMEOUT",
        timeoutOrigin: "PROVIDER",
      }),
    ]);
  });

  it("추천 hot path의 nearby 조회는 명시된 retry 0회를 지킨다", async () => {
    let requestCount = 0;
    const observations: TagoRouteProviderObservation[] = [];
    const client = new TagoClient(config, async () => {
      requestCount += 1;
      return new Response("unavailable", { status: 503 });
    });
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    await expect(client.getNearbyStops(
      { lat: 36.35, lng: 127.37 },
      undefined,
      { retryCount: 0 },
    )).rejects.toMatchObject({ resultCode: "HTTP_503" });

    expect(requestCount).toBe(1);
    expect(observations).toEqual([
      expect.objectContaining({
        provider: "TAGO",
        operation: "NEARBY_STOPS",
        outcome: "HTTP_5XX",
        timeoutOrigin: "NONE",
      }),
    ]);
  });

  it("HTTP 429를 일반 provider 오류와 분리한다", async () => {
    const observations: TagoRouteProviderObservation[] = [];
    const client = new TagoClient(config, async () =>
      new Response("rate limited", { status: 429 }));
    client.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    await expect(client.getNearbyStops(
      { lat: 36.35, lng: 127.37 },
    )).rejects.toMatchObject({ resultCode: "HTTP_429" });

    expect(observations).toEqual([
      expect.objectContaining({
        provider: "TAGO",
        operation: "NEARBY_STOPS",
        outcome: "RATE_LIMIT",
        timeoutOrigin: "NONE",
      }),
    ]);
  });
});
