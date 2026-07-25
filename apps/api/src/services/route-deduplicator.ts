import type { NormalizedRoute } from "@chimap/contracts";

import { areRouteShapesSimilar } from "./geometry.js";

function lineSignature(route: NormalizedRoute): string {
  return route.legs
    .filter((leg) => leg.mode === "BUS" || leg.mode === "SUBWAY")
    .map((leg) => `${leg.mode}:${leg.name ?? ""}`)
    .join(">");
}

export function areRoutesEquivalent(
  first: NormalizedRoute,
  second: NormalizedRoute,
): boolean {
  return (
    lineSignature(first) === lineSignature(second) &&
    first.transferCount === second.transferCount &&
    Math.abs(first.walkDistanceMeters - second.walkDistanceMeters) < 250 &&
    Math.abs(first.durationSeconds - second.durationSeconds) < 180 &&
    areRouteShapesSimilar(first, second)
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
