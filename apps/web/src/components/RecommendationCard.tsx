import type { Recommendation } from "@chimap/contracts";
import {
  BusFront,
  Check,
  Clock3,
  Footprints,
  Ticket,
} from "lucide-react";

import {
  formatDistance,
  formatDuration,
  formatKstTime,
} from "../lib/time.js";

type RecommendationCardProps = {
  recommendation: Recommendation;
  selected: boolean;
  onSelect: () => void;
};

const TYPE_META = {
  FAST: { badge: "가장 빠름", tone: "navy" },
  BALANCED: { badge: "추천", tone: "teal" },
  GOAL: { badge: "목표에 가까움", tone: "orange" },
} as const;

export function RecommendationCard({
  recommendation,
  selected,
  onSelect,
}: RecommendationCardProps) {
  const meta = TYPE_META[recommendation.type];
  const completionPercent = Math.round(
    recommendation.dailyGoalCompletionRate * 100,
  );
  return (
    <button
      type="button"
      className={`recommendation-card ${selected ? "is-selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${recommendation.title}, 예상 도착 ${formatKstTime(recommendation.arrivalAt)}`}
    >
      <div className="card-topline">
        <span className={`route-type route-type-${meta.tone}`}>
          {recommendation.title}
        </span>
        <span className="card-badge">
          {selected ? <Check aria-hidden="true" size={14} /> : null}
          {selected ? "선택됨" : meta.badge}
        </span>
      </div>
      <p className="card-reason">{recommendation.reason}</p>
      {recommendation.isRealtime === undefined ? null : (
        <span
          className={
            recommendation.isRealtime
              ? "realtime-badge"
              : "estimate-badge"
          }
        >
          {recommendation.isRealtime
            ? "실시간 도착 반영"
            : "일부 예상값 사용"}
        </span>
      )}

      <div className="arrival-row">
        <span>
          <Clock3 aria-hidden="true" size={17} />
          예상 도착
        </span>
        <strong>{formatKstTime(recommendation.arrivalAt)}</strong>
        <small>{formatDuration(recommendation.durationSeconds)}</small>
      </div>

      <div className="metric-pair">
        <div>
          <span>기본 대비</span>
          <strong>
            {recommendation.extraMinutes === 0
              ? "동일"
              : `+${recommendation.extraMinutes}분`}
          </strong>
        </div>
        <div>
          <span>예상 걸음</span>
          <strong>{recommendation.estimatedSteps.toLocaleString("ko-KR")}</strong>
        </div>
      </div>

      <div className="completion">
        <div className="label-row">
          <span>이동 후 하루 목표 달성률</span>
          <strong>{completionPercent}%</strong>
        </div>
        <div
          className="completion-track"
          role="progressbar"
          aria-label="이동 후 하루 목표 달성률"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completionPercent}
        >
          <i style={{ width: `${completionPercent}%` }} />
        </div>
      </div>

      <div className="card-foot">
        <span>
          <Footprints aria-hidden="true" size={16} />
          {formatDistance(recommendation.walkDistanceMeters)}
        </span>
        <span>
          <BusFront aria-hidden="true" size={16} />
          {recommendation.transferCount === 0
            ? "환승 없음"
            : `환승 ${recommendation.transferCount}회`}
        </span>
        <span>
          <Ticket aria-hidden="true" size={16} />
          {recommendation.fareWon === undefined
            ? "요금 정보 없음"
            : `${recommendation.fareWon.toLocaleString("ko-KR")}원`}
        </span>
      </div>
    </button>
  );
}
