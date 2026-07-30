import { AsyncLocalStorage } from "node:async_hooks";

import type { RecommendationPhase } from "../services/recommendation-service.js";

type RequestObservabilityContext = {
  requestId: string;
  requestStartedAtMilliseconds: number;
  recommendationStartedAtMilliseconds: number | undefined;
  hardDeadlineAtMilliseconds: number | undefined;
  phase: RecommendationPhase | undefined;
};

export type RequestLogContext = {
  requestId: string;
  phase: RecommendationPhase | "HTTP_REQUEST";
  elapsedMilliseconds: number;
  remainingBudgetMilliseconds: number | null;
};

const requestContext = new AsyncLocalStorage<RequestObservabilityContext>();

export function runWithRequestContext<T>(
  input: {
    requestId: string;
    startedAtMilliseconds: number;
  },
  operation: () => T,
): T {
  return requestContext.run(
    {
      requestId: input.requestId,
      requestStartedAtMilliseconds: input.startedAtMilliseconds,
      recommendationStartedAtMilliseconds: undefined,
      hardDeadlineAtMilliseconds: undefined,
      phase: undefined,
    },
    operation,
  );
}

export function runWithRecommendationContext<T>(
  input: {
    requestId: string;
    startedAtMilliseconds: number;
    budgetMilliseconds: number;
  },
  operation: () => T,
): T {
  const current = requestContext.getStore();
  return requestContext.run(
    {
      requestId: input.requestId,
      requestStartedAtMilliseconds:
        current?.requestStartedAtMilliseconds ?? input.startedAtMilliseconds,
      recommendationStartedAtMilliseconds: input.startedAtMilliseconds,
      hardDeadlineAtMilliseconds:
        input.startedAtMilliseconds + input.budgetMilliseconds,
      phase: undefined,
    },
    operation,
  );
}

export function runWithRecommendationPhase<T>(
  phase: RecommendationPhase,
  operation: () => T,
): T {
  const current = requestContext.getStore();
  if (current === undefined) return operation();
  return requestContext.run({ ...current, phase }, operation);
}

export function currentRequestLogContext(): RequestLogContext | undefined {
  const current = requestContext.getStore();
  if (current === undefined) return undefined;
  const now = performance.now();
  const elapsedFrom =
    current.recommendationStartedAtMilliseconds ??
    current.requestStartedAtMilliseconds;
  return {
    requestId: current.requestId,
    phase: current.phase ?? "HTTP_REQUEST",
    elapsedMilliseconds: Math.max(0, Math.round(now - elapsedFrom)),
    remainingBudgetMilliseconds:
      current.hardDeadlineAtMilliseconds === undefined
        ? null
        : Math.max(
            0,
            Math.round(current.hardDeadlineAtMilliseconds - now),
          ),
  };
}
