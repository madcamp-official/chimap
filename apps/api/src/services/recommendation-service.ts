import {
  haversineDistanceMeters,
  recommendationResponseSchema,
  type ApiWarning,
  type RecommendationRequest,
  type RecommendationResponse,
} from "@chimap/contracts";
import type { Logger } from "pino";

import { AppError, mapProviderError, ProviderError } from "../errors.js";
import {
  calculateStepMetrics,
  isLegacyRecommendationRequest,
  resolveRecommendationPolicy,
} from "./calculations.js";
import { CandidateGenerator } from "./candidate-generator.js";
import { selectRecommendations } from "./recommendation-engine.js";

export type Clock = () => Date;

export class RecommendationService {
  readonly #candidateGenerator: CandidateGenerator;
  readonly #clock: Clock;
  readonly #logger: Logger;

  public constructor(options: {
    candidateGenerator: CandidateGenerator;
    clock?: Clock;
    logger: Logger;
  }) {
    this.#candidateGenerator = options.candidateGenerator;
    this.#clock = options.clock ?? (() => new Date());
    this.#logger = options.logger;
  }

  public async createRecommendations(input: {
    request: RecommendationRequest;
    requestId: string;
    signal?: AbortSignal;
  }): Promise<RecommendationResponse> {
    const departureAt = this.#clock();
    this.#validateRequest(input.request, departureAt, input.requestId);
    const timeoutSignal = AbortSignal.timeout(20_000);
    const signal =
      input.signal === undefined
        ? timeoutSignal
        : AbortSignal.any([input.signal, timeoutSignal]);

    try {
      const generated = await this.#candidateGenerator.generate(
        input.request,
        signal,
      );
      if (generated.routeApiCallCount > 9) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "경로 조회 호출 한도를 초과했어요.",
          status: 500,
        });
      }

      const policy = resolveRecommendationPolicy(
        input.request,
        generated.baseline,
      );

      const selection = selectRecommendations({
        candidates: generated.candidates,
        baseline: generated.baseline,
        request: input.request,
        departureAt,
        policy,
      });
      if (selection.recommendations.length === 0) {
        throw new AppError({
          code: "NO_ROUTE_WITHIN_DEADLINE",
          message:
            policy.mode === "LEGACY"
              ? "설정한 시간 안에 도착할 수 있는 운동 경로를 찾지 못했어요."
              : "현재 조건에서 추천할 수 있는 건강 경로를 찾지 못했어요.",
          status: 404,
        });
      }
      const primaryRecommendationId = selection.primaryRecommendationId;
      if (primaryRecommendationId === undefined) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "기본 추천 경로를 결정하지 못했어요.",
          status: 500,
        });
      }

      const baselineMetrics = calculateStepMetrics(
        input.request,
        generated.baseline,
        generated.baseline,
      );
      const warnings: ApiWarning[] = [
        {
          code: "ESTIMATED_STEPS",
          message: "걸음 수와 도착시간은 예상값입니다.",
        },
        {
          code: "CURRENT_TIME_ESTIMATE",
          message:
            "TAGO 버스 도착정보와 지하철 시간표는 미래 예약이 아닌 지금 출발 기준입니다.",
        },
      ];
      if (
        selection.recommendations.some(
          (recommendation) => recommendation.isRealtime === false,
        )
      ) {
        warnings.push({
          code: "REALTIME_UNAVAILABLE",
          message:
            "일부 대중교통은 실시간 위치가 없어 TAGO 시간표·배차간격 기반 예상값을 사용했습니다.",
        });
      }
      if (
        selection.recommendations.some(
          (recommendation) => recommendation.isPartial === true,
        )
      ) {
        warnings.push({
          code: "PARTIAL_TRANSIT_DATA",
          message:
            "TAGO 갱신이 일부 실패해 import된 실제 정류장 데이터로 확인 가능한 범위만 표시합니다.",
        });
      }
      if (generated.candidateFailureCount > 0) {
        warnings.push({
          code: "PARTIAL_CANDIDATE_FAILURE",
          message:
            "일부 운동 경로는 확인하지 못했지만 검증된 결과를 보여드려요.",
        });
      }
      if (!selection.goalReachable) {
        warnings.push({
          code:
            policy.mode === "AUTO"
              ? "GOAL_UNREACHABLE_WITHIN_AUTO_BUDGET"
              : "GOAL_UNREACHABLE_WITHIN_CONSTRAINTS",
          message:
            policy.mode === "AUTO"
              ? "자동 추천 범위 안에서는 목표 걸음의 ±5%에 맞추기 어려워 가장 가까운 경로를 보여드려요."
              : "설정한 마감시간과 추가시간 안에서는 목표 걸음의 ±5% 범위에 맞추기 어려워 가장 가까운 경로를 보여드려요.",
        });
      }
      if (selection.recommendations.length < 3) {
        warnings.push({
          code: "LIMITED_ROUTE_VARIETY",
          message: `조건을 만족하면서 충분히 다른 경로가 ${selection.recommendations.length}개뿐이에요.`,
        });
      }

      const response = recommendationResponseSchema.parse({
        requestId: input.requestId,
        generatedAt: this.#clock().toISOString(),
        departureAt: departureAt.toISOString(),
        baseline: {
          durationSeconds: generated.baseline.durationSeconds,
          arrivalAt: new Date(
            departureAt.getTime() +
              generated.baseline.durationSeconds * 1000,
          ).toISOString(),
          walkDistanceMeters: generated.baseline.walkDistanceMeters,
          estimatedSteps: baselineMetrics.baseEstimatedSteps,
        },
        walkingGoal: {
          remainingSteps: baselineMetrics.remainingSteps,
          targetWalkDistanceMeters: Math.round(
            baselineMetrics.targetTripWalkDistanceMeters,
          ),
          toleranceSteps: Math.round(baselineMetrics.remainingSteps * 0.05),
          effectiveStepLengthMeters:
            input.request.walkingMetric.stepLengthMeters,
          source: input.request.walkingMetric.source,
        },
        primaryRecommendationId,
        recommendations: selection.recommendations,
        warnings,
      });

      this.#logger.info({
        event: "recommendation.completed",
        requestId: input.requestId,
        candidateCount: generated.candidates.length,
        successfulCandidateCount: generated.candidates.length,
        candidateFailureCount: generated.candidateFailureCount,
        recommendationCount: response.recommendations.length,
        routeApiCallCount: generated.routeApiCallCount,
        recommendationMode: policy.mode,
        maxExtraMinutes: policy.maxExtraMinutes,
      });
      return response;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (timeoutSignal.aborted) {
        throw new AppError({
          code: "UPSTREAM_TIMEOUT",
          message: "추천 경로 계산 시간이 초과됐어요. 다시 시도해 주세요.",
          status: 504,
          cause: error,
        });
      }
      if (error instanceof ProviderError) {
        throw mapProviderError(error);
      }
      throw error;
    }
  }

  #validateRequest(
    request: RecommendationRequest,
    departureAt: Date,
    requestId: string,
  ): void {
    if (
      haversineDistanceMeters(
        request.origin.location,
        request.destination.location,
      ) < 50
    ) {
      throw new AppError({
        code: "LOCATIONS_TOO_CLOSE",
        message: "출발지와 목적지가 너무 가까워요.",
        status: 400,
      });
    }

    if (!isLegacyRecommendationRequest(request)) {
      return;
    }

    const deadline = new Date(request.deadline);
    const sixHoursLater = departureAt.getTime() + 6 * 60 * 60 * 1000;
    if (
      deadline.getTime() <= departureAt.getTime() ||
      deadline.getTime() > sixHoursLater
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "도착 마감시간은 지금부터 6시간 이내로 설정해 주세요.",
        status: 400,
        fieldErrors: {
          deadline: ["현재보다 미래이면서 6시간 이내여야 합니다."],
        },
      });
    }
    if (
      deadline.getTime() -
        request.safetyBufferMinutes * 60_000 <=
      departureAt.getTime()
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "안전 여유시간을 적용하면 마감시간이 너무 촉박해요.",
        status: 400,
        fieldErrors: {
          safetyBufferMinutes: [
            "안전 여유시간을 줄이거나 마감시간을 늦춰 주세요.",
          ],
        },
      });
    }

    void requestId;
  }
}
