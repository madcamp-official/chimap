import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  normalizeKakaoAddressResponse,
  normalizeKakaoDrivingGeometry,
  normalizeKakaoDrivingSections,
  normalizeKakaoPlaceResponse,
  normalizeKakaoReverseGeocodeResponse,
  normalizeKakaoWalkResponse,
} from "./kakao-normalizers.js";

type Capture = {
  api: string;
  checksum: string;
  response: unknown;
};

const source = JSON.parse(
  readFileSync(
    new URL(
      "../../test-data/kakao-responses-20260725.json",
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

const drivingSource = JSON.parse(
  readFileSync(
    new URL(
      "../../test-data/kakao-driving-response-20260725.json",
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

describe("실제 Kakao 응답 정규화", () => {
  it("캡처 출처와 checksum을 검증한다", () => {
    expect(source.provider).toBe("KAKAO");
    expect(Date.parse(source.capturedAt)).not.toBeNaN();
    expect(source.documentationCheckedAt).toBe("2026-07-25");
    for (const item of source.captures) {
      expect(item.checksum).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it("키워드 검색을 Place로 변환한다", () => {
    const places = normalizeKakaoPlaceResponse(
      capture("search/keyword").response,
    );
    expect(places[0]).toMatchObject({
      id: "kakao:place:26964230",
      name: "KAIST 본원",
      roadAddress: "대전 유성구 대학로 291",
      location: {
        lng: 127.36129293525407,
        lat: 36.37053284796117,
      },
    });
  });

  it("주소 검색과 역지오코딩을 Place로 변환한다", () => {
    const addresses = normalizeKakaoAddressResponse(
      capture("search/address").response,
    );
    expect(addresses[0]?.name).toBe("한국과학기술원");
    expect(addresses[0]?.id.startsWith("kakao:address:")).toBe(true);

    const reverse = normalizeKakaoReverseGeocodeResponse(
      capture("coord2address").response,
      { lng: 127.3604, lat: 36.3723 },
    );
    expect(reverse?.name).toBe("한국과학기술원");
    expect(reverse?.roadAddress).toBe("대전광역시 유성구 대학로 291");
  });

  it("도보 경로의 거리·시간·좌표를 정규화한다", () => {
    const route = normalizeKakaoWalkResponse(capture("routing/walk").response);
    expect(route.walkDistanceMeters).toBe(410);
    expect(route.durationSeconds).toBe(350);
    expect(
      route.legs.reduce(
        (total, leg) => total + leg.coordinates.length,
        0,
      ),
    ).toBeGreaterThan(10);
  });

  it("실제 다중 경유지 응답을 도로 vertex 경로로 변환한다", () => {
    const recorded = drivingSource.captures[0]!;
    expect(drivingSource.provider).toBe("KAKAO_MOBILITY_DIRECTIONS");
    expect(
      createHash("sha256")
        .update(JSON.stringify(recorded.response))
        .digest("hex"),
    ).toBe(recorded.checksum);

    const coordinates = normalizeKakaoDrivingGeometry(
      recorded.response,
    );
    const sections = normalizeKakaoDrivingSections(recorded.response);
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((section) => section.length >= 2)).toBe(true);
    expect(coordinates.length).toBeGreaterThan(40);
    expect(
      coordinates.some(
        (coordinate, index) =>
          index > 0 &&
          coordinate.lng === coordinates[index - 1]?.lng &&
          coordinate.lat === coordinates[index - 1]?.lat,
      ),
    ).toBe(false);
  });
});

describe("Kakao 도보 형상 무결성", () => {
  const response = (steps: unknown[]) => ({
    status: "OK",
    route: {
      properties: { totalDistance: 100, totalTime: 90 },
      legs: [{ properties: { distance: 100, time: 90 }, steps }],
    },
  });

  it("빈 steps를 유효한 도보 경로로 반환하지 않는다", () => {
    expect(() => normalizeKakaoWalkResponse(response([]))).toThrow(/steps/u);
  });

  it("path.points가 없는 step을 유효한 도보 경로로 반환하지 않는다", () => {
    expect(() => normalizeKakaoWalkResponse(response([
      { properties: { distance: 100, time: 90, x: 127.37, y: 36.35 } },
    ]))).toThrow(/path\.points/u);
  });

  it("연속된 여러 step을 하나의 leg로 결합하고 중복 접합점을 제거한다", () => {
    const a = [127.37, 36.35];
    const b = [127.3702, 36.3502];
    const c = [127.3704, 36.3504];
    const route = normalizeKakaoWalkResponse(response([
      { properties: { distance: 50, time: 45 }, path: { points: [a, b] } },
      { properties: { distance: 50, time: 45 }, path: { points: [b, c] } },
    ]));

    expect(route.legs).toHaveLength(1);
    expect(route.legs[0]?.coordinates).toHaveLength(3);
  });

  it("첫 step이 역방향이어도 요청 출발점 기준으로 바로잡는다", () => {
    const origin = { lng: 127.37, lat: 36.35 };
    const middle = { lng: 127.3702, lat: 36.3502 };
    const destination = { lng: 127.3704, lat: 36.3504 };
    const route = normalizeKakaoWalkResponse(
      response([
        {
          properties: { distance: 100, time: 90 },
          path: {
            points: [
              [destination.lng, destination.lat],
              [middle.lng, middle.lat],
              [origin.lng, origin.lat],
            ],
          },
        },
      ]),
      { origin, destination },
    );

    expect(route.legs[0]?.coordinates).toEqual([
      { lat: origin.lat, lng: origin.lng },
      { lat: middle.lat, lng: middle.lng },
      { lat: destination.lat, lng: destination.lng },
    ]);
  });
});
