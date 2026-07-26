import type { ExperienceMode } from "@chimap/contracts";
import { z } from "zod";

export const UI_EXPERIENCE_STORAGE_KEY = "chimap:ui-experience-v1";

const uiExperienceStateSchema = z
  .object({
    version: z.literal(1),
    successfulRecommendationCount: z.number().int().nonnegative(),
    densityPreference: z.enum(["auto", "guided", "compact"]),
    motionPreference: z.enum(["system", "reduced"]),
    telemetryConsent: z.enum(["unknown", "granted", "denied"]),
  })
  .strict();

export type UiExperienceStateV1 = z.infer<typeof uiExperienceStateSchema>;

export const DEFAULT_UI_EXPERIENCE: UiExperienceStateV1 = {
  version: 1,
  successfulRecommendationCount: 0,
  densityPreference: "auto",
  motionPreference: "system",
  telemetryConsent: "unknown",
};

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadUiExperience(
  storage = browserStorage(),
): UiExperienceStateV1 {
  if (storage === undefined) {
    return DEFAULT_UI_EXPERIENCE;
  }
  try {
    const raw = storage.getItem(UI_EXPERIENCE_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_UI_EXPERIENCE;
    }
    const parsed = uiExperienceStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_UI_EXPERIENCE;
  } catch {
    return DEFAULT_UI_EXPERIENCE;
  }
}

export function saveUiExperience(
  state: UiExperienceStateV1,
  storage = browserStorage(),
): boolean {
  const parsed = uiExperienceStateSchema.safeParse(state);
  if (!parsed.success || storage === undefined) {
    return false;
  }
  try {
    storage.setItem(UI_EXPERIENCE_STORAGE_KEY, JSON.stringify(parsed.data));
    return true;
  } catch {
    return false;
  }
}

export function deriveExperienceMode(
  state: UiExperienceStateV1,
): ExperienceMode {
  if (state.densityPreference !== "auto") {
    return state.densityPreference;
  }
  return state.successfulRecommendationCount >= 3 ? "compact" : "guided";
}

export function resetUiLearning(
  state: UiExperienceStateV1,
): UiExperienceStateV1 {
  return {
    ...DEFAULT_UI_EXPERIENCE,
    telemetryConsent: state.telemetryConsent,
  };
}
