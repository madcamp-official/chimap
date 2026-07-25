import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  normalizeNaverGeocodeResponse,
  normalizeNaverReverseGeocodeResponse,
} from "./naver-geocoding-client.js";

type Capture = {
  api: string;
  checksum: string;
  response: unknown;
};

const source = JSON.parse(
  readFileSync(
    new URL(
      "../../test-data/naver-responses-20260725.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  provider: string;
  capturedAt: string;
  documentationCheckedAt: string;
  captures: Capture[];
};

function capture(path: string): Capture {
  const value = source.captures.find((item) => item.api.includes(path));
  if (value === undefined) {
    throw new Error(`${path} 캡처를 찾을 수 없습니다.`);
  }
  return value;
}

describe("실제 NAVER 응답 정규화", () => {
  it("캡처 출처와 응답 checksum을 검증한다", () => {
    expect(source.provider).toBe("NAVER");
    expect(Date.parse(source.capturedAt)).not.toBeNaN();
    expect(source.documentationCheckedAt).toBe("2026-07-25");
    for (const item of source.captures) {
      expect(
        createHash("sha256")
          .update(JSON.stringify(item.response))
          .digest("hex"),
      ).toBe(item.checksum);
    }
  });

  it("Geocoding 주소를 NAVER 주소 Place로 변환한다", () => {
    const places = normalizeNaverGeocodeResponse(
      capture("map-geocode").response,
    );
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      name: "한국과학기술원",
      roadAddress: "대전광역시 유성구 대학로 291 한국과학기술원",
      category: "NAVER 주소",
      location: {
        lng: 127.3608437,
        lat: 36.3717787,
      },
    });
    expect(places[0]?.id.startsWith("naver:address:")).toBe(true);
  });

  it("Reverse Geocoding 주소를 입력 좌표의 Place로 변환한다", () => {
    const coordinate = { lng: 127.3604, lat: 36.3723 };
    const place = normalizeNaverReverseGeocodeResponse(
      capture("map-reversegeocode").response,
      coordinate,
    );
    expect(place).toMatchObject({
      name: "한국과학기술원",
      roadAddress: "대전광역시 유성구 구성동 대학로 291",
      category: "NAVER 주소",
      location: coordinate,
    });
  });
});
