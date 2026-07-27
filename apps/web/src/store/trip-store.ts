import type { Place, WalkingProfile } from "@chimap/contracts";
import { create } from "zustand";

import { loadPreferences } from "../lib/storage.js";
import { kstDateKey } from "../lib/time.js";

type TripState = {
  origin: Place | undefined;
  destination: Place | undefined;
  currentSteps: number;
  goalSteps: number;
  walkingProfile: WalkingProfile | undefined;
  selectedRouteId: string | undefined;
  setOrigin: (place: Place | undefined) => void;
  setDestination: (place: Place | undefined) => void;
  swapPlaces: () => void;
  setCurrentSteps: (value: number) => void;
  setGoalSteps: (value: number) => void;
  setWalkingProfile: (value: WalkingProfile | undefined) => void;
  setSelectedRouteId: (value: string | undefined) => void;
};

const preferences = loadPreferences();

export const useTripStore = create<TripState>((set) => ({
  origin: preferences?.lastOrigin,
  destination: preferences?.lastDestination,
  currentSteps:
    preferences?.version === 3 &&
    preferences.currentStepsDate === kstDateKey()
      ? preferences.currentSteps
      : 0,
  goalSteps: preferences?.dailyGoalSteps ?? 8000,
  walkingProfile:
    preferences?.version === 2 || preferences?.version === 3
      ? preferences.walkingProfile
      : undefined,
  selectedRouteId: undefined,
  setOrigin: (origin) => set({ origin, selectedRouteId: undefined }),
  setDestination: (destination) =>
    set({ destination, selectedRouteId: undefined }),
  swapPlaces: () =>
    set((state) => ({
      origin: state.destination,
      destination: state.origin,
      selectedRouteId: undefined,
    })),
  setCurrentSteps: (currentSteps) => set({ currentSteps }),
  setGoalSteps: (goalSteps) => set({ goalSteps }),
  setWalkingProfile: (walkingProfile) => set({ walkingProfile }),
  setSelectedRouteId: (selectedRouteId) => set({ selectedRouteId }),
}));
