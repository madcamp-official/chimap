import {
  haversineDistanceMeters,
  type Coordinate,
} from "@chimap/contracts";

function interpolate(from: Coordinate, to: Coordinate, ratio: number): Coordinate {
  return {
    lat: from.lat + (to.lat - from.lat) * ratio,
    lng: from.lng + (to.lng - from.lng) * ratio,
  };
}

export function dashedPolylineSegments(
  coordinates: readonly Coordinate[],
  dashMeters = 12,
  gapMeters = 8,
): Coordinate[][] {
  if (coordinates.length < 2 || dashMeters <= 0 || gapMeters < 0) {
    return [];
  }
  const cycle = dashMeters + gapMeters;
  let phase = 0;
  let visible: Coordinate[] = [];
  const result: Coordinate[][] = [];
  const finishVisible = () => {
    if (visible.length >= 2) result.push(visible);
    visible = [];
  };

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const from = coordinates[index]!;
    const to = coordinates[index + 1]!;
    const segmentDistance = haversineDistanceMeters(from, to);
    if (segmentDistance <= 0) continue;
    let consumed = 0;
    while (consumed < segmentDistance) {
      const drawing = phase < dashMeters;
      const phaseBoundary = drawing ? dashMeters : cycle;
      const length = Math.min(
        segmentDistance - consumed,
        phaseBoundary - phase,
      );
      const start = interpolate(from, to, consumed / segmentDistance);
      const end = interpolate(from, to, (consumed + length) / segmentDistance);
      if (drawing) {
        if (visible.length === 0) visible.push(start);
        visible.push(end);
      }
      consumed += length;
      phase += length;
      if (phase >= dashMeters && drawing) finishVisible();
      if (phase >= cycle - 0.001) phase = 0;
    }
  }
  finishVisible();
  return result;
}
