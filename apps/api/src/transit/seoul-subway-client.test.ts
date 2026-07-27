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
  });

  it("HTTPS가 아닌 base URL과 key 없는 활성화를 거절한다", () => {
    expect(() => loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_BASE_URL: "http://swopenapi.seoul.go.kr",
    })).toThrow(/HTTPS/u);
    expect(() => loadConfig({
      NODE_ENV: "test",
      SEOUL_SUBWAY_ENABLED: "1",
    })).toThrow(/SEOUL_SUBWAY_API_KEY/u);
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
