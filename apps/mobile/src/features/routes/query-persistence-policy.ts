import {
  isSameKoreanCalendarDay,
  shouldRefreshRecommendation,
} from "@chimap/app-core";

export type RecommendationQuerySnapshot = {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  dataUpdatedAt: number;
  persistRecommendation: boolean;
  requestSavedAt: string | null | undefined;
};

export function shouldPersistRecommendation(
  query: Pick<RecommendationQuerySnapshot, "status" | "persistRecommendation">,
): boolean {
  return query.status === "success" && query.persistRecommendation;
}

export function shouldRefetchRecommendationOnForeground(input: {
  becameActive: boolean;
  online: boolean;
  now: number;
  query: RecommendationQuerySnapshot;
}): boolean {
  const { query } = input;
  return (
    input.becameActive &&
    input.online &&
    shouldPersistRecommendation(query) &&
    query.fetchStatus !== "fetching" &&
    (query.requestSavedAt === null ||
      query.requestSavedAt === undefined ||
      isSameKoreanCalendarDay(query.requestSavedAt, input.now)) &&
    shouldRefreshRecommendation(query.dataUpdatedAt, input.now)
  );
}
