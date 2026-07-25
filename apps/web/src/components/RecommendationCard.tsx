import type { Recommendation, RouteLeg } from "@chimap/contracts";
import {
  BusFront,
  Check,
  ChevronDown,
  Footprints,
  TrainFront,
} from "lucide-react";

import {
  formatDistance,
  formatDuration,
  formatKstTime,
} from "../lib/time.js";

type RecommendationCardProps = {
  recommendation: Recommendation;
  selected: boolean;
  detailsOpen: boolean;
  detailsId: string;
  onSelect: () => void;
  onToggleDetails: () => void;
};

const TYPE_META = {
  FAST: { badge: "가장 빠름", tone: "navy" },
  BALANCED: { badge: "추천", tone: "teal" },
  GOAL: { badge: "목표에 가까움", tone: "orange" },
} as const;

function legLabel(leg: RouteLeg): string {
  if (leg.mode === "BUS") {
    return leg.name ?? "버스";
  }
  if (leg.mode === "SUBWAY") {
    return leg.name ?? "지하철";
  }
  if (leg.walkingRole === "GOAL_EARLY_ALIGHTING") {
    return "미리 내려 걷기";
  }
  if (leg.walkingRole === "GOAL_LATE_BOARDING") {
    return "더 걸어 탑승";
  }
  return leg.isExerciseSegment ? "추가 도보" : "도보";
}

function compactLegs(legs: RouteLeg[]): Array<{
  key: string;
  label: string;
  mode: RouteLeg["mode"];
  isExercise: boolean;
}> {
  const result: Array<{
    key: string;
    label: string;
    mode: RouteLeg["mode"];
    isExercise: boolean;
  }> = [];

  for (const leg of legs) {
    const label = legLabel(leg);
    const previous = result.at(-1);
    if (
      leg.mode === "WALK" &&
      previous?.mode === "WALK" &&
      previous.isExercise === leg.isExerciseSegment
    ) {
      continue;
    }
    result.push({
      key: leg.id,
      label,
      mode: leg.mode,
      isExercise: leg.isExerciseSegment,
    });
  }

  return result;
}

function LegSummaryIcon({
  mode,
}: {
  mode: RouteLeg["mode"];
}) {
  if (mode === "BUS") {
    return <BusFront aria-hidden="true" />;
  }
  if (mode === "SUBWAY") {
    return <TrainFront aria-hidden="true" />;
  }
  return <Footprints aria-hidden="true" />;
}

export function RecommendationCard({
  recommendation,
  selected,
  detailsOpen,
  detailsId,
  onSelect,
  onToggleDetails,
}: RecommendationCardProps) {
  const meta = TYPE_META[recommendation.type];
  const completionPercent = Math.round(
    recommendation.dailyGoalCompletionRate * 100,
  );
  const walkDurationSeconds = recommendation.legs.reduce(
    (total, leg) =>
      leg.mode === "WALK" ? total + leg.durationSeconds : total,
    0,
  );
  const routeLegs = compactLegs(recommendation.legs);
  const routeDescription = routeLegs.map((leg) => leg.label).join(", ");

  return (
    <article
      className={`recommendation-card ${selected ? "is-selected" : ""}`}
    >
      <button
        type="button"
        className="route-summary-button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${recommendation.title}, 예상 도착 ${formatKstTime(recommendation.arrivalAt)}`}
      >
        <span className="card-topline">
          <span className={`route-type route-type-${meta.tone}`}>
            {meta.badge}
          </span>
          {selected ? (
            <span className="card-badge">
              <Check aria-hidden="true" size={14} />
              선택됨
            </span>
          ) : null}
        </span>

        <span className="route-time-summary">
          <strong>{formatDuration(recommendation.durationSeconds)}</strong>
          <span>
            {formatKstTime(recommendation.arrivalAt)} 도착
            {recommendation.extraMinutes > 0
              ? ` · 기본보다 ${recommendation.extraMinutes}분`
              : " · 가장 빠른 도착"}
          </span>
        </span>

        <span
          className="mode-duration-strip"
          role="img"
          aria-label={`이동수단 구성: ${routeDescription}`}
        >
          {recommendation.legs.map((leg) => (
            <i
              key={leg.id}
              className={`mode-segment mode-${leg.mode.toLowerCase()} ${
                leg.isExerciseSegment ? "is-exercise" : ""
              }`}
              style={{ flexGrow: Math.max(leg.durationSeconds, 60) }}
            />
          ))}
        </span>

        <span className="compact-route" aria-hidden="true">
          {routeLegs.map((leg, index) => (
            <span className="compact-leg-wrap" key={leg.key}>
              {index > 0 ? <i className="compact-route-arrow">→</i> : null}
              <span
                className={`compact-leg compact-leg-${leg.mode.toLowerCase()} ${
                  leg.isExercise ? "is-exercise" : ""
                }`}
              >
                <LegSummaryIcon mode={leg.mode} />
                {leg.label}
              </span>
            </span>
          ))}
        </span>

        <span className="route-key-metrics">
          <span>
            도보 {formatDuration(walkDurationSeconds)} ·{" "}
            {formatDistance(recommendation.walkDistanceMeters)}
          </span>
          <span>
            {recommendation.transferCount === 0
              ? "환승 없음"
              : `환승 ${recommendation.transferCount}회`}
          </span>
          <span>
            {recommendation.estimatedSteps.toLocaleString("ko-KR")}걸음 · 목표{" "}
            {completionPercent}%
          </span>
          <span
            className={
              recommendation.goalFit === "WITHIN_TOLERANCE"
                ? "goal-fit"
                : "goal-gap"
            }
          >
            {recommendation.goalFit === "WITHIN_TOLERANCE"
              ? "목표 범위 안"
              : recommendation.stepDifference < 0
                ? `${Math.abs(recommendation.stepDifference).toLocaleString("ko-KR")}걸음 부족`
                : `${recommendation.stepDifference.toLocaleString("ko-KR")}걸음 초과`}
          </span>
        </span>
      </button>

      <div className="card-actions">
        <span
          className={
            recommendation.isRealtime === true
              ? "realtime-badge"
              : "estimate-badge"
          }
        >
          {recommendation.isRealtime === true
            ? "실시간 도착"
            : "예상 도착 포함"}
        </span>
        <button
          type="button"
          className="details-toggle"
          onClick={onToggleDetails}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          aria-label={`${recommendation.title} ${detailsOpen ? "상세 접기" : "자세히"}`}
        >
          {detailsOpen ? "접기" : "자세히"}
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
