import type { ExperienceMode } from "@chimap/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_UI_EXPERIENCE,
  deriveExperienceMode,
  loadUiExperience,
  resetUiLearning,
  saveUiExperience,
  type UiExperienceStateV1,
} from "../lib/ui-experience.js";

type UiExperienceContextValue = {
  state: UiExperienceStateV1;
  mode: ExperienceMode;
  reducedMotion: boolean;
  compactTransitionVisible: boolean;
  setDensityPreference: (
    value: UiExperienceStateV1["densityPreference"],
  ) => void;
  setMotionPreference: (
    value: UiExperienceStateV1["motionPreference"],
  ) => void;
  setTelemetryConsent: (
    value: UiExperienceStateV1["telemetryConsent"],
  ) => void;
  registerRecommendationSuccess: () => void;
  dismissCompactTransition: () => void;
  restoreGuidedMode: () => void;
  resetLearning: () => void;
};

const UiExperienceContext = createContext<
  UiExperienceContextValue | undefined
>(undefined);

function systemPrefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function UiExperienceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [state, setState] = useState(loadUiExperience);
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    systemPrefersReducedMotion,
  );
  const [compactTransitionVisible, setCompactTransitionVisible] =
    useState(false);
  const previousMode = useRef<ExperienceMode>(deriveExperienceMode(state));

  useEffect(() => {
    saveUiExperience(state);
  }, [state]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (event: MediaQueryListEvent): void => {
      setSystemReducedMotion(event.matches);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const reducedMotion =
    state.motionPreference === "reduced" || systemReducedMotion;
  const mode = deriveExperienceMode(state);

  useEffect(() => {
    if (
      previousMode.current === "guided" &&
      mode === "compact" &&
      state.densityPreference === "auto"
    ) {
      setCompactTransitionVisible(true);
    }
    previousMode.current = mode;
  }, [mode, state.densityPreference]);

  useEffect(() => {
    document.documentElement.dataset.chimapReducedMotion = reducedMotion
      ? "true"
      : "false";
    return () => {
      delete document.documentElement.dataset.chimapReducedMotion;
    };
  }, [reducedMotion]);

  const setDensityPreference = useCallback(
    (densityPreference: UiExperienceStateV1["densityPreference"]) => {
      setState((current) => ({ ...current, densityPreference }));
      setCompactTransitionVisible(false);
    },
    [],
  );
  const setMotionPreference = useCallback(
    (motionPreference: UiExperienceStateV1["motionPreference"]) => {
      setState((current) => ({ ...current, motionPreference }));
    },
    [],
  );
  const setTelemetryConsent = useCallback(
    (telemetryConsent: UiExperienceStateV1["telemetryConsent"]) => {
      setState((current) => ({ ...current, telemetryConsent }));
    },
    [],
  );
  const registerRecommendationSuccess = useCallback(() => {
    setState((current) => ({
      ...current,
      successfulRecommendationCount:
        current.successfulRecommendationCount + 1,
    }));
  }, []);
  const restoreGuidedMode = useCallback(() => {
    setState((current) => ({ ...current, densityPreference: "guided" }));
    setCompactTransitionVisible(false);
  }, []);
  const resetLearning = useCallback(() => {
    setState((current) => resetUiLearning(current));
    setCompactTransitionVisible(false);
  }, []);

  const value = useMemo<UiExperienceContextValue>(() => {
    return {
      state,
      mode,
      reducedMotion,
      compactTransitionVisible,
      setDensityPreference,
      setMotionPreference,
      setTelemetryConsent,
      registerRecommendationSuccess,
      dismissCompactTransition: () => setCompactTransitionVisible(false),
      restoreGuidedMode,
      resetLearning,
    };
  }, [
    compactTransitionVisible,
    mode,
    registerRecommendationSuccess,
    resetLearning,
    restoreGuidedMode,
    setDensityPreference,
    setMotionPreference,
    setTelemetryConsent,
    state,
    systemReducedMotion,
    reducedMotion,
  ]);

  return (
    <UiExperienceContext.Provider value={value}>
      {children}
    </UiExperienceContext.Provider>
  );
}

export function useUiExperience(): UiExperienceContextValue {
  const value = useContext(UiExperienceContext);
  if (value === undefined) {
    return {
      state: DEFAULT_UI_EXPERIENCE,
      mode: "guided",
      reducedMotion: systemPrefersReducedMotion(),
      compactTransitionVisible: false,
      setDensityPreference: () => undefined,
      setMotionPreference: () => undefined,
      setTelemetryConsent: () => undefined,
      registerRecommendationSuccess: () => undefined,
      dismissCompactTransition: () => undefined,
      restoreGuidedMode: () => undefined,
      resetLearning: () => undefined,
    };
  }
  return value;
}
