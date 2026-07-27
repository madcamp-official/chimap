import { Footprints } from "lucide-react";
import { useEffect, useState } from "react";

export function RecommendationProgress() {
  const [waitingLonger, setWaitingLonger] = useState(false);

  useEffect(() => {
    const longerTimer = window.setTimeout(() => setWaitingLonger(true), 8000);
    return () => window.clearTimeout(longerTimer);
  }, []);

  return (
    <section
      className="recommendation-progress"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="route-tracer" aria-hidden="true">
        <svg viewBox="0 0 300 116">
          <path
            className="route-tracer-base"
            d="M18 90C68 19 118 102 166 52S244 22 282 33"
          />
          <path
            className="route-tracer-line"
            pathLength="1"
            d="M18 90C68 19 118 102 166 52S244 22 282 33"
          />
          <circle className="route-tracer-origin" cx="18" cy="90" r="7" />
          <circle className="route-tracer-destination" cx="282" cy="33" r="7" />
        </svg>
        <span className="route-tracer-walker">
          <Footprints />
        </span>
      </div>
      <span className="eyebrow">건강 경로 계산 중</span>
      <h2>시간 안에 걸을 수 있는 경로를 찾고 있어요</h2>
      <p>
        {waitingLonger
          ? "교통 정보 응답이 평소보다 늦어요. 그대로 기다리거나 장소를 수정해 새로 검색할 수 있어요."
          : "실제 경로 요청을 처리하고 있어요. 보통 몇 초 안에 완료됩니다."}
      </p>
      <span className="progress-status">
        <i aria-hidden="true" />
        추천 요청 진행 중
      </span>
    </section>
  );
}
