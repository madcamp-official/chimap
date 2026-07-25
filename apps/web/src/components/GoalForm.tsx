import { estimatePersonalizedStepLengthMeters } from "@chimap/contracts";
import {
  ChevronDown,
  Footprints,
  Pencil,
  Sparkles,
} from "lucide-react";
import { type FormEvent, useMemo } from "react";

import { defaultDeadline, toKstDateTimeLocal } from "../lib/time.js";
import { useTripStore } from "../store/trip-store.js";

type GoalFormProps = {
  canSubmit: boolean;
  isSubmitting: boolean;
  errorMessage?: string;
  onSubmit: () => void;
  onEditWalkingProfile: () => void;
};

export function GoalForm({
  canSubmit,
  isSubmitting,
  errorMessage,
  onSubmit,
  onEditWalkingProfile,
}: GoalFormProps) {
  const {
    currentSteps,
    goalSteps,
    deadlineLocal,
    maxExtraMinutes,
    walkingProfile,
    safetyBufferMinutes,
    setCurrentSteps,
    setGoalSteps,
    setDeadlineLocal,
    setMaxExtraMinutes,
    setSafetyBufferMinutes,
  } = useTripStore();
  const stepLengthMeters =
    walkingProfile === undefined
      ? 0
      : estimatePersonalizedStepLengthMeters(walkingProfile);
  const remainingSteps = Math.max(goalSteps - currentSteps, 0);
  const targetDistance = remainingSteps * stepLengthMeters;
  const deadlineBounds = useMemo(() => {
    const now = new Date();
    return {
      min: toKstDateTimeLocal(new Date(now.getTime() + 60_000)),
      max: toKstDateTimeLocal(
        new Date(now.getTime() + 6 * 60 * 60 * 1000),
      ),
    };
  }, []);

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (canSubmit && !isSubmitting) {
      onSubmit();
    }
  }

  return (
    <form className="goal-form" onSubmit={submit} aria-busy={isSubmitting}>
      <div className="section-heading">
        <div>
          <span className="eyebrow">오늘의 이동 목표</span>
          <h2>얼마나 더 걸어볼까요?</h2>
        </div>
        <Footprints aria-hidden="true" />
      </div>

      <div
        className={`step-summary ${remainingSteps === 0 ? "is-complete" : ""}`}
        aria-live="polite"
      >
        {remainingSteps === 0 ? (
          <>
            <Sparkles aria-hidden="true" />
            <span>
              <strong>오늘 목표를 이미 달성했어요!</strong>
              가장 빠른 경로를 우선 추천할게요.
            </span>
          </>
        ) : (
          <>
            <Footprints aria-hidden="true" />
            <span>
              <strong>{remainingSteps.toLocaleString("ko-KR")}걸음</strong>이
              남았어요 · 보폭 기준 약{" "}
              {targetDistance >= 1000
                ? `${(targetDistance / 1000).toFixed(1)}km`
                : `${Math.round(targetDistance)}m`}
            </span>
          </>
        )}
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="current-steps">현재 걸음 수</label>
          <div className="number-field">
            <input
              id="current-steps"
              name="currentSteps"
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              required
              value={currentSteps}
              onChange={(event) => setCurrentSteps(Number(event.target.value))}
            />
            <span>걸음</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="goal-steps">하루 목표</label>
          <div className="number-field">
            <input
              id="goal-steps"
              name="goalSteps"
              type="number"
              inputMode="numeric"
              min={1}
              max={100000}
              required
              value={goalSteps}
              onChange={(event) => setGoalSteps(Number(event.target.value))}
            />
            <span>걸음</span>
          </div>
        </div>
      </div>

      <div className="field">
        <label htmlFor="deadline">도착 마감시간 · 한국 시간</label>
        <input
          id="deadline"
          name="deadline"
          type="datetime-local"
          required
          min={deadlineBounds.min}
          max={deadlineBounds.max}
          value={deadlineLocal}
          onChange={(event) =>
            setDeadlineLocal(event.target.value || defaultDeadline())
          }
        />
        <small>실제 교통 상황이 아닌 지금 출발 경로 기준 예상입니다.</small>
      </div>

      <div className="field">
        <div className="label-row">
          <label htmlFor="extra-minutes">최대 추가 허용시간</label>
          <output htmlFor="extra-minutes">
            {maxExtraMinutes === 0 ? "추가 없음" : `${maxExtraMinutes}분`}
          </output>
        </div>
        <div className="range-with-input">
          <input
            id="extra-minutes-range"
            aria-label="최대 추가 허용시간 슬라이더"
            type="range"
            min={0}
            max={120}
            step={5}
            value={maxExtraMinutes}
            onChange={(event) =>
              setMaxExtraMinutes(Number(event.target.value))
            }
          />
          <input
            id="extra-minutes"
            name="maxExtraMinutes"
            aria-label="최대 추가 허용시간 숫자"
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            required
            value={maxExtraMinutes}
            onChange={(event) =>
              setMaxExtraMinutes(Number(event.target.value))
            }
          />
        </div>
      </div>

      <div className="walking-profile-summary">
        <div>
          <span>개인화 한 걸음 길이</span>
          <strong>
            {walkingProfile === undefined
              ? "프로필 필요"
              : `${Math.round(stepLengthMeters * 100)}cm`}
          </strong>
          <small>신장·체중·나이·생물학적 성별 기반 연구 추정값</small>
        </div>
        <button
          type="button"
          className="profile-edit-button"
          onClick={onEditWalkingProfile}
        >
          <Pencil aria-hidden="true" size={16} />
          수정
        </button>
      </div>

      <details className="advanced-settings">
        <summary>
          고급 설정
          <ChevronDown aria-hidden="true" size={18} />
        </summary>
        <div className="field">
          <label htmlFor="safety-buffer">안전 여유시간</label>
          <div className="number-field">
            <input
              id="safety-buffer"
              name="safetyBufferMinutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={15}
              required
              value={safetyBufferMinutes}
              onChange={(event) =>
                setSafetyBufferMinutes(Number(event.target.value))
              }
            />
            <span>분</span>
          </div>
          <small>예상 도착이 마감보다 이만큼 빠른 경로만 골라요.</small>
        </div>
      </details>

      {errorMessage !== undefined ? (
        <div className="form-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <button
        className="primary-button"
        type="submit"
        disabled={!canSubmit || isSubmitting}
      >
        {isSubmitting ? "건강 경로 계산 중…" : "건강 경로 찾기"}
      </button>
    </form>
  );
}
