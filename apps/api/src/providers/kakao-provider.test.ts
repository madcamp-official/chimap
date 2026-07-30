import { describe, expect, it } from "vitest";

import {
  KakaoMobilityProvider,
  isPlausibleRoadSection,
  roadGeometryForWaypoints,
} from "./kakao-provider.js";
import type { KakaoRouteProviderObservation } from "./kakao-rest-client.js";

const emart = { lat: 36.355156, lng: 127.37922 };
const galleria = { lat: 36.35272, lng: 127.37907 };

describe("Kakao 버스 도로 구간 검증", () => {
  it("2-point 요청은 자동차 경유지 없이 독립 인접쌍 body로 전송한다", async () => {
    let body: Record<string, unknown> | undefined;
    const observations: KakaoRouteProviderObservation[] = [];
    const provider = new KakaoMobilityProvider(
      "server-key",
      async (_url, options) => {
        body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          routes: [{
            result_code: 0,
            result_msg: "길찾기 성공",
            sections: [{
              roads: [{
                vertexes: [emart.lng, emart.lat, galleria.lng, galleria.lat],
              }],
            }],
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    provider.setRouteProviderObserver((observation) =>
      observations.push(observation),
    );

    const result = await provider.getRoadRouteSections({
      points: [emart, galleria],
    });

    expect(result.sections).toHaveLength(1);
    expect(body).toMatchObject({
      origin: { x: emart.lng, y: emart.lat },
      destination: { x: galleria.lng, y: galleria.lat },
      waypoints: [],
      priority: "RECOMMEND",
    });
    expect(observations).toEqual([
      expect.objectContaining({
        provider: "KAKAO",
        operation: "ROAD_GEOMETRY",
        outcome: "SUCCESS",
        timeoutOrigin: "NONE",
      }),
    ]);
    expect(JSON.stringify(observations)).not.toContain("server-key");
    expect(JSON.stringify(observations)).not.toContain(String(emart.lng));
    expect(JSON.stringify(observations)).not.toContain(String(emart.lat));
  });

  it("가까운 정류장 사이의 과도한 블록 우회를 거부한다", () => {
    const detour = [
      emart,
      { lat: 36.3551, lng: 127.375 },
      { lat: 36.3527, lng: 127.375 },
      galleria,
    ];

    expect(isPlausibleRoadSection(detour, emart, galleria)).toBe(false);
    expect(roadGeometryForWaypoints([detour], [emart, galleria])).toEqual([
      emart,
      galleria,
    ]);
  });

  it("정류장 사이의 정상적인 도로 곡선은 유지한다", () => {
    const road = [
      { lat: 36.35514, lng: 127.37921 },
      { lat: 36.3539, lng: 127.37913 },
      { lat: 36.35274, lng: 127.37908 },
    ];

    expect(isPlausibleRoadSection(road, emart, galleria)).toBe(true);
    expect(roadGeometryForWaypoints([road], [emart, galleria])).toEqual([
      emart,
      ...road,
      galleria,
    ]);
  });

  it("응답 구간 수와 경유지 수가 다르면 정류장 순서로 안전하게 대체한다", () => {
    expect(
      roadGeometryForWaypoints([], [
        emart,
        galleria,
        { lat: 36.3509, lng: 127.37786 },
      ]),
    ).toEqual([
      emart,
      galleria,
      { lat: 36.3509, lng: 127.37786 },
    ]);
  });
});
