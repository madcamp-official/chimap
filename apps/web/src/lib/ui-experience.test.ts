import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI_EXPERIENCE,
  deriveExperienceMode,
  loadUiExperience,
  resetUiLearning,
  saveUiExperience,
  UI_EXPERIENCE_STORAGE_KEY,
} from "./ui-experience.js";

describe("로컬 UI 숙련도 상태", () => {
  it("추천 성공 3회부터 자동 모드의 보조 설명만 간결해진다", () => {
    expect(deriveExperienceMode(DEFAULT_UI_EXPERIENCE)).toBe("guided");
    expect(
      deriveExperienceMode({
        ...DEFAULT_UI_EXPERIENCE,
        successfulRecommendationCount: 3,
      }),
    ).toBe("compact");
    expect(
      deriveExperienceMode({
        ...DEFAULT_UI_EXPERIENCE,
        successfulRecommendationCount: 9,
        densityPreference: "guided",
      }),
    ).toBe("guided");
  });

  it("버전형 상태를 복원하고 손상된 값은 안전한 기본값으로 되돌린다", () => {
    expect(
      saveUiExperience({
        ...DEFAULT_UI_EXPERIENCE,
        successfulRecommendationCount: 2,
        telemetryConsent: "denied",
      }),
    ).toBe(true);
    expect(loadUiExperience()).toMatchObject({
      successfulRecommendationCount: 2,
      telemetryConsent: "denied",
    });

    localStorage.setItem(UI_EXPERIENCE_STORAGE_KEY, "{broken");
    expect(loadUiExperience()).toEqual(DEFAULT_UI_EXPERIENCE);
  });

  it("학습 상태 초기화 시 사용성 정보 동의 선택은 유지한다", () => {
    expect(
      resetUiLearning({
        ...DEFAULT_UI_EXPERIENCE,
        successfulRecommendationCount: 8,
        densityPreference: "compact",
        motionPreference: "reduced",
        telemetryConsent: "granted",
      }),
    ).toEqual({
      ...DEFAULT_UI_EXPERIENCE,
      telemetryConsent: "granted",
    });
  });
});
