import {
  haversineDistanceMeters,
  type Coordinate,
} from "@chimap/contracts";

const MINIMUM_MOVEMENT_METERS = 5;
const MAXIMUM_ROUTE_DEVIATION_DEGREES = 110;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function degrees(radiansValue: number): number {
  return (radiansValue * 180) / Math.PI;
}

export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

/** 북쪽 0°, 동쪽 90°인 지도 마커용 초기 방위각을 반환한다. */
export function bearingDegrees(from: Coordinate, to: Coordinate): number {
  const fromLatitude = radians(from.lat);
  const toLatitude = radians(to.lat);
  const longitudeDelta = radians(to.lng - from.lng);
  const y = Math.sin(longitudeDelta) * Math.cos(toLatitude);
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(longitudeDelta);
  return normalizeHeading(degrees(Math.atan2(y, x)));
}

function angularDifference(left: number, right: number): number {
  const difference = Math.abs(normalizeHeading(left) - normalizeHeading(right));
  return Math.min(difference, 360 - difference);
}

function pointToSegmentDistanceSquared(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate,
): number {
  const latitudeScale = Math.cos(radians(point.lat));
  const startX = (start.lng - point.lng) * latitudeScale;
  const startY = start.lat - point.lat;
  const endX = (end.lng - point.lng) * latitudeScale;
  const endY = end.lat - point.lat;
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return startX * startX + startY * startY;
  const progress = Math.max(
    0,
    Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared),
  );
  const closestX = startX + progress * deltaX;
  const closestY = startY + progress * deltaY;
  return closestX * closestX + closestY * closestY;
}

export function routeHeadingAtCoordinate(
  position: Coordinate,
  routeSegments: readonly (readonly Coordinate[])[],
): number | undefined {
  let closest:
    | { distanceSquared: number; heading: number }
    | undefined;
  for (const coordinates of routeSegments) {
    for (let index = 1; index < coordinates.length; index += 1) {
      const start = coordinates[index - 1]!;
      const end = coordinates[index]!;
      if (haversineDistanceMeters(start, end) < 2) continue;
      const candidate = {
        distanceSquared: pointToSegmentDistanceSquared(position, start, end),
        heading: bearingDegrees(start, end),
      };
      if (
        closest === undefined ||
        candidate.distanceSquared < closest.distanceSquared
      ) {
        closest = candidate;
      }
    }
  }
  return closest?.heading;
}

export function resolveVehicleHeading(input: {
  current: Coordinate;
  previous?: Coordinate | undefined;
  previousHeading?: number | undefined;
  routeSegments?: readonly (readonly Coordinate[])[] | undefined;
}): number {
  const routeHeading = routeHeadingAtCoordinate(
    input.current,
    input.routeSegments ?? [],
  );
  if (
    input.previous !== undefined &&
    haversineDistanceMeters(input.previous, input.current) >=
      MINIMUM_MOVEMENT_METERS
  ) {
    const movementHeading = bearingDegrees(input.previous, input.current);
    if (
      routeHeading !== undefined &&
      angularDifference(movementHeading, routeHeading) >
        MAXIMUM_ROUTE_DEVIATION_DEGREES
    ) {
      return routeHeading;
    }
    return movementHeading;
  }
  return normalizeHeading(input.previousHeading ?? routeHeading ?? 0);
}
