import type {
  Recommendation,
  RecommendationResponse,
  RecommendationType,
} from "@chimap/contracts";

export * from "./vehicle-positions.js";
export * from "./route-map-markers.js";
export * from "./vehicle-heading.js";

export const RECOMMENDATION_CACHE_VERSION = "v3-transit-v2";
export const RECOMMENDATION_STALE_TIME_MS = 5 * 60 * 1000;
export const RECOMMENDATION_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function recommendationQueryKey(requestHash: string) {
  return [
    "recommendations",
    RECOMMENDATION_CACHE_VERSION,
    "contracts-v1",
    requestHash,
  ] as const;
}

export type RouteSelection = {
  selectedRouteId: string | null;
  selectedRouteType: RecommendationType | null;
  detailSheetOpen: boolean;
};

export function reconcileRouteSelection(
  current: RouteSelection,
  response: RecommendationResponse,
): RouteSelection {
  const sameId = response.recommendations.find(
    (recommendation) => recommendation.id === current.selectedRouteId,
  );
  const sameType = response.recommendations.find(
    (recommendation) => recommendation.type === current.selectedRouteType,
  );
  const primary = response.recommendations.find(
    (recommendation) => recommendation.id === response.primaryRecommendationId,
  );
  const replacement: Recommendation | undefined = sameId ?? sameType ?? primary;
  return replacement === undefined
    ? {
        selectedRouteId: null,
        selectedRouteType: null,
        detailSheetOpen: false,
      }
    : {
        selectedRouteId: replacement.id,
        selectedRouteType: replacement.type,
        detailSheetOpen: current.detailSheetOpen,
      };
}

export function shouldRefreshRecommendation(
  dataUpdatedAt: number,
  now = Date.now(),
): boolean {
  return dataUpdatedAt <= 0 || now - dataUpdatedAt > RECOMMENDATION_STALE_TIME_MS;
}

export function isSameKoreanCalendarDay(
  left: Date | number | string,
  right: Date | number | string,
): boolean {
  const day = (value: Date | number | string) =>
    Math.floor((new Date(value).getTime() + 9 * 60 * 60 * 1_000) / 86_400_000);
  const leftDay = day(left);
  const rightDay = day(right);
  return Number.isFinite(leftDay) && leftDay === rightDay;
}
