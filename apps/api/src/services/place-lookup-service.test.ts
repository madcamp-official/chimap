import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  normalizeKakaoPlaceResponse,
} from "../providers/kakao-normalizers.js";
import { KakaoLocalClient } from "../providers/kakao-local-client.js";
import { KakaoRestClient } from "../providers/kakao-rest-client.js";
import { NaverGeocodingClient } from "../providers/naver-geocoding-client.js";
import { mergePlaces, PlaceLookupService } from "./place-lookup-service.js";

type Capture = {
  api: string;
  response: unknown;
};

function readCaptures(fileName: string): Capture[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../test-data/${fileName}`, import.meta.url),
        "utf8",
      ),
    ) as { captures: Capture[] }
  ).captures;
}

const kakaoCaptures = readCaptures("kakao-responses-20260725.json");
const naverCaptures = readCaptures("naver-responses-20260725.json");

function responseFor(captures: Capture[], path: string): unknown {
  const capture = captures.find((item) => item.api.includes(path));
  if (capture === undefined) {
    throw new Error(`${path} 실제 응답 캡처를 찾을 수 없습니다.`);
  }
  return capture.response;
}

describe("실제 장소 검색 조합", () => {
  it("같은 실제 Kakao 장소가 두 목록에 있으면 20m 규칙으로 합친다", () => {
    const places = normalizeKakaoPlaceResponse(
      responseFor(kakaoCaptures, "search/keyword"),
    );
    expect(
      mergePlaces("카이스트", places, places, 8),
    ).toEqual(places);
  });

  it("Kakao의 복구 가능한 HTTP 오류에서 실제 NAVER 주소로 보완한다", async () => {
    const kakaoFetch = vi.fn(async () =>
      new Response('{"message":"temporarily unavailable"}', {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const naverFetch = vi.fn(async () =>
      new Response(
        JSON.stringify(responseFor(naverCaptures, "map-geocode")),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const service = new PlaceLookupService({
      kakao: new KakaoLocalClient(
        new KakaoRestClient("test-kakao-key", kakaoFetch),
      ),
      naver: new NaverGeocodingClient(
        "test-naver-id",
        "test-naver-key",
        naverFetch,
      ),
    });

    const result = await service.search({
      query: "대전 유성구 대학로 291",
      scope: "resolve",
      limit: 8,
    });
    expect(result.meta).toEqual({
      provider: "NAVER",
      strategy: "NAVER_GEOCODE",
      fallbackUsed: true,
      degraded: true,
    });
    expect(result.items[0]?.name).toBe("한국과학기술원");
    expect(naverFetch).toHaveBeenCalledOnce();
  });

  it("Kakao 401은 NAVER로 숨기지 않고 설정 오류로 처리한다", async () => {
    const naverFetch = vi.fn();
    const service = new PlaceLookupService({
      kakao: new KakaoLocalClient(
        new KakaoRestClient(
          "test-kakao-key",
          vi.fn(async () => new Response(null, { status: 401 })),
        ),
      ),
      naver: new NaverGeocodingClient(
        "test-naver-id",
        "test-naver-key",
        naverFetch,
      ),
    });

    await expect(
      service.search({
        query: "카이스트",
        scope: "resolve",
        limit: 8,
      }),
    ).rejects.toMatchObject({ kind: "CONFIGURATION" });
    expect(naverFetch).not.toHaveBeenCalled();
  });
});
