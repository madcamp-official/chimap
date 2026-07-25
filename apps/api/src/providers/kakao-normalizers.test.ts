import { describe, expect, it } from "vitest";

import { ProviderError } from "../errors.js";
import {
  normalizeKakaoPlaceResponse,
  normalizeKakaoTransitResponse,
  normalizeKakaoWalkResponse,
} from "./kakao-normalizers.js";

const transitFixture = {
  status: "OK",
  properties: {
    total: 1,
    bus: 0,
    subway: 0,
    busAndSubway: 1,
  },
  routes: [
    {
      properties: {
        type: "BUS_AND_SUBWAY",
        totalDistance: 5013,
        totalTime: 2115,
        transfers: 1,
        fare: { value: 1550 },
      },
      steps: [
        {
          properties: {
            guidance: "정류장까지 걷기",
            type: "WALKING",
            distance: 300,
            time: 240,
          },
          path: {
            points: [
              [127.36, 36.37],
              [127.361, 36.369],
            ],
          },
        },
        {
          properties: {
            guidance: "104번 버스",
            type: "BUS",
            distance: 2500,
            time: 900,
            stops: [{ name: "충남대학교" }, { name: "정부청사역" }],
            vehicles: [{ name: "104", type: "간선" }],
          },
          path: {
            points: [
              [127.361, 36.369],
              [127.3848, 36.3576],
            ],
          },
        },
        {
          properties: {
            guidance: "1호선",
            type: "SUBWAY",
            distance: 2213,
            time: 975,
            stops: [{ name: "정부청사역" }, { name: "대전역" }],
            vehicles: [{ name: "대전 1호선", type: "일반" }],
          },
          path: { points: [] },
        },
      ],
    },
  ],
};

describe("Kakao 응답 정규화", () => {
  it("장소 응답을 공개 Place 모델로 변환하고 잘못된 좌표는 제외한다", () => {
    const places = normalizeKakaoPlaceResponse({
      documents: [
        {
          id: "1",
          place_name: "한국과학기술원",
          category_group_name: "학교",
          address_name: "대전 유성구 구성동",
          road_address_name: "대전 유성구 대학로 291",
          x: "127.3604",
          y: "36.3723",
        },
        {
          id: "2",
          place_name: "잘못된 장소",
          x: "not-a-number",
          y: "36.3",
        },
      ],
    });

    expect(places).toHaveLength(1);
    expect(places[0]?.location).toEqual({
      lng: 127.3604,
      lat: 36.3723,
    });
  });

  it("BUS, SUBWAY, WALKING과 요금, 정류장, 빈 path를 정규화한다", () => {
    const routes = normalizeKakaoTransitResponse(transitFixture);

    expect(routes).toHaveLength(1);
    expect(routes[0]?.legs.map((leg) => leg.mode)).toEqual([
      "WALK",
      "BUS",
      "SUBWAY",
    ]);
    expect(routes[0]?.walkDistanceMeters).toBe(300);
    expect(routes[0]?.fareWon).toBe(1550);
    expect(routes[0]?.legs[1]?.stops).toEqual([
      "충남대학교",
      "정부청사역",
    ]);
    expect(routes[0]?.legs[2]?.coordinates).toEqual([]);
  });

  it("요금이 없는 정상 대중교통 응답을 허용한다", () => {
    const withoutFare = structuredClone(transitFixture);
    delete (withoutFare.routes[0]!.properties as { fare?: unknown }).fare;
    const route = normalizeKakaoTransitResponse(withoutFare)[0];
    expect(route?.fareWon).toBeUndefined();
  });

  it("route가 비었거나 status가 정상이 아니면 명시적으로 실패한다", () => {
    expect(() =>
      normalizeKakaoTransitResponse({ status: "OK", routes: [] }),
    ).toThrow(ProviderError);
    expect(() =>
      normalizeKakaoTransitResponse({ status: "NO_RESULTS" }),
    ).toThrow(ProviderError);
  });

  it("도보 legs와 step 시작 좌표 폴백을 정규화한다", () => {
    const route = normalizeKakaoWalkResponse({
      status: "OK",
      route: {
        properties: {
          totalDistance: 900,
          totalTime: 720,
        },
        legs: [
          {
            properties: { distance: 900, time: 720 },
            steps: [
              {
                properties: {
                  distance: 900,
                  guidance: "목적지까지 직진",
                  time: 720,
                  x: 127.42,
                  y: 36.33,
                },
                path: { points: [] },
              },
            ],
          },
        ],
      },
    });

    expect(route.walkDistanceMeters).toBe(900);
    expect(route.legs[0]?.coordinates).toEqual([
      { lng: 127.42, lat: 36.33 },
    ]);
  });

  it.each(["TOO_FAR_AWAY", "START_LINK_NOT_FOUND"])(
    "도보 오류 상태 %s를 성공으로 처리하지 않는다",
    (status) => {
      expect(() => normalizeKakaoWalkResponse({ status })).toThrow(
        ProviderError,
      );
    },
  );
});
