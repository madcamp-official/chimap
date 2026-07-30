import type { NormalizedRoute } from "@chimap/contracts";

function coordinateKey(
  coordinate: { lat: number; lng: number } | undefined,
): string {
  return coordinate === undefined
    ? "missing"
    : `${coordinate.lng.toFixed(5)},${coordinate.lat.toFixed(5)}`;
}

function topologySignature(route: NormalizedRoute): string {
  return route.legs
    .map((leg) => {
      if (leg.bus !== undefined) {
        return [
          "BUS",
          leg.bus.cityCode,
          leg.bus.routeId,
          leg.bus.boardingNodeOrder,
          leg.bus.alightingNodeOrder,
        ].join(":");
      }
      if (leg.subway !== undefined) {
        return [
          "SUBWAY",
          leg.subway.serviceLineId,
          leg.subway.boardingStation.sourceStationKey,
          leg.subway.alightingStation.sourceStationKey,
        ].join(":");
      }
      if (leg.mode === "WALK") {
        return [
          "WALK",
          leg.walkingRole ?? "UNSPECIFIED",
          coordinateKey(leg.coordinates[0]),
          coordinateKey(leg.coordinates.at(-1)),
        ].join(":");
      }
      return `${leg.mode}:${leg.name ?? ""}`;
    })
    .join(">");
}

export function areRoutesEquivalent(
  first: NormalizedRoute,
  second: NormalizedRoute,
): boolean {
  return (
    topologySignature(first) === topologySignature(second) &&
    first.transferCount === second.transferCount &&
    Math.abs(first.walkDistanceMeters - second.walkDistanceMeters) < 250 &&
    Math.abs(first.durationSeconds - second.durationSeconds) < 180
  );
}

export function deduplicateRoutes<T extends { route: NormalizedRoute }>(
  candidates: readonly T[],
): T[] {
  const unique: T[] = [];
  for (const candidate of candidates) {
    if (
      !unique.some((existing) =>
        areRoutesEquivalent(existing.route, candidate.route),
      )
    ) {
      unique.push(candidate);
    }
  }
  return unique;
}
