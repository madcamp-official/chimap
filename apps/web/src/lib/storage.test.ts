import { describe, expect, it } from "vitest";

import {
  clearPreferences,
  LAST_TRIP_STORAGE_KEY,
  loadLastTrip,
  loadPreferences,
  PREFERENCES_STORAGE_KEY,
  saveLastTrip,
  savePreferences,
} from "./storage.js";

describe("버전형 localStorage", () => {
  it("정상 설정과 마지막 선택 요약을 저장하고 복원한다", () => {
    expect(
      savePreferences({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: {
          birthYear: 2000,
          heightCm: 170,
          weightKg: 65,
          biologicalSex: "FEMALE",
        },
        currentSteps: 5200,
        currentStepsDate: "2026-07-26",
      }),
    ).toBe(true);
    expect(loadPreferences()).toMatchObject({
      version: 3,
      dailyGoalSteps: 8000,
      currentSteps: 5200,
    });

    expect(
      saveLastTrip({
        version: 1,
        selectedAt: "2026-07-24T08:00:00.000Z",
        originName: "KAIST",
        destinationName: "대전역",
        routeType: "BALANCED",
        expectedSteps: 2200,
        expectedArrivalAt: "2026-07-24T08:50:00.000Z",
      }),
    ).toBe(true);
    expect(loadLastTrip()?.routeType).toBe("BALANCED");
  });

  it("손상된 JSON과 알 수 없는 버전에서 앱 기본값 복구를 허용한다", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, "{broken");
    localStorage.setItem(
      LAST_TRIP_STORAGE_KEY,
      JSON.stringify({ version: 99 }),
    );
    expect(loadPreferences()).toBeUndefined();
    expect(loadLastTrip()).toBeUndefined();
  });

  it("정확한 전체 경로 좌표를 마지막 선택에 저장하지 않는다", () => {
    saveLastTrip({
      version: 1,
      selectedAt: "2026-07-24T08:00:00.000Z",
      originName: "KAIST",
      destinationName: "대전역",
      routeType: "FAST",
      expectedSteps: 614,
      expectedArrivalAt: "2026-07-24T08:40:00.000Z",
    });
    expect(localStorage.getItem(LAST_TRIP_STORAGE_KEY)).not.toContain(
      "coordinates",
    );
  });

  it("저장 정보 삭제 시 현재 설정과 과거 마지막 선택을 함께 지운다", () => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ version: 3 }));
    localStorage.setItem(LAST_TRIP_STORAGE_KEY, JSON.stringify({ version: 1 }));

    expect(clearPreferences()).toBe(true);
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(LAST_TRIP_STORAGE_KEY)).toBeNull();
  });
});
