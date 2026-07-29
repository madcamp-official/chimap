import type { Coordinate } from "@chimap/contracts";

export function decodePolyline6(shape: string): Coordinate[] {
  if (shape.length === 0) throw new Error("Valhalla shape가 비어 있습니다.");
  const coordinates: Coordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const decode = (): number => {
    let result = 0;
    let shift = 0;
    while (true) {
      if (index >= shape.length || shift > 30) {
        throw new Error("유효하지 않은 polyline6입니다.");
      }
      const value = shape.charCodeAt(index++) - 63;
      if (value < 0 || value > 63) throw new Error("유효하지 않은 polyline6입니다.");
      result |= (value & 0x1f) << shift;
      shift += 5;
      if (value < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < shape.length) {
    latitude += decode();
    longitude += decode();
    const point = { lat: latitude / 1e6, lng: longitude / 1e6 };
    if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw new Error("polyline6 좌표가 WGS84 범위를 벗어났습니다.");
    }
    coordinates.push(point);
  }
  return coordinates;
}

export function joinLegShapes(shapes: readonly string[]): Coordinate[] {
  const result: Coordinate[] = [];
  for (const shape of shapes) {
    for (const point of decodePolyline6(shape)) {
      const previous = result.at(-1);
      if (previous?.lat !== point.lat || previous.lng !== point.lng) result.push(point);
    }
  }
  if (result.length < 2) throw new Error("Valhalla geometry 좌표가 부족합니다.");
  return result;
}
