import {
  haversineDistanceMeters,
  recommendationResponseSchema,
  type ApiWarning,
  type Recommendation,
  type RecommendationRequest,
  type RecommendationResponse,
  type RouteLeg,
} from "@chimap/contracts";
import type { Logger } from "pino";

import { AppError, mapProviderError, ProviderError } from "../errors.js";
import {
  calculateStepMetrics,
  isLegacyRecommendationRequest,
  resolveRecommendationPolicy,
} from "./calculations.js";
import { CandidateGenerator } from "./candidate-generator.js";
import {
  finalizeRecommendations,
  recalculateRecommendations,
  selectRecommendations,
} from "./recommendation-engine.js";
import type {
  RouteGeometryProfile,
  SubwayGeometryObservation,
} from "../providers/subway-track-geometry.js";
import type { RouteGeometryObservation } from "../providers/route-geometry.js";
import type { ParkRouteCandidateService } from "../parks/park-route-candidate-service.js";
import { runWithRecommendationPhase } from "../monitoring/request-context.js";
import type { GeometrySkippedObservation } from "./selected-route-geometry-service.js";

export type Clock = () => Date;

export const RECOMMENDATION_PHASES = [
  "CANDIDATE_GENERATION",
  "SELECTION",
  "SELECTED_GEOMETRY",
  "PARK_ROUTE",
  "RESPONSE_VALIDATION",
] as const;

export type RecommendationPhase = (typeof RECOMMENDATION_PHASES)[number];
export type RecommendationPhaseOutcome =
  | "SUCCESS"
  | "DEGRADED"
  | "ERROR"
  | "TIMEOUT"
  | "SKIPPED";
export type RecommendationTimeoutOrigin =
  | "NONE"
  | "CLIENT"
  | "PLANNING"
  | "GEOMETRY"
  | "PROVIDER"
  | "QUEUE";
export type RecommendationPhaseObservation = {
  phase: RecommendationPhase;
  outcome: RecommendationPhaseOutcome;
  timeoutOrigin: RecommendationTimeoutOrigin;
  durationMilliseconds: number;
};

export const RECOMMENDATION_HARD_DEADLINE_MILLISECONDS = 20_000;
const PLANNING_DEADLINE_MILLISECONDS = 8_000;
const FINAL_PHASE_BUDGET_MILLISECONDS = 8_000;
const FINAL_PHASE_CUTOFF_MILLISECONDS = 18_000;

type TaggedTimeoutReason = DOMException & {
  chimapTimeoutOrigin: "PLANNING" | "GEOMETRY";
};

function deadlineSignal(
  milliseconds: number,
  timeoutOrigin: TaggedTimeoutReason["chimapTimeoutOrigin"],
): AbortSignal {
  const controller = new AbortController();
  const abort = () => {
    const reason = new DOMException(
      `${timeoutOrigin.toLowerCase()} deadline`,
      "TimeoutError",
    ) as TaggedTimeoutReason;
    reason.chimapTimeoutOrigin = timeoutOrigin;
    controller.abort(reason);
  };
  if (milliseconds <= 0) {
    abort();
    return controller.signal;
  }
  const timeout = AbortSignal.timeout(Math.ceil(milliseconds));
  if (timeout.aborted) abort();
  else timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

function combinedSignal(
  signal: AbortSignal | undefined,
  deadline: AbortSignal,
): AbortSignal {
  return signal === undefined
    ? deadline
    : AbortSignal.any([signal, deadline]);
}

function finalPhaseDeadlineSignal(
  requestStartedAtMilliseconds: number,
): AbortSignal {
  const untilCutoff =
    requestStartedAtMilliseconds + FINAL_PHASE_CUTOFF_MILLISECONDS - Date.now();
  const delay = Math.min(FINAL_PHASE_BUDGET_MILLISECONDS, untilCutoff);
  return delay <= 0
    ? deadlineSignal(0, "GEOMETRY")
    : deadlineSignal(delay, "GEOMETRY");
}

function abortProviderError(signal: AbortSignal): ProviderError {
  const timedOut =
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError";
  return new ProviderError({
    kind: timedOut ? "TIMEOUT" : "ABORTED",
    message: timedOut
      ? "추천 단계 처리 시간이 초과되었습니다."
      : "추천 요청이 취소되었습니다.",
    retryable: timedOut,
    cause: signal.reason,
  });
}

function withAbortSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortProviderError(signal));
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleAbort = () => settle(() => reject(abortProviderError(signal)));
    signal.addEventListener("abort", handleAbort, { once: true });
    operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

