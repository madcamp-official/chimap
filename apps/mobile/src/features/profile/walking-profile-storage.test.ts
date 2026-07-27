import type { WalkingProfile } from "@chimap/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const asyncStorage = vi.hoisted(() => ({
  values: new Map<string, string>(),
  removeItem: vi.fn(async (key: string) => {
    asyncStorage.values.delete(key);
  }),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.values.set(key, value);
    },
    removeItem: asyncStorage.removeItem,
  },
}));

import {
  readWalkingProfile,
  writeWalkingProfile,
} from "./walking-profile-storage";

const profile: WalkingProfile = {
  birthYear: 1998,
  heightCm: 170,
  weightKg: 65,
  biologicalSex: "FEMALE",
};

beforeEach(() => {
  asyncStorage.values.clear();
  vi.clearAllMocks();
});

describe("walking profile storage", () => {
  it("최초 설정을 사용자별 key에 저장하고 다음 실행에서 복원한다", async () => {
    const key = "chimap:staging:ios:user-a:walking-profile:v1";

    await writeWalkingProfile(key, profile, 8000);

    await expect(readWalkingProfile(key)).resolves.toMatchObject({
      version: 1,
      walkingProfile: profile,
      dailyGoalSteps: 8000,
    });
    await expect(
      readWalkingProfile("chimap:staging:ios:user-b:walking-profile:v1"),
    ).resolves.toBeNull();
  });

  it("손상되거나 범위를 벗어난 값은 제거하고 최초 설정으로 복구한다", async () => {
    const key = "chimap:staging:ios:user-a:walking-profile:v1";
    asyncStorage.values.set(
      key,
      JSON.stringify({
        version: 1,
        walkingProfile: profile,
        dailyGoalSteps: -1,
        savedAt: new Date().toISOString(),
      }),
    );

    await expect(readWalkingProfile(key)).resolves.toBeNull();
    expect(asyncStorage.removeItem).toHaveBeenCalledWith(key);
  });
});
