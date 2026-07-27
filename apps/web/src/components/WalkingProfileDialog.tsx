import {
  estimatePersonalizedStepLengthMeters,
  walkingProfileSchema,
  type BiologicalSex,
  type WalkingProfile,
} from "@chimap/contracts";
import { Footprints, ShieldCheck, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

type WalkingProfileDialogProps = {
  initialProfile?: WalkingProfile;
  initialDailyGoalSteps?: number;
  onSave: (profile: WalkingProfile, dailyGoalSteps: number) => void;
  onCancel?: () => void;
  onClear?: () => void;
};

export function WalkingProfileDialog({
  initialProfile,
  initialDailyGoalSteps = 8000,
  onSave,
  onCancel,
  onClear,
}: WalkingProfileDialogProps) {
  const currentYear = new Date().getFullYear();
  const [age, setAge] = useState(
    initialProfile === undefined ? 25 : currentYear - initialProfile.birthYear,
  );
  const [heightCm, setHeightCm] = useState(initialProfile?.heightCm ?? 170);
  const [weightKg, setWeightKg] = useState(initialProfile?.weightKg ?? 65);
  const [biologicalSex, setBiologicalSex] = useState<
    BiologicalSex | undefined
  >(initialProfile?.biologicalSex);
  const [dailyGoalSteps, setDailyGoalSteps] = useState(
    initialDailyGoalSteps,
  );
  const profile = useMemo(() => {
    const parsed = walkingProfileSchema.safeParse({
      birthYear: currentYear - age,
      heightCm,
      weightKg,
      biologicalSex,
    });
    if (!parsed.success) {
      return undefined;
    }
    return age >= 18 && age <= 90 ? parsed.data : undefined;
  }, [age, biologicalSex, currentYear, heightCm, weightKg]);
  const dailyGoalValid =
    Number.isInteger(dailyGoalSteps) &&
    dailyGoalSteps >= 1 &&
    dailyGoalSteps <= 100_000;
  const stepLengthMeters =
    profile === undefined
      ? undefined
      : estimatePersonalizedStepLengthMeters(profile, currentYear);
  const bodyMassIndex =
    heightCm > 0 ? weightKg / (heightCm / 100) ** 2 : undefined;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (profile !== undefined && dailyGoalValid) {
      onSave(profile, dailyGoalSteps);
    }
  }

  return (
    <div className="profile-dialog-backdrop">
      <section
        className="profile-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="walking-profile-title"
      >
        <div className="profile-dialog-heading">
          <div className="profile-dialog-icon">
            <Footprints aria-hidden="true" />
          </div>
          <div>
            <span className="eyebrow">개인화 걸음 설정</span>
            <h2 id="walking-profile-title">내 건강 경로 설정</h2>
          </div>
          {onCancel === undefined ? null : (
            <button
              type="button"
              className="profile-dialog-close"
              onClick={onCancel}
              aria-label="개인화 걸음 설정 닫기"
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="profile-dialog-description">
          신체정보로 한 걸음 길이를 추정하고 하루 목표에 맞는 경로를 자동으로
          추천합니다.
        </p>

        <form onSubmit={submit}>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="profile-age">만 나이</label>
              <div className="number-field">
                <input
                  id="profile-age"
                  type="number"
                  inputMode="numeric"
                  min={18}
                  max={90}
                  required
                  value={age}
                  onChange={(event) =>
                    setAge(Number(event.target.value))
                  }
                />
                <span>세</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="profile-height">신장</label>
              <div className="number-field">
                <input
                  id="profile-height"
                  type="number"
                  inputMode="decimal"
                  min={120}
                  max={220}
                  step={0.1}
                  required
                  value={heightCm}
                  onChange={(event) =>
                    setHeightCm(Number(event.target.value))
                  }
                />
                <span>cm</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="profile-daily-goal">하루 목표 걸음</label>
              <div className="number-field">
                <input
                  id="profile-daily-goal"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100000}
                  required
                  value={dailyGoalSteps}
                  onChange={(event) =>
                    setDailyGoalSteps(Number(event.target.value))
                  }
                />
                <span>걸음</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="profile-weight">체중</label>
              <div className="number-field">
                <input
                  id="profile-weight"
                  type="number"
                  inputMode="decimal"
                  min={30}
                  max={200}
                  step={0.1}
                  required
                  value={weightKg}
                  onChange={(event) =>
                    setWeightKg(Number(event.target.value))
                  }
                />
                <span>kg</span>
              </div>
            </div>
          </div>

          <fieldset className="biological-sex-field">
            <legend>생물학적 성별</legend>
            <label>
              <input
                type="radio"
                name="biologicalSex"
                value="MALE"
                required
                checked={biologicalSex === "MALE"}
                onChange={() => setBiologicalSex("MALE")}
              />
              남성
            </label>
            <label>
              <input
                type="radio"
                name="biologicalSex"
                value="FEMALE"
                required
                checked={biologicalSex === "FEMALE"}
                onChange={() => setBiologicalSex("FEMALE")}
              />
              여성
            </label>
          </fieldset>

          <div className="profile-estimate" aria-live="polite">
            <span>연구 기반 예상 한 걸음 길이</span>
            <strong>
              {stepLengthMeters === undefined
                ? "입력값을 확인해 주세요"
                : `${(stepLengthMeters * 100).toFixed(1)}cm`}
            </strong>
            <small>
              실제 보폭은 걷는 속도, 지형, 신발과 건강 상태에 따라 달라질 수
              있습니다.
            </small>
          </div>

          {bodyMassIndex !== undefined && bodyMassIndex >= 30 ? (
            <p className="profile-scope-warning">
              적용 연구는 BMI 30 미만의 건강한 성인을 대상으로 했으므로 현재
              추정값의 오차가 더 클 수 있습니다.
            </p>
          ) : null}

          <p className="profile-privacy-note">
            <ShieldCheck aria-hidden="true" />
            신체정보는 이 브라우저에만 저장되며 서버에는 계산된 한 걸음
            길이와 현재·목표 걸음만 전송됩니다.
          </p>

          <div className="profile-dialog-actions">
            {onClear === undefined ? null : (
              <button
                type="button"
                className="profile-clear-button"
                onClick={onClear}
              >
                저장 정보 삭제
              </button>
            )}
            <button
              type="submit"
              className="primary-button"
              disabled={profile === undefined || !dailyGoalValid}
            >
              이 값으로 시작
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