function overlayLegGeometry(target: RouteLeg, source: RouteLeg): RouteLeg {
  if (
    target.id !== source.id ||
    target.mode !== source.mode ||
    (target.mode !== "BUS" && target.mode !== "WALK")
  ) {
    return target;
  }
  return {
    ...target,
    ...(target.mode === "WALK"
      ? {
          distanceMeters: source.distanceMeters,
          durationSeconds: source.durationSeconds,
        }
      : {}),
    coordinates: source.coordinates,
    ...(source.geometryQuality === undefined
      ? {}
      : { geometryQuality: source.geometryQuality }),
    ...(target.mode === "BUS" &&
        target.bus !== undefined &&
        source.bus !== undefined
      ? {
          bus: {
            ...target.bus,
            polyline: source.bus.polyline,
          },
        }
      : {}),
  };
}

export function overlaySelectedRouteGeometry(
  target: readonly Recommendation[],
  detailed: readonly Recommendation[],
): Recommendation[] {
  const detailedById = new Map(
    detailed.map((recommendation) => [recommendation.id, recommendation]),
  );
  const detailedGoal = detailed.find(
    (recommendation) => recommendation.type === "GOAL",
  );
  return target.map((recommendation) => {
    const source = detailedById.get(recommendation.id) ??
      (recommendation.type === "GOAL" ? detailedGoal : undefined);
    if (source === undefined) return recommendation;
    const sourceLegs = new Map(source.legs.map((leg) => [leg.id, leg]));
    return {
      ...recommendation,
      legs: recommendation.legs.map((leg) => {
        const sourceLeg = sourceLegs.get(leg.id);
        return sourceLeg === undefined
          ? leg
          : overlayLegGeometry(leg, sourceLeg);
      }),
    };
  });
}

type GeometryCompletion =
  | { status: "fulfilled"; recommendations: Recommendation[] }
  | { status: "rejected"; error: unknown };

export class RecommendationService {
  readonly #candidateGenerator: CandidateGenerator;
  readonly #clock: Clock;
  readonly #logger: Logger;
  readonly #parkRoutes: ParkRouteCandidateService | undefined;
  readonly #observePhase:
    | ((observation: RecommendationPhaseObservation) => void)
    | undefined;
  readonly #phasedTimeoutsEnabled: boolean;
  readonly #selectedGeometryEnabled: boolean;
  readonly #observeGeometrySkipped:
    | ((observation: GeometrySkippedObservation) => void)
    | undefined;

  public constructor(options: {
    candidateGenerator: CandidateGenerator;
    clock?: Clock;
    logger: Logger;
    parkRoutes?: ParkRouteCandidateService;
    observePhase?: (observation: RecommendationPhaseObservation) => void;
    observeGeometrySkipped?: (
      observation: GeometrySkippedObservation,
    ) => void;
    phasedTimeoutsEnabled?: boolean;
    selectedGeometryEnabled?: boolean;
  }) {
    this.#candidateGenerator = options.candidateGenerator;
    this.#clock = options.clock ?? (() => new Date());
    this.#logger = options.logger;
    this.#parkRoutes = options.parkRoutes;
    this.#observePhase = options.observePhase;
    this.#phasedTimeoutsEnabled = options.phasedTimeoutsEnabled ?? false;
    this.#selectedGeometryEnabled = options.selectedGeometryEnabled ?? false;
    this.#observeGeometrySkipped = options.observeGeometrySkipped;
  }

