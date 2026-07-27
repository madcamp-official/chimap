import { describe, expect, it } from "vitest";

import {
  shouldPersistRecommendation,
  shouldRefetchRecommendationOnForeground,
  type RecommendationQuerySnapshot,
} from "./query-persistence-policy";

const now = Date.parse("2026-07-26T03:10:00.001Z");
const staleSuccessfulQuery: RecommendationQuerySnapshot = {
  status: "success",
  fetchStatus: "idle",
  dataUpdatedAt: now - 5 * 60 * 1_000 - 1,
  persistRecommendation: true,
  requestSavedAt: "2026-07-26T03:00:00.000Z",
};

describe("recommendation query persistence policy", () => {
  it("성공한 추천 query만 로컬 persistence 대상으로 삼는다", () => {
    expect(shouldPersistRecommendation(staleSuccessfulQuery)).toBe(true);
    expect(
      shouldPersistRecommendation({
        status: "error",
        persistRecommendation: true,
      }),
    ).toBe(false);
    expect(
      shouldPersistRecommendation({
        status: "success",
        persistRecommendation: false,
      }),
    ).toBe(false);
  });

  it("foreground 전환·온라인·당일·5분 초과 조건이 모두 맞을 때만 갱신한다", () => {
    expect(
      shouldRefetchRecommendationOnForeground({
        becameActive: true,
        online: true,
        now,
        query: staleSuccessfulQuery,
      }),
    ).toBe(true);

    for (const override of [
      { becameActive: false },
      { online: false },
      { query: { ...staleSuccessfulQuery, fetchStatus: "fetching" as const } },
      {
        query: {
          ...staleSuccessfulQuery,
          dataUpdatedAt: now - 5 * 60 * 1_000,
        },
      },
      {
        query: {
          ...staleSuccessfulQuery,
          requestSavedAt: "2026-07-25T03:00:00.000Z",
        },
      },
    ]) {
      expect(
        shouldRefetchRecommendationOnForeground({
          becameActive: true,
          online: true,
          now,
          query: staleSuccessfulQuery,
          ...override,
        }),
      ).toBe(false);
    }
  });
});
