import type { Recommendation, RouteLeg } from "@chimap/contracts";
import { BusFront, Footprints, TrainFront } from "lucide-react";

import { formatDistance, formatDuration } from "../lib/time.js";

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
  if (leg.isExerciseSegment) {
    return "추가 운동 도보";
  }
  if (leg.mode === "WALK") {
    return "일반 도보";
  }
  return leg.mode === "BUS" ? "버스" : "지하철";
}

export function RouteDetails({
  recommendation,
}: {
  recommendation: Recommendation;
}) {
  return (
    <section className="route-details" aria-labelledby="route-details-title">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">선택 경로 상세</span>
          <h2 id="route-details-title">{recommendation.title}</h2>
        </div>
        <span className="step-chip">
          부족분의 {Math.round(recommendation.shortfallCoverageRate * 100)}%
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
          입력한 보폭으로 도보거리를 걸음 수로 환산했습니다. 경로와
          도착시간은 지금 출발 기준이며 실제 대기시간, 신호, 걷는 속도에 따라
          달라질 수 있어요.
        </p>
        {recommendation.estimationNotes?.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </details>
    </section>
  );
}