  public async createRecommendations(input: {
    request: RecommendationRequest;
    requestId: string;
    signal?: AbortSignal;
    geometryProfile?: RouteGeometryProfile;
    observeSubwayGeometry?: (observation: SubwayGeometryObservation) => void;
    observeRouteGeometry?: (observation: RouteGeometryObservation) => void;
  }): Promise<RecommendationResponse> {
    const requestStartedAtMilliseconds = Date.now();
    const departureAt = this.#clock();
    this.#validateRequest(input.request, departureAt, input.requestId);
    const hardDeadlineSignal = deadlineSignal(
      RECOMMENDATION_HARD_DEADLINE_MILLISECONDS,
      "PLANNING",
    );
    const requestSignal = combinedSignal(input.signal, hardDeadlineSignal);
    const planningDeadlineSignal = this.#phasedTimeoutsEnabled
      ? deadlineSignal(PLANNING_DEADLINE_MILLISECONDS, "PLANNING")
      : undefined;
    const planningSignal = planningDeadlineSignal === undefined
      ? requestSignal
      : AbortSignal.any([requestSignal, planningDeadlineSignal]);
    let selectedGeometryDegradedWorkCount = 0;
    const observeRouteGeometry = (observation: RouteGeometryObservation) => {
      input.observeRouteGeometry?.(observation);
    };
    const observeSelectedRouteGeometry = (
      observation: RouteGeometryObservation,
    ) => {
      if (observation.outcome === "APPROXIMATE") {
        selectedGeometryDegradedWorkCount += 1;
      }
      observeRouteGeometry(observation);
    };
    const observeSelectedGeometrySkipped = (
      observation: GeometrySkippedObservation,
    ) => {
      selectedGeometryDegradedWorkCount += 1;
      this.#observeGeometrySkipped?.(observation);
    };
    const selectedGeometryOutcome = (): RecommendationPhaseOutcome =>
      selectedGeometryDegradedWorkCount > 0 ? "DEGRADED" : "SUCCESS";

    try {
      const generationStartedAt = performance.now();
      let generated: Awaited<
        ReturnType<CandidateGenerator["generate"]>
      >;
      try {
        generated = await runWithRecommendationPhase(
          "CANDIDATE_GENERATION",
          () => this.#candidateGenerator.generate(
            input.request,
            planningSignal,
            {
              ...(input.geometryProfile === undefined
                ? {}
                : { geometryProfile: input.geometryProfile }),
              ...(this.#phasedTimeoutsEnabled
                ? { allowPartialOnTimeout: true }
                : {}),
              ...(input.observeSubwayGeometry === undefined
                ? {}
                : { observeSubwayGeometry: input.observeSubwayGeometry }),
              observeRouteGeometry,
            },
          ),
        );
        this.#recordPhase(
          "CANDIDATE_GENERATION",
          generated.planningTimedOut === true ? "TIMEOUT" : "SUCCESS",
          generated.planningTimedOut === true ? "PLANNING" : "NONE",
          generationStartedAt,
        );
      } catch (error) {
        const timeoutOrigin = this.#timeoutOrigin({
          error,
          phase: "PLANNING",
          clientSignal: input.signal,
          hardDeadlineSignal,
          ...(planningDeadlineSignal === undefined
            ? {}
            : { phaseDeadlineSignal: planningDeadlineSignal }),
        });
        this.#recordPhase(
          "CANDIDATE_GENERATION",
          timeoutOrigin === "NONE" || timeoutOrigin === "CLIENT"
            ? "ERROR"
            : "TIMEOUT",
          timeoutOrigin,
          generationStartedAt,
        );
        throw error;
      }
      if (generated.routeApiCallCount > 9) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "경로 조회 호출 한도를 초과했어요.",
          status: 500,
        });
      }
      const candidateKindByRecommendationId = new Map(
        generated.candidates.map((candidate) => [
          candidate.route.id,
          candidate.kind,
        ] as const),
      );

      const selectionStartedAt = performance.now();
      let policy: ReturnType<typeof resolveRecommendationPolicy>;
      let selection: ReturnType<typeof selectRecommendations>;
      try {
        policy = resolveRecommendationPolicy(
          input.request,
          generated.baseline,
        );
        selection = selectRecommendations({
          candidates: generated.candidates,
          baseline: generated.baseline,
          request: input.request,
          departureAt,
          policy,
        });
        this.#recordPhase(
          "SELECTION",
          "SUCCESS",
          "NONE",
          selectionStartedAt,
        );
      } catch (error) {
        this.#recordPhase(
          "SELECTION",
          "ERROR",
          "NONE",
          selectionStartedAt,
        );
        throw error;
      }
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
      let primaryRecommendationId = selection.primaryRecommendationId;
      if (primaryRecommendationId === undefined) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "기본 추천 경로를 결정하지 못했어요.",
          status: 500,
        });
      }
      let recommendations = selection.recommendations;
      const finalDeadlineSignal = this.#phasedTimeoutsEnabled
        ? finalPhaseDeadlineSignal(requestStartedAtMilliseconds)
        : undefined;
      const finalPhaseSignal = finalDeadlineSignal === undefined
        ? requestSignal
        : AbortSignal.any([requestSignal, finalDeadlineSignal]);
      let geometryCompletion: Promise<GeometryCompletion> | undefined;
      if (input.geometryProfile === "TRANSIT_V2") {
        const geometryStartedAt = performance.now();
        const prioritized = [
          ...recommendations.filter(
            (recommendation) => recommendation.id === primaryRecommendationId,
          ),
          ...recommendations.filter(
            (recommendation) => recommendation.id !== primaryRecommendationId,
          ),
        ];
        if (finalPhaseSignal.aborted) {
          await runWithRecommendationPhase(
            "SELECTED_GEOMETRY",
            () => this.#selectedGeometryEnabled
              ? this.#candidateGenerator.enrichSelectedRouteGeometry(
                  prioritized,
                  finalPhaseSignal,
                  observeSelectedRouteGeometry,
                  observeSelectedGeometrySkipped,
                )
              : this.#candidateGenerator.enrichWalkingGeometry(
                  prioritized,
                  finalPhaseSignal,
                  observeSelectedRouteGeometry,
                  observeSelectedGeometrySkipped,
                ),
          );
          this.#recordPhase(
            "SELECTED_GEOMETRY",
            "SKIPPED",
            this.#timeoutOrigin({
              phase: "GEOMETRY",
              clientSignal: input.signal,
              hardDeadlineSignal,
              ...(finalDeadlineSignal === undefined
                ? {}
                : { phaseDeadlineSignal: finalDeadlineSignal }),
            }),
            geometryStartedAt,
          );
        } else if (
          this.#selectedGeometryEnabled &&
          this.#parkRoutes !== undefined
        ) {
          const plan = runWithRecommendationPhase(
            "SELECTED_GEOMETRY",
            () => this.#candidateGenerator.prepareSelectedRouteGeometry(
              prioritized,
              finalPhaseSignal,
              observeSelectedRouteGeometry,
              observeSelectedGeometrySkipped,
            ),
          );
          geometryCompletion = withAbortSignal(
            plan.complete,
            finalPhaseSignal,
          ).then(
            (enriched): GeometryCompletion => {
              this.#recordPhase(
                "SELECTED_GEOMETRY",
                selectedGeometryOutcome(),
                "NONE",
                geometryStartedAt,
              );
              return { status: "fulfilled", recommendations: enriched };
            },
            (error: unknown): GeometryCompletion => {
              const timeoutOrigin = this.#timeoutOrigin({
                error,
                phase: "GEOMETRY",
                clientSignal: input.signal,
                hardDeadlineSignal,
                ...(finalDeadlineSignal === undefined
                  ? {}
                  : { phaseDeadlineSignal: finalDeadlineSignal }),
              });
              this.#recordPhase(
                "SELECTED_GEOMETRY",
                timeoutOrigin === "NONE" || timeoutOrigin === "CLIENT"
                  ? "ERROR"
                  : "TIMEOUT",
                timeoutOrigin,
                geometryStartedAt,
              );
              return { status: "rejected", error };
            },
          );
          try {
            const goalReady = await withAbortSignal(
              plan.goalWalking,
              finalPhaseSignal,
            );
            const goalReadyById = new Map(
              goalReady.map((recommendation) => [
                recommendation.id,
                recommendation,
              ]),
            );
            recommendations = recommendations.map(
              (recommendation) =>
                goalReadyById.get(recommendation.id) ?? recommendation,
            );
          } catch (error) {
            if (requestSignal.aborted) throw error;
          }
        } else {
          try {
            const enriched = await withAbortSignal(
              runWithRecommendationPhase(
                "SELECTED_GEOMETRY",
                () => this.#selectedGeometryEnabled
                  ? this.#candidateGenerator.enrichSelectedRouteGeometry(
                      prioritized,
                      finalPhaseSignal,
                      observeSelectedRouteGeometry,
                      observeSelectedGeometrySkipped,
                    )
                  : this.#candidateGenerator.enrichWalkingGeometry(
                      prioritized,
                      finalPhaseSignal,
                      observeSelectedRouteGeometry,
                      observeSelectedGeometrySkipped,
                    ),
              ),
              finalPhaseSignal,
            );
            const enrichedById = new Map(
              enriched.map((recommendation) => [
                recommendation.id,
                recommendation,
              ]),
            );
            recommendations = recommendations.map(
              (recommendation) =>
                enrichedById.get(recommendation.id) ?? recommendation,
            );
            this.#recordPhase(
              "SELECTED_GEOMETRY",
              finalPhaseSignal.aborted
                ? "TIMEOUT"
                : selectedGeometryOutcome(),
              finalPhaseSignal.aborted
                ? this.#timeoutOrigin({
                    phase: "GEOMETRY",
                    clientSignal: input.signal,
                    hardDeadlineSignal,
                    ...(finalDeadlineSignal === undefined
                      ? {}
                      : { phaseDeadlineSignal: finalDeadlineSignal }),
                  })
                : "NONE",
              geometryStartedAt,
            );
          } catch (error) {
            const timeoutOrigin = this.#timeoutOrigin({
              error,
              phase: "GEOMETRY",
              clientSignal: input.signal,
              hardDeadlineSignal,
              ...(finalDeadlineSignal === undefined
                ? {}
                : { phaseDeadlineSignal: finalDeadlineSignal }),
            });
            this.#recordPhase(
              "SELECTED_GEOMETRY",
              timeoutOrigin === "NONE" || timeoutOrigin === "CLIENT"
                ? "ERROR"
                : "TIMEOUT",
              timeoutOrigin,
              geometryStartedAt,
            );
            if (requestSignal.aborted) throw error;
          }
        }
      } else {
        this.#recordPhase(
          "SELECTED_GEOMETRY",
          "SKIPPED",
          "NONE",
          performance.now(),
        );
      }
      recommendations = recalculateRecommendations({
        recommendations,
        request: input.request,
        departureAt,
        baselineDurationSeconds: generated.baseline.durationSeconds,
      });
      if (this.#parkRoutes !== undefined) {
        const parkStartedAt = performance.now();
        if (finalPhaseSignal.aborted) {
          this.#recordPhase(
            "PARK_ROUTE",
            "SKIPPED",
            this.#timeoutOrigin({
              phase: "GEOMETRY",
              clientSignal: input.signal,
              hardDeadlineSignal,
              ...(finalDeadlineSignal === undefined
                ? {}
                : { phaseDeadlineSignal: finalDeadlineSignal }),
            }),
            parkStartedAt,
          );
        } else {
          const priorGoalId = recommendations.find(
            (recommendation) => recommendation.type === "GOAL",
          )?.id;
          try {
            recommendations = await withAbortSignal(
              runWithRecommendationPhase(
                "PARK_ROUTE",
                () => this.#parkRoutes!.improveGoal({
                  recommendations,
                  request: input.request,
                  requestId: input.requestId,
                  baselineDurationSeconds: generated.baseline.durationSeconds,
                  policy,
                  departureAt,
                  remainingRouteApiCalls: 11 - generated.routeApiCallCount,
                  signal: finalPhaseSignal,
                }),
              ),
              finalPhaseSignal,
            );
            const newGoalId = recommendations.find(
              (recommendation) => recommendation.type === "GOAL",
            )?.id;
            const priorGoalCandidateKind =
              priorGoalId === undefined
                ? undefined
                : candidateKindByRecommendationId.get(priorGoalId);
            if (
              newGoalId !== undefined &&
              priorGoalCandidateKind !== undefined
            ) {
              candidateKindByRecommendationId.set(
                newGoalId,
                priorGoalCandidateKind,
              );
            }
            if (
              primaryRecommendationId === priorGoalId &&
              newGoalId !== undefined
            ) {
              primaryRecommendationId = newGoalId;
            }
            this.#recordPhase(
              "PARK_ROUTE",
              finalPhaseSignal.aborted ? "TIMEOUT" : "SUCCESS",
              finalPhaseSignal.aborted ? this.#timeoutOrigin({
                phase: "GEOMETRY",
                clientSignal: input.signal,
                hardDeadlineSignal,
                ...(finalDeadlineSignal === undefined
                  ? {}
                  : { phaseDeadlineSignal: finalDeadlineSignal }),
              }) : "NONE",
              parkStartedAt,
            );
          } catch (error) {
            const timeoutOrigin = this.#timeoutOrigin({
              error,
              phase: "GEOMETRY",
              clientSignal: input.signal,
              hardDeadlineSignal,
              ...(finalDeadlineSignal === undefined
                ? {}
                : { phaseDeadlineSignal: finalDeadlineSignal }),
            });
            this.#recordPhase(
              "PARK_ROUTE",
              timeoutOrigin === "NONE" || timeoutOrigin === "CLIENT"
                ? "ERROR"
                : "TIMEOUT",
              timeoutOrigin,
              parkStartedAt,
            );
            if (requestSignal.aborted) throw error;
          }
        }
      } else {
        this.#recordPhase(
          "PARK_ROUTE",
          "SKIPPED",
          "NONE",
          performance.now(),
        );
      }

      if (geometryCompletion !== undefined) {
        const completion = await geometryCompletion;
        if (completion.status === "fulfilled") {
          recommendations = overlaySelectedRouteGeometry(
            recommendations,
            completion.recommendations,
          );
        } else if (requestSignal.aborted) {
          throw completion.error;
        }
      }

      const finalized = finalizeRecommendations({
        recommendations,
        request: input.request,
        departureAt,
        baselineDurationSeconds: generated.baseline.durationSeconds,
        policy,
        requireDetailedExerciseWalking:
          input.geometryProfile === "TRANSIT_V2",
        candidateKindByRecommendationId,
      });
      recommendations = finalized.recommendations;
      primaryRecommendationId = finalized.primaryRecommendationId;
      const goalDecisionReason =
        "rejectionReason" in finalized.goalDecision
          ? finalized.goalDecision.rejectionReason
          : finalized.goalDecision.outcome === "KEPT"
            ? "VALID"
            : finalized.goalDecision.outcome === "PROMOTED"
              ? "CLOSER_TO_STEP_TARGET"
              : "NO_GOAL_CANDIDATE";
      this.#logger.info({
        event: "recommendation.goal_decision",
        requestId: input.requestId,
        outcome: finalized.goalDecision.outcome,
        reason: goalDecisionReason,
        originalGoalRecommendationId:
          "originalGoalRecommendationId" in finalized.goalDecision
            ? finalized.goalDecision.originalGoalRecommendationId ?? null
            : null,
        finalGoalRecommendationId:
          "finalGoalRecommendationId" in finalized.goalDecision
            ? finalized.goalDecision.finalGoalRecommendationId
            : null,
        promotedFromType:
          "promotedFromType" in finalized.goalDecision
            ? finalized.goalDecision.promotedFromType
            : null,
      });
      if (
        "originalGoalRecommendationId" in finalized.goalDecision &&
        finalized.goalDecision.originalGoalRecommendationId !== undefined &&
        "rejectionReason" in finalized.goalDecision &&
        (finalized.goalDecision.outcome === "REMOVED" ||
          finalized.goalDecision.outcome === "PROMOTED" ||
          finalized.goalDecision.outcome === "NOT_REQUIRED")
      ) {
        this.#logger.info({
          event: "recommendation.goal_removed",
          requestId: input.requestId,
          recommendationId:
            finalized.goalDecision.originalGoalRecommendationId,
          reason: finalized.goalDecision.rejectionReason,
          recommendationTypeBefore: "GOAL",
          recommendationTypeAfter: null,
          goalDecisionOutcome: finalized.goalDecision.outcome,
          ...(finalized.goalDecision.outcome === "PROMOTED" &&
              finalized.goalDecision.finalGoalRecommendationId !== undefined
            ? {
                replacementRecommendationId:
                  finalized.goalDecision.finalGoalRecommendationId,
                replacementRecommendationType: "GOAL",
              }
            : {}),
        });
      }
      if (
        finalized.goalDecision.outcome === "PROMOTED" &&
        finalized.goalDecision.finalGoalRecommendationId !== undefined
      ) {
        this.#logger.info({
          event: "recommendation.goal_promoted",
          requestId: input.requestId,
          recommendationId: finalized.goalDecision.finalGoalRecommendationId,
          recommendationTypeBefore:
            finalized.goalDecision.promotedFromType ?? "BALANCED",
          recommendationTypeAfter: "GOAL",
          replacedGoalRecommendationId:
            finalized.goalDecision.originalGoalRecommendationId ?? null,
        });
      }
      if (primaryRecommendationId === undefined) {
        throw new AppError({
          code: "INTERNAL_ERROR",
          message: "최종 기본 추천 경로를 결정하지 못했어요.",
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
        recommendations.some(
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
        recommendations.some(
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
      if (!finalized.goalReachable) {
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
      if (recommendations.length < 3) {
        warnings.push({
          code: "LIMITED_ROUTE_VARIETY",
          message: `조건을 만족하면서 충분히 다른 경로가 ${recommendations.length}개뿐이에요.`,
        });
      }

      const responseValidationStartedAt = performance.now();
      let response: RecommendationResponse;
      try {
        response = recommendationResponseSchema.parse({
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
          recommendations,
          warnings,
        });
        this.#recordPhase(
          "RESPONSE_VALIDATION",
          "SUCCESS",
          "NONE",
          responseValidationStartedAt,
        );
      } catch (error) {
        this.#recordPhase(
          "RESPONSE_VALIDATION",
          "ERROR",
          "NONE",
          responseValidationStartedAt,
        );
        throw error;
      }

      const geometryDegradedLegCount = response.recommendations.reduce(
        (count, recommendation) =>
          count + recommendation.legs.filter(
            (leg) => leg.geometryQuality === "APPROXIMATE",
          ).length,
        0,
      );
      this.#logger.info({
        event: "recommendation.completed",
        requestId: input.requestId,
        candidateCount: generated.candidates.length,
        successfulCandidateCount: generated.candidates.length,
        candidateFailureCount: generated.candidateFailureCount,
        geometryDegradedLegCount,
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
      if (hardDeadlineSignal.aborted) {
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

  #recordPhase(
    phase: RecommendationPhase,
    outcome: RecommendationPhaseOutcome,
    timeoutOrigin: RecommendationTimeoutOrigin,
    startedAt: number,
  ): void {
    try {
      this.#observePhase?.({
        phase,
        outcome,
        timeoutOrigin,
        durationMilliseconds: Math.max(0, performance.now() - startedAt),
      });
    } catch {
      // Observability must never change the recommendation result.
    }
  }

  #timeoutOrigin(input: {
    error?: unknown;
    phase: "PLANNING" | "GEOMETRY";
    clientSignal: AbortSignal | undefined;
    hardDeadlineSignal: AbortSignal;
    phaseDeadlineSignal?: AbortSignal;
  }): RecommendationTimeoutOrigin {
    if (input.clientSignal?.aborted === true) return "CLIENT";
    if (input.hardDeadlineSignal.aborted) return input.phase;
    if (input.phaseDeadlineSignal?.aborted === true) return input.phase;
    if (input.error instanceof ProviderError) {
      if (input.error.kind === "TIMEOUT") return "PROVIDER";
      if (input.error.kind === "ABORTED") return "QUEUE";
    }
    return "NONE";
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
