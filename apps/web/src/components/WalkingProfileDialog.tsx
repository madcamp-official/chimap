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
  onSave: (profile: WalkingProfile) => void;
  onCancel?: () => void;
  onClear?: () => void;
};

export function WalkingProfileDialog({
  initialProfile,
  onSave,
  onCancel,
  onClear,
}: WalkingProfileDialogProps) {
  const currentYear = new Date().getFullYear();
  const [birthYear, setBirthYear] = useState(
    initialProfile?.birthYear ?? currentYear - 25,
  );
  const [heightCm, setHeightCm] = useState(initialProfile?.heightCm ?? 170);
  const [weightKg, setWeightKg] = useState(initialProfile?.weightKg ?? 65);
  const [biologicalSex, setBiologicalSex] = useState<
    BiologicalSex | undefined
  >(initialProfile?.biologicalSex);
  const profile = useMemo(() => {
    const parsed = walkingProfileSchema.safeParse({
      birthYear,
      heightCm,
      weightKg,
      biologicalSex,
    });
    if (!parsed.success) {
      return undefined;
    }
    const age = currentYear - parsed.data.birthYear;
    return age >= 18 && age <= 90 ? parsed.data : undefined;
  }, [biologicalSex, birthYear, currentYear, heightCm, weightKg]);
  const stepLengthMeters =
    profile === undefined
      ? undefined
      : estimatePersonalizedStepLengthMeters(profile, currentYear);
  const bodyMassIndex =
    heightCm > 0 ? weightKg / (heightCm / 100) ** 2 : undefined;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (profile !== undefined) {
      onSave(profile);
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
            <h2 id="walking-profile-title">내 한 걸음 길이 계산</h2>
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
          건강 경로의 도보거리와 예상 걸음 수를 맞추기 위해 신체정보로 한
          걸음 길이를 추정합니다.
        </p>

        <form onSubmit={submit}>
          <div className="profile-form-grid">
            <div className="field">
              <label htmlFor="profile-birth-year">출생연도</label>
              <div className="number-field">
                <input
                  id="profile-birth-year"
                  type="number"
                  inputMode="numeric"
                  min={currentYear - 90}
                  max={currentYear - 18}
                  required
                  value={birthYear}
                  onChange={(event) =>
                    setBirthYear(Number(event.target.value))
                  }
                />
                <span>년</span>
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
            입력값은 이 브라우저에만 저장되며 서버나 데이터베이스에는
            전송되지 않습니다.
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
              disabled={profile === undefined}
            >
              이 값으로 시작
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
