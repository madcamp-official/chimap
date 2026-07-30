import { describe, expect, it } from "vitest";

import {
  decodePolyline6,
  joinCoordinateLegs,
  joinLegShapes,
} from "./valhalla-polyline.js";

function encode(points: Array<{ lat: number; lng: number }>): string {
  let latitude = 0;
  let longitude = 0;
  const output: string[] = [];
  const append = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      output.push(String.fromCharCode((0x20 | (value & 0x1f)) + 63));
      value >>= 5;
    }
    output.push(String.fromCharCode(value + 63));
  };
  for (const point of points) {
    const nextLatitude = Math.round(point.lat * 1e6);
    const nextLongitude = Math.round(point.lng * 1e6);
    append(nextLatitude - latitude);
    append(nextLongitude - longitude);
    latitude = nextLatitude;
    longitude = nextLongitude;
  }
  return output.join("");
}

describe("Valhalla polyline6", () => {
  it("음수 delta와 6자리 정밀도를 보존한다", () => {
    const points = [
      { lat: 36.350123, lng: 127.380456 },
      { lat: 36.349999, lng: 127.381001 },
    ];
    expect(decodePolyline6(encode(points))).toEqual(points);
  });

  it("leg 경계의 동일 좌표만 제거한다", () => {
    const a = { lat: 36.35, lng: 127.38 };
    const b = { lat: 36.351, lng: 127.381 };
    const c = { lat: 36.352, lng: 127.382 };
    expect(joinLegShapes([encode([a, b]), encode([b, c])])).toEqual([a, b, c]);
    expect(joinCoordinateLegs([[a, b], [b, c]])).toEqual([a, b, c]);
  });

  it("빈 shape, 한 점뿐인 shape, malformed shape를 거절한다", () => {
    expect(() => decodePolyline6("")).toThrow(/비어/u);
    expect(() => decodePolyline6(encode([{ lat: 36.35, lng: 127.38 }]))).toThrow(
      /부족/u,
    );
    expect(() => decodePolyline6("~")).toThrow(/polyline6/u);
    expect(() => joinLegShapes([])).toThrow(/비어/u);
  });
});
