import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import {
  adjustedSeoulWaitSeconds,
  SeoulSubwayClient,
} from "./seoul-subway-client.js";

function config() {
  return loadConfig({
    NODE_ENV: "test",
    SEOUL_SUBWAY_ENABLED: "1",
    SEOUL_SUBWAY_API_KEY: "secret-test-key",
    SEOUL_SUBWAY_BASE_URL: "https://subway.example.test",
  });
}

describe("서울 지하철 실시간 client", () => {
  it("실시간 도착 응답을 정규화하고 수신 시차를 보정한다", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        errorMessage: { status: 200, code: "INFO-000" },
        realtimeArrivalList: [{
          subwayId: "1002",
          statnId: "1002000222",
          statnNm: "강남",
          updnLine: "상행",
          trainLineNm: "성수행 - 역삼방면",
          barvlDt: "120",
          recptnDt: "2026-07-27 12:00:00",
          arvlMsg2: "2분 후",
          btrainNo: "2201",
          btrainSttus: "일반",
        }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const client = new SeoulSubwayClient(config(), request);

    const arrivals = await client.getArrivals("강남");

    expect(arrivals[0]).toMatchObject({
      subwayId: "1002",
      stationName: "강남",
      remainingSeconds: 120,
      directionName: "상행",
    });
    expect(adjustedSeoulWaitSeconds(
      120,
      "2026-07-27 12:00:00",
      new Date("2026-07-27T03:00:30.000Z"),
    )).toBe(90);
    expect(request.mock.calls[0]?.[0]).toContain("secret-test-key");
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
  });

  it("공식 HTTP host만 명시적인 opt-in으로 허용한다", () => {
    expect(() => loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_BASE_URL: "http://swopenapi.seoul.go.kr",
    })).toThrow(/명시적으로 허용/u);
    expect(loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_BASE_URL: "http://swopenapi.seoul.go.kr",
      SEOUL_SUBWAY_ALLOW_INSECURE_HTTP: "1",
    }).seoulSubway).toMatchObject({
      baseUrl: "http://swopenapi.seoul.go.kr",
      allowInsecureHttp: true,
    });
    expect(() => loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_BASE_URL: "http://subway.example.test",
      SEOUL_SUBWAY_ALLOW_INSECURE_HTTP: "1",
    })).toThrow(/공식 swopenapi/u);
  });

  it("HTTP endpoint는 Node 기본 HTTP transport로 조회한다", async () => {
    let connectionHeader: string | undefined;
    const server = createServer((request, response) => {
      connectionHeader = request.headers.connection;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        errorMessage: { status: 200, code: "INFO-000" },
        realtimePositionList: [{
          subwayId: "1001",
          statnId: "1001000133",
          statnNm: "서울",
          trainNo: "1010",
          updnLine: "상행",
          statnTnm: "청량리",
          trainSttus: "2",
          directAt: "0",
          lstcarAt: "0",
          recptnDt: "2026-07-27 12:00:00",
        }],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as AddressInfo;
      const nativeConfig = config();
      nativeConfig.seoulSubway.baseUrl = `http://127.0.0.1:${address.port}`;

      const positions = await new SeoulSubwayClient(nativeConfig)
        .getPositions("1호선");

      expect(positions).toHaveLength(1);
      expect(positions[0]).toMatchObject({
        stationName: "서울",
        trainNo: "1010",
      });
      expect(connectionHeader).toBe("close");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      }));
    }
  });

  it("활성화에는 key가 필요하고 일일 upstream 요청 수를 제한한다", async () => {
    expect(() => loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_ENABLED: "1",
    })).toThrow(/SEOUL_SUBWAY_API_KEY/u);

    const limitedConfig = loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_ENABLED: "1",
      SEOUL_SUBWAY_API_KEY: "secret-test-key",
      SEOUL_SUBWAY_BASE_URL: "https://subway.example.test",
      SEOUL_SUBWAY_DAILY_REQUEST_LIMIT: "1",
    });
    const client = new SeoulSubwayClient(
      limitedConfig,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify({
          errorMessage: { status: 200, code: "INFO-000" },
          realtimeArrivalList: [],
        }),
        { status: 200 },
      )),
    );
    await client.getArrivals("강남");
    await expect(client.getArrivals("서울")).rejects.toMatchObject({
      code: "DAILY_REQUEST_LIMIT",
    });
  });

  it("오류 메시지에 인증키나 요청 URL을 넣지 않는다", async () => {
    const client = new SeoulSubwayClient(
      config(),
      vi.fn<typeof fetch>().mockResolvedValue(new Response("failure", {
        status: 401,
      })),
    );
    await expect(client.getArrivals("강남")).rejects.toMatchObject({
      code: "HTTP_401",
      message: "서울 지하철 API HTTP 401 오류",
    });
  });
});
