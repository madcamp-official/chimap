import { describe, expect, it } from "vitest";

import {
  currentRequestLogContext,
  runWithRecommendationContext,
  runWithRecommendationPhase,
  runWithRequestContext,
} from "./request-context.js";

describe("request observability context", () => {
  it("request ID와 추천 budget을 비동기 phase scope에 보존한다", async () => {
    const startedAt = performance.now();

    const context = await runWithRequestContext(
      { requestId: "req-observability", startedAtMilliseconds: startedAt },
      () => runWithRecommendationContext(
        {
          requestId: "req-observability",
          startedAtMilliseconds: startedAt,
          budgetMilliseconds: 1_000,
        },
        () => runWithRecommendationPhase(
          "SELECTED_GEOMETRY",
          async () => {
            await Promise.resolve();
            return currentRequestLogContext();
          },
        ),
      ),
    );

    expect(context).toMatchObject({
      requestId: "req-observability",
      phase: "SELECTED_GEOMETRY",
    });
    expect(context?.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(context?.remainingBudgetMilliseconds).toBeGreaterThan(0);
    expect(context?.remainingBudgetMilliseconds).toBeLessThanOrEqual(1_000);
  });

  it("동시에 실행되는 phase를 서로 섞지 않는다", async () => {
    const run = (requestId: string, phase: "CANDIDATE_GENERATION" | "PARK_ROUTE") =>
      runWithRequestContext(
        { requestId, startedAtMilliseconds: performance.now() },
        () => runWithRecommendationPhase(phase, async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          return currentRequestLogContext();
        }),
      );

    const [candidate, park] = await Promise.all([
      run("req-candidate", "CANDIDATE_GENERATION"),
      run("req-park", "PARK_ROUTE"),
    ]);

    expect(candidate).toMatchObject({
      requestId: "req-candidate",
      phase: "CANDIDATE_GENERATION",
      remainingBudgetMilliseconds: null,
    });
    expect(park).toMatchObject({
      requestId: "req-park",
      phase: "PARK_ROUTE",
      remainingBudgetMilliseconds: null,
    });
  });
});
