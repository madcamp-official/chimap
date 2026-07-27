import {
  estimatePersonalizedStepLengthMeters,
  type WalkingProfile,
} from "@chimap/contracts";
import { Pencil } from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";

type HeaderStepSummaryProps = {
  currentSteps: number;
  goalSteps: number;
  walkingProfile?: WalkingProfile;
  onCurrentStepsChange: (value: number) => void;
  onEditProfile: () => void;
};

export function HeaderStepSummary({
  currentSteps,
  goalSteps,
  walkingProfile,
  onCurrentStepsChange,
  onEditProfile,
}: HeaderStepSummaryProps) {
  const [draft, setDraft] = useState(String(currentSteps));
  const [error, setError] = useState<string>();

  useEffect(() => setDraft(String(currentSteps)), [currentSteps]);

  function commit(): void {
    const value = Number(draft);
    if (
      draft.trim() === "" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100_000
    ) {
      setDraft(String(currentSteps));
      setError("현재 걸음은 0~100,000 사이의 정수로 입력해 주세요.");
      return;
    }
    setError(undefined);
    onCurrentStepsChange(value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      setDraft(String(currentSteps));
      setError(undefined);
      event.currentTarget.blur();
    }
  }

  const stepLengthCentimeters =
    walkingProfile === undefined
      ? undefined
      : Math.round(estimatePersonalizedStepLengthMeters(walkingProfile) * 100);

  return (
    <div className="header-step-summary" aria-label="오늘의 걸음 요약">
      <label className="header-step-metric header-current-steps">
        <span>현재 걸음</span>
        <span className="header-step-value">
          <input
            aria-label="현재 걸음"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            aria-invalid={error !== undefined}
            aria-describedby="current-steps-error"
          />
          <i>걸음</i>
        </span>
      </label>
      <div className="header-step-metric">
        <span>목표 걸음</span>
        <strong>{goalSteps.toLocaleString("ko-KR")}걸음</strong>
      </div>
      <button
        type="button"
        className="header-step-metric header-profile-edit"
        onClick={onEditProfile}
        aria-label="개인화 걸음 설정 수정"
      >
        <span>개인화 한 걸음</span>
        <strong>
          {stepLengthCentimeters === undefined
            ? "설정 필요"
            : `${stepLengthCentimeters}cm`}
          <Pencil aria-hidden="true" />
        </strong>
      </button>
      <span
        id="current-steps-error"
        className="header-step-error"
        aria-live="polite"
      >
        {error}
      </span>
    </div>
  );
}
