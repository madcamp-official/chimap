import type { RouteLeg } from "@chimap/contracts";

function walkingDistanceMeters(legs: readonly RouteLeg[]): number {
  return legs
    .filter((leg) => leg.mode === "WALK")
    .reduce((total, leg) => total + leg.distanceMeters, 0);
}

export function hasExactInsertedWalkingAttribution(input: {
  parentLegs: readonly RouteLeg[];
  childLegs: readonly RouteLeg[];
  insertedLegs: readonly RouteLeg[];
}): boolean {
  return (
    walkingDistanceMeters(input.childLegs) -
      walkingDistanceMeters(input.parentLegs) ===
    walkingDistanceMeters(input.insertedLegs)
  );
}
