import type { Recommendation, RouteLeg, RouteMode } from "@chimap/contracts";

export function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))}분`;
}

export function formatMeters(value: number): string {
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)}km` : `${value}m`;
}

export function formatClockTime(value: string): string {
  return new Date(value).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function routeLegLabel(leg: RouteLeg): string {
  if (leg.mode === "WALK") return "도보";
  if (leg.mode === "BUS") {
    return leg.bus?.routeNo === undefined ? "버스" : `${leg.bus.routeNo}번 버스`;
  }
  return leg.subway?.lineName ?? leg.name ?? "지하철";
}

export function formatRouteSequence(route: Recommendation): string {
  return route.legs
    .map(routeLegLabel)
    .filter((label, index, labels) => label !== "도보" || labels[index - 1] !== "도보")
    .join(" → ");
}

export function summarizeModeDistances(
  route: Recommendation,
): Array<{ mode: RouteMode; meters: number }> {
  return (["WALK", "BUS", "SUBWAY"] as const)
    .map((mode) => ({
      mode,
      meters: route.legs
        .filter((leg) => leg.mode === mode)
        .reduce((total, leg) => total + leg.distanceMeters, 0),
    }))
    .filter((item) => item.meters > 0);
}

export function summarizeOrderedModeDistances(
  route: Recommendation,
): Array<{ mode: RouteMode; meters: number }> {
  return route.legs.reduce<Array<{ mode: RouteMode; meters: number }>>(
    (segments, leg) => {
      if (leg.distanceMeters <= 0) {
        return segments;
      }
      const previous = segments[segments.length - 1];
      if (previous?.mode === leg.mode) {
        previous.meters += leg.distanceMeters;
      } else {
        segments.push({ mode: leg.mode, meters: leg.distanceMeters });
      }
      return segments;
    },
    [],
  );
}

export function formatStepDifference(route: Recommendation): string {
  const count = Math.abs(route.stepDifference).toLocaleString();
  if (route.goalFit === "UNDER") return `목표보다 ${count}걸음 부족`;
  if (route.goalFit === "OVER") return `목표보다 ${count}걸음 초과`;
  return "목표에 가까운 걸음";
}
