import type { Recommendation, RouteLeg } from "@chimap/contracts";
import {
  BusFront,
  ChevronUp,
  Footprints,
  Ticket,
  TrainFront,
} from "lucide-react";

import {
  formatDistance,
  formatDuration,
  formatKstTime,
} from "../lib/time.js";

function LegIcon({ leg }: { leg: RouteLeg }) {
  if (leg.mode === "BUS") {
    return <BusFront aria-hidden="true" />;
  }
  if (leg.mode === "SUBWAY") {
    return <TrainFront aria-hidden="true" />;
  }
  return <Footprints aria-hidden="true" />;
}

function modeLabel(leg: RouteLeg): string {
  if (leg.walkingRole === "GOAL_EARLY_ALIGHTING") {
    return "미리 내려 걷기";
  }
  if (leg.walkingRole === "GOAL_LATE_BOARDING") {
    return "더 걸어 탑승";
  }
  if (leg.mode === "WALK") {
    return "일반 도보";
  }
  return leg.mode === "BUS" ? "버스" : "지하철";
}

export function RouteDetails({
  recommendation,
  id,
  onCollapse,
}: {
  recommendation: Recommendation;
  id: string;
  onCollapse: () => void;
}) {
  const titleId = `${id}-title`;
  return (
    <section
      id={id}
      className="route-details"
      aria-labelledby={titleId}
    >
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">선택 경로 상세</span>
          <h2 id={titleId}>{recommendation.title}</h2>
        </div>
        <div className="route-detail-heading-actions">
          <span className="step-chip">
            부족분의 {Math.round(recommendation.shortfallCoverageRate * 100)}%
          </span>
          <button
            type="button"
            className="route-detail-collapse"
            onClick={onCollapse}
            aria-label={`${recommendation.title} 간략히 보기`}
          >
            간략히
            <ChevronUp aria-hidden="true" />
          </button>
        </div>
      </div>

      <p className="route-detail-reason">{recommendation.reason}</p>
      <div className="route-detail-facts" aria-label="선택 경로 핵심 정보">
        <span>
          <strong>{formatDuration(recommendation.durationSeconds)}</strong>
          총 소요
        </span>
        <span>
          <strong>{formatKstTime(recommendation.arrivalAt)}</strong>
          예상 도착
        </span>
        <span>
          <Ticket aria-hidden="true" />
          <strong>
            {recommendation.fareWon === undefined
              ? "확인 필요"
              : `${recommendation.fareWon.toLocaleString("ko-KR")}원`}
          </strong>
          예상 요금
        </span>
      </div>

      <ol className="leg-list" aria-label="텍스트 이동 단계">
        {recommendation.legs.map((leg, index) => (
          <li
            key={leg.id}
            className={leg.isExerciseSegment ? "is-exercise" : ""}
          >
            <div className={`leg-icon leg-${leg.mode.toLocaleLowerCase()}`}>
              <LegIcon leg={leg} />
            </div>
            <div>
              <div className="leg-heading">
                <strong>
                  {index + 1}. {modeLabel(leg)}
                  {leg.name === undefined ? "" : ` · ${leg.name}`}
                </strong>
                {leg.isExerciseSegment ? (
                  <span className="exercise-badge">운동 구간</span>
                ) : null}
              </div>
              <p>{leg.guidance ?? `${modeLabel(leg)} 구간으로 이동`}</p>
              <small>
                {formatDuration(leg.durationSeconds)} ·{" "}
                {formatDistance(leg.distanceMeters)}
                {leg.bus !== undefined
                  ? ` · ${leg.bus.stopCount}개 정류장`
                  : leg.stops === undefined
                  ? ""
                  : ` · ${Math.max(leg.stops.length - 1, 0)}개 정류장`}
              </small>
              {leg.bus === undefined ? null : (
                <div className="bus-leg-meta">
                  <span>
                    {leg.bus.boardingStop.name} →{" "}
                    {leg.bus.alightingStop.name}
                  </span>
                  <span
                    className={
                      leg.bus.isArrivalRealtime
                        ? "realtime-badge"
                        : "estimate-badge"
                    }
                  >
                    {leg.bus.isArrivalRealtime ? "실시간" : "예상"} ·{" "}
                    {Math.ceil(leg.bus.expectedArrivalSeconds / 60)}분 후
                  </span>
                  {leg.bus.vehicleType?.includes("저상") === true ? (
                    <span className="low-floor-badge">저상버스</span>
                  ) : null}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>

      <details className="calculation-note">
        <summary>예상값은 어떻게 계산했나요?</summary>
        <p>
          신장·체중·나이·생물학적 성별로 추정한 개인화 한 걸음 길이로
          도보거리를 걸음 수로 환산했습니다. 경로와 도착시간은 지금 출발
          기준이며 실제 대기시간, 신호, 걷는 속도에 따라 달라질 수 있어요.
        </p>
        {recommendation.estimationNotes?.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </details>
    </section>
  );
}
