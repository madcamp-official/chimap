import {
  haversineDistanceMeters,
  type Coordinate,
  type NormalizedRoute,
} from "@chimap/contracts";

export function routeCoordinates(route: NormalizedRoute): Coordinate[] {
  return route.legs.flatMap((leg) => leg.coordinates);
}

export function firstRouteCoordinate(
  route: NormalizedRoute,
): Coordinate | undefined {
  return route.legs.find((leg) => leg.coordinates.length > 0)?.coordinates[0];
}

export function lastRouteCoordinate(
  route: NormalizedRoute,
): Coordinate | undefined {
  for (let index = route.legs.length - 1; index >= 0; index -= 1) {
    const coordinates = route.legs[index]?.coordinates;
    const last = coordinates?.[coordinates.length - 1];
    if (last !== undefined) {
      return last;
    }
  }
  return undefined;
}

function projectedPoint(
  coordinate: Coordinate,
  origin: Coordinate,
): { x: number; y: number } {
  const latitudeRadians = (origin.lat * Math.PI) / 180;
  return {
    x:
      (coordinate.lng - origin.lng) *
      111_320 *
      Math.cos(latitudeRadians),
    y: (coordinate.lat - origin.lat) * 110_540,
  };
}

function pointToSegmentDistanceMeters(
  point: Coordinate,
  segmentStart: Coordinate,
  segmentEnd: Coordinate,
): number {
  const origin = point;
  const projectedStart = projectedPoint(segmentStart, origin);
  const projectedEnd = projectedPoint(segmentEnd, origin);
  const deltaX = projectedEnd.x - projectedStart.x;
  const deltaY = projectedEnd.y - projectedStart.y;
  const squaredLength = deltaX * deltaX + deltaY * deltaY;
  if (squaredLength === 0) {
    return Math.hypot(projectedStart.x, projectedStart.y);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      (-(projectedStart.x * deltaX + projectedStart.y * deltaY)) /
        squaredLength,
    ),
  );
  return Math.hypot(
    projectedStart.x + projection * deltaX,
    projectedStart.y + projection * deltaY,
  );
}

export function distanceToPolylineMeters(
  point: Coordinate,
  polyline: readonly Coordinate[],
): number {
  if (polyline.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  if (polyline.length === 1) {
    return haversineDistanceMeters(point, polyline[0]!);
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    minimum = Math.min(
      minimum,
      pointToSegmentDistanceMeters(
        point,
        polyline[index]!,
        polyline[index + 1]!,
      ),
    );
  }
  return minimum;
}

function sampleCoordinates(
  coordinates: readonly Coordinate[],
  maximum = 20,
): Coordinate[] {
  if (coordinates.length <= maximum) {
    return [...coordinates];
  }
  const step = (coordinates.length - 1) / (maximum - 1);
  return Array.from(
    { length: maximum },
    (_, index) => coordinates[Math.round(index * step)]!,
  );
}

function directedShapeDistance(
  first: readonly Coordinate[],
  second: readonly Coordinate[],
): number {
  const samples = sampleCoordinates(first);
  return (
    samples.reduce(
      (total, coordinate) =>
        total + distanceToPolylineMeters(coordinate, second),
      0,
    ) / samples.length
  );
}

export function areRouteShapesSimilar(
  first: NormalizedRoute,
  second: NormalizedRoute,
  thresholdMeters = 250,
): boolean {
  const firstCoordinates = routeCoordinates(first);
  const secondCoordinates = routeCoordinates(second);
  if (firstCoordinates.length < 2 || secondCoordinates.length < 2) {
    return false;
  }

  const firstStart = firstCoordinates[0]!;
  const secondStart = secondCoordinates[0]!;
  const firstEnd = firstCoordinates[firstCoordinates.length - 1]!;
  const secondEnd = secondCoordinates[secondCoordinates.length - 1]!;
  if (
    haversineDistanceMeters(firstStart, secondStart) > thresholdMeters * 2 ||
    haversineDistanceMeters(firstEnd, secondEnd) > thresholdMeters * 2
  ) {
    return false;
  }

  return (
    directedShapeDistance(firstCoordinates, secondCoordinates) <
      thresholdMeters &&
    directedShapeDistance(secondCoordinates, firstCoordinates) <
      thresholdMeters
  );
}
