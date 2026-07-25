import { BusFront, Footprints, Route, Scale } from "lucide-react";
import { useEffect, useState } from "react";

const STEPS = [
  {
    label: "입력 조건을 확인하고 있어요",
    icon: Route,
  },
  {
    label: "가장 빠른 기본 경로를 찾고 있어요",
    icon: BusFront,
  },
  {
    label: "조금 더 걸을 수 있는 하차 지점을 살펴보고 있어요",
    icon: Footprints,
  },
  {
    label: "시간과 걸음 수를 비교하고 있어요",
    icon: Scale,
  },
] as const;

export function RecommendationProgress() {
  const [step, setStep] = useState(0);
  const [waitingLonger, setWaitingLonger] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    }, 1200);
    const longerTimer = window.setTimeout(() => setWaitingLonger(true), 8000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(longerTimer);
    };
  }, []);

  const current = STEPS[step]!;
  const Icon = current.icon;
  return (
    <section className="recommendation-progress" aria-live="polite">
      <div className="progress-icon">
        <Icon aria-hidden="true" />
      </div>
      <span className="eyebrow">건강 경로 계산 중</span>
      <h2>{current.label}</h2>
      <div className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <p>
        {waitingLonger
          ? "실제 버스 운행 응답이 늦어 조금 더 확인하고 있어요. 새 검색을 시작하면 이 요청은 취소됩니다."
          : "보통 몇 초 안에 끝나요. 새 검색을 시작하면 이 요청은 취소됩니다."}
      </p>
    </section>
  );
}
