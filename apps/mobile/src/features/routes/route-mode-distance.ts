import type { RouteLeg, RouteMode } from "@chimap/contracts";

export type RouteModeDistance = {
  mode: RouteMode;
  distanceMeters: number;
  percent: number;
};

const modeOrder: RouteMode[] = ["WALK", "BUS", "SUBWAY"];

export function routeModeDistances(
  legs: ReadonlyArray<Pick<RouteLeg, "mode" | "distanceMeters">>,
): RouteModeDistance[] {
  const totals = new Map<RouteMode, number>(
    modeOrder.map((mode) => [mode, 0]),
  );
  for (const leg of legs) {
    totals.set(leg.mode, (totals.get(leg.mode) ?? 0) + leg.distanceMeters);
  }
  const distances = modeOrder
    .map((mode) => ({ mode, distanceMeters: totals.get(mode) ?? 0 }))
    .filter((item) => item.distanceMeters > 0);
  const totalDistance = distances.reduce(
    (total, item) => total + item.distanceMeters,
    0,
  );
  if (totalDistance === 0) {
    return [];
  }

  const percentages = distances.map((item, index) => {
    const exact = (item.distanceMeters / totalDistance) * 100;
    return { index, floor: Math.floor(exact), remainder: exact % 1 };
  });
  let remaining =
    100 - percentages.reduce((total, item) => total + item.floor, 0);
  const remainderOrder = [...percentages].sort(
    (first, second) =>
      second.remainder - first.remainder || first.index - second.index,
  );
  const percentByIndex = percentages.map((item) => item.floor);
  for (const item of remainderOrder) {
    if (remaining === 0) {
      break;
    }
    percentByIndex[item.index] = (percentByIndex[item.index] ?? 0) + 1;
    remaining -= 1;
  }

  return distances.map((item, index) => ({
    ...item,
    percent: percentByIndex[index] ?? 0,
  }));
}
