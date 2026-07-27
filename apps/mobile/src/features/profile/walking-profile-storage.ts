import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  walkingProfileSchema,
  type WalkingProfile,
} from "@chimap/contracts";

export type SavedWalkingProfile = {
  version: 1;
  walkingProfile: WalkingProfile;
  dailyGoalSteps: number;
  savedAt: string;
};

function parsedSavedProfile(value: unknown): SavedWalkingProfile | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Partial<SavedWalkingProfile>;
  const profile = walkingProfileSchema.safeParse(candidate.walkingProfile);
  if (
    candidate.version !== 1 ||
    !profile.success ||
    !Number.isInteger(candidate.dailyGoalSteps) ||
    candidate.dailyGoalSteps === undefined ||
    candidate.dailyGoalSteps < 1 ||
    candidate.dailyGoalSteps > 100_000 ||
    typeof candidate.savedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.savedAt))
  ) {
    return null;
  }
  return {
    version: 1,
    walkingProfile: profile.data,
    dailyGoalSteps: candidate.dailyGoalSteps,
    savedAt: candidate.savedAt,
  };
}

export async function readWalkingProfile(
  storageKey: string,
): Promise<SavedWalkingProfile | null> {
  const stored = await AsyncStorage.getItem(storageKey);
  if (stored === null) {
    return null;
  }
  try {
    const parsed = parsedSavedProfile(JSON.parse(stored) as unknown);
    if (parsed !== null) {
      return parsed;
    }
  } catch {
    // 손상된 값은 아래에서 제거하고 최초 설정 화면으로 복구한다.
  }
  await AsyncStorage.removeItem(storageKey);
  return null;
}

export async function writeWalkingProfile(
  storageKey: string,
  walkingProfile: WalkingProfile,
  dailyGoalSteps: number,
): Promise<SavedWalkingProfile> {
  const profile = walkingProfileSchema.parse(walkingProfile);
  if (
    !Number.isInteger(dailyGoalSteps) ||
    dailyGoalSteps < 1 ||
    dailyGoalSteps > 100_000
  ) {
    throw new Error("하루 목표 걸음이 올바르지 않습니다.");
  }
  const value: SavedWalkingProfile = {
    version: 1,
    walkingProfile: profile,
    dailyGoalSteps,
    savedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(storageKey, JSON.stringify(value));
  return value;
}

export async function removeWalkingProfile(storageKey: string): Promise<void> {
  await AsyncStorage.removeItem(storageKey);
}
