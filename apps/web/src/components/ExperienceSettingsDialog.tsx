import { RotateCcw, Settings2, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ExperienceMode } from "@chimap/contracts";

import { useUiExperience } from "./UiExperienceProvider.js";

export function ExperienceSettingsDialog({
  open,
  onClose,
  onModeChanged,
}: {
  open: boolean;
  onClose: () => void;
  onModeChanged: (mode: ExperienceMode) => void;
}) {
  const {
    state,
    mode,
    reducedMotion,
    setDensityPreference,
    setMotionPreference,
    setTelemetryConsent,
    resetLearning,
  } = useUiExperience();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="experience-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="settings-heading">
          <span className="settings-heading-icon">
            <Settings2 aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">화면 사용 설정</span>
            <h2 id="experience-settings-title">내게 편한 방식으로</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="settings-close"
            aria-label="설정 닫기"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <fieldset className="settings-group">
          <legend>안내 밀도</legend>
          <p>주요 기능의 위치는 바뀌지 않고 보조 설명만 조절돼요.</p>
          <div className="segmented-options">
            {(
              [
                ["auto", "자동", "3회 사용 후 간결하게"],
                ["guided", "자세히", "도움말 계속 표시"],
                ["compact", "간결하게", "핵심 정보만 표시"],
              ] as const
            ).map(([value, label, description]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="density-preference"
                  value={value}
                  checked={state.densityPreference === value}
                  onChange={() => {
                    setDensityPreference(value);
                    onModeChanged(
                      value === "auto"
                        ? state.successfulRecommendationCount >= 3
                          ? "compact"
                          : "guided"
                        : value,
                    );
                  }}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </div>
          <small className="settings-current-mode">
            현재 화면: {mode === "guided" ? "자세한 안내" : "간결한 안내"}
          </small>
        </fieldset>

        <fieldset className="settings-group">
          <legend>화면 움직임</legend>
          <div className="simple-options">
            <label>
              <input
                type="radio"
                name="motion-preference"
                checked={state.motionPreference === "system"}
                onChange={() => setMotionPreference("system")}
              />
              시스템 설정 따르기
            </label>
            <label>
              <input
                type="radio"
                name="motion-preference"
                checked={state.motionPreference === "reduced"}
                onChange={() => setMotionPreference("reduced")}
              />
              동작 줄이기
            </label>
          </div>
          <small>
            현재 {reducedMotion ? "움직임을 줄여서" : "부드러운 전환으로"} 표시
            중이에요.
          </small>
        </fieldset>

        <fieldset className="settings-group">
          <legend>익명 사용성 정보</legend>
          <p>
            검색어나 위치 없이 화면 상태와 성공·실패 구간만 집계합니다. 언제든
            철회할 수 있어요.
          </p>
          <div className="simple-options">
            <label>
              <input
                type="radio"
                name="telemetry-consent"
                checked={state.telemetryConsent === "granted"}
                onChange={() => setTelemetryConsent("granted")}
              />
              공유 허용
            </label>
            <label>
              <input
                type="radio"
                name="telemetry-consent"
                checked={state.telemetryConsent === "denied"}
                onChange={() => setTelemetryConsent("denied")}
              />
              공유하지 않음
            </label>
          </div>
          <span className="privacy-boundary">
            <ShieldCheck aria-hidden="true" />
            검색어·좌표·장소/노선 ID·신체정보·사용자 식별자는 보내지 않아요.
          </span>
        </fieldset>

        <button
          type="button"
          className="reset-experience-button"
          onClick={resetLearning}
        >
          <RotateCcw aria-hidden="true" />
          안내 학습 상태 초기화
        </button>
      </section>
    </div>
  );
}
