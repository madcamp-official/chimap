import type { Coordinate } from "@chimap/contracts";

const POLYLINE_PRECISION = 1_000_000;
const MAX_SHIFT = 30;

export function decodePolyline6(shape: string): Coordinate[] {
  if (shape.length === 0) {
    throw new Error("Valhalla shape가 비어 있습니다.");
  }

  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const decodeValue = (): number => {
    let result = 0;
    let shift = 0;
    while (true) {
      if (index >= shape.length || shift > MAX_SHIFT) {
        throw new Error("유효하지 않은 polyline6입니다.");
      }
      const value = shape.charCodeAt(index) - 63;
      index += 1;
      if (value < 0 || value > 63) {
        throw new Error("유효하지 않은 polyline6입니다.");
      }
      result |= (value & 0x1f) << shift;
      if (value < 0x20) break;
      shift += 5;
    }
    return (result & 1) === 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < shape.length) {
    latitude += decodeValue();
    longitude += decodeValue();
    const point = {
      lat: latitude / POLYLINE_PRECISION,
      lng: longitude / POLYLINE_PRECISION,
    };
    if (
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 ||
      Math.abs(point.lng) > 180
    ) {
      throw new Error("polyline6 좌표가 WGS84 범위를 벗어났습니다.");
    }
    coordinates.push(point);
  }

  if (coordinates.length < 2) {
    throw new Error("Valhalla geometry 좌표가 부족합니다.");
  }
  return coordinates;
}

export function joinCoordinateLegs(
  legs: readonly (readonly Coordinate[])[],
): Coordinate[] {
  const result: Coordinate[] = [];
  for (const leg of legs) {
    if (leg.length < 2) {
      throw new Error("Valhalla leg geometry 좌표가 부족합니다.");
    }
    for (const point of leg) {
      const previous = result.at(-1);
      if (previous?.lat !== point.lat || previous.lng !== point.lng) {
        result.push(point);
      }
    }
  }
  if (result.length < 2) {
    throw new Error("Valhalla geometry 좌표가 부족합니다.");
  }
  return result;
}

export function joinLegShapes(shapes: readonly string[]): Coordinate[] {
  if (shapes.length === 0) {
    throw new Error("Valhalla leg shape가 비어 있습니다.");
  }
  return joinCoordinateLegs(shapes.map(decodePolyline6));
}
