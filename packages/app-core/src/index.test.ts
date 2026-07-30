import { describe, expect, it } from "vitest";

import {
  isSameKoreanCalendarDay,
  recommendationQueryKey,
  RECOMMENDATION_CACHE_VERSION,
  reconcileRouteSelection,
  shouldRefreshRecommendation,
} from "./index.js";

describe("recommendation geometry cache namespace", () => {
  it("transit-v2 이전 persisted 추천을 재사용하지 않는다", () => {
    expect(RECOMMENDATION_CACHE_VERSION).toBe("v4-bus-geometry-v3");
    expect(recommendationQueryKey("request-hash")).toContain(
      "v4-bus-geometry-v3",
    );
  });
});

const response = {
  primaryRecommendationId: "new-fast",
  recommendations: [
    { id: "new-fast", type: "FAST" },
    { id: "new-goal", type: "GOAL" },
  ],
} as never;

describe("reconcileRouteSelection", () => {
  it("restores a changed route id using its stable recommendation type", () => {
    expect(
      reconcileRouteSelection(
        {
          selectedRouteId: "old-goal",
          selectedRouteType: "GOAL",
          detailSheetOpen: true,
        },
        response,
      ),
    ).toEqual({
      selectedRouteId: "new-goal",
      selectedRouteType: "GOAL",
      detailSheetOpen: true,
    });
  });
});

describe("isSameKoreanCalendarDay", () => {
  it("UTC 날짜가 달라도 KST 날짜가 같으면 같은 날로 처리한다", () => {
    expect(
      isSameKoreanCalendarDay(
        "2026-07-25T23:30:00.000Z",
        "2026-07-26T01:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      isSameKoreanCalendarDay(
        "2026-07-26T14:59:59.000Z",
        "2026-07-26T15:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("shouldRefreshRecommendation", () => {
  it("uses a strict five minute foreground stale threshold", () => {
    expect(shouldRefreshRecommendation(1_000, 301_001)).toBe(true);
    expect(shouldRefreshRecommendation(1_000, 301_000)).toBe(false);
  });
});
