import { beforeEach, describe, expect, it, vi } from "vitest";

import { PREFERENCES_STORAGE_KEY } from "../lib/storage.js";
import { kstDateKey } from "../lib/time.js";

const profile = {
  birthYear: 2000,
  heightCm: 170,
  weightKg: 65,
  biologicalSex: "FEMALE",
} as const;

describe("걸음 상태 저장 마이그레이션", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("version 3의 한국 날짜가 오늘이면 현재 걸음을 복원한다", async () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        dailyGoalSteps: 9000,
        walkingProfile: profile,
        currentSteps: 4321,
        currentStepsDate: kstDateKey(),
      }),
    );

    const { useTripStore } = await import("./trip-store.js");
    expect(useTripStore.getState()).toMatchObject({
      currentSteps: 4321,
      goalSteps: 9000,
      walkingProfile: profile,
    });
  });

  it("한국 날짜가 지난 version 3의 현재 걸음은 0으로 초기화한다", async () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        dailyGoalSteps: 8000,
        walkingProfile: profile,
        currentSteps: 9999,
        currentStepsDate: "2000-01-01",
      }),
    );

    const { useTripStore } = await import("./trip-store.js");
    expect(useTripStore.getState().currentSteps).toBe(0);
  });

  it("version 2는 프로필과 목표를 이전하고 현재 걸음은 0으로 시작한다", async () => {
    localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        dailyGoalSteps: 7000,
        walkingProfile: profile,
        maxExtraMinutes: 20,
        safetyBufferMinutes: 3,
      }),
    );

    const { useTripStore } = await import("./trip-store.js");
    expect(useTripStore.getState()).toMatchObject({
      currentSteps: 0,
      goalSteps: 7000,
      walkingProfile: profile,
    });
  });
});
