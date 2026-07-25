import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import {
  normalizeItems,
  parseTagoResponsePage,
  TagoApiError,
  TagoClient,
} from "./tago-client.js";

function tagoResponse(item?: unknown, totalCount?: number) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "OK" },
      body: {
        ...(item === undefined ? {} : { items: { item } }),
        ...(totalCount === undefined ? {} : { totalCount }),
      },
    },
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TAGO 공통 응답 처리", () => {
  it("단일 item, 배열, 빈 items를 항상 배열로 정규화한다", () => {
    expect(normalizeItems({ nodeid: "A" })).toEqual([{ nodeid: "A" }]);
    expect(normalizeItems([{ nodeid: "A" }, { nodeid: "B" }])).toHaveLength(
      2,
    );
    expect(normalizeItems(undefined)).toEqual([]);
    expect(
      parseTagoResponsePage(tagoResponse(), {
        service: "stop",
        operation: "getCrdntPrxmtSttnList",
      }).items,
    ).toEqual([]);
  });

  it("정상이 아닌 resultCode를 구조화 오류로 변환한다", () => {
    expect(() =>
      parseTagoResponsePage(
        {
          response: {
            header: { resultCode: "30", resultMsg: "SERVICE KEY ERROR" },
            body: {},
          },
        },
        {
          service: "arrival",
          operation: "getSttnAcctoArvlPrearngeInfoList",
        },
      ),
    ).toThrow(TagoApiError);
    try {
      parseTagoResponsePage(
        {
          response: {
            header: { resultCode: "30", resultMsg: "SERVICE KEY ERROR" },
            body: {},
          },
        },
        {
          service: "arrival",
          operation: "getSttnAcctoArvlPrearngeInfoList",
        },
      );
    } catch (error) {
      expect(error).toMatchObject({
        service: "arrival",
        operation: "getSttnAcctoArvlPrearngeInfoList",
        resultCode: "30",
        retryable: false,
      });
    }
  });

  it("Encoding 키를 이중 인코딩하지 않고 오류에서 키를 제거한다", async () => {
    const encodedKey = "sample%2Bkey%3D%3D";
    let requestedUrl = "";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return jsonResponse({
        response: {
          header: {
            resultCode: "30",
            resultMsg: `invalid serviceKey=${encodedKey}`,
          },
          body: {},
        },
      });
    });
    const client = new TagoClient(
      loadConfig({
        NODE_ENV: "test",
        KAKAO_MODE: "mock",
        DATA_GO_KR_SERVICE_KEY: encodedKey,
      }),
      fetchMock,
    );

    await expect(client.getCityCodes()).rejects.toMatchObject({
      resultCode: "30",
      safeMessage: expect.not.stringContaining(encodedKey),
    });
    expect(requestedUrl).toContain(`serviceKey=${encodedKey}`);
    expect(requestedUrl).not.toContain("%252B");
  });

  it("5xx만 설정된 횟수만큼 재시도한다", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 502))
      .mockResolvedValueOnce(
        jsonResponse(
          tagoResponse(
            { citycode: "25", cityname: "대전광역시" },
            1,
          ),
        ),
      );
    const client = new TagoClient(
      loadConfig({
        NODE_ENV: "test",
        KAKAO_MODE: "mock",
        DATA_GO_KR_SERVICE_KEY: "not-a-real-key",
        TAGO_HTTP_RETRY_COUNT: "2",
      }),
      fetchMock,
    );

    await expect(client.getCityCodes()).resolves.toEqual([
      { cityCode: "25", cityName: "대전광역시" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
