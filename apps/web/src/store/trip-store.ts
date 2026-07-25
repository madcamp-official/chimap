import type { Place } from "@chimap/contracts";
import { create } from "zustand";

import { loadPreferences } from "../lib/storage.js";
import { defaultDeadline } from "../lib/time.js";

type TripState = {
  origin: Place | undefined;
  destination: Place | undefined;
  currentSteps: number;
  goalSteps: number;
  deadlineLocal: string;
  maxExtraMinutes: number;
  strideLengthMeters: number;
  safetyBufferMinutes: number;
  selectedRouteId: string | undefined;
  setOrigin: (place: Place | undefined) => void;
  setDestination: (place: Place | undefined) => void;
  swapPlaces: () => void;
  setCurrentSteps: (value: number) => void;
  setGoalSteps: (value: number) => void;
  setDeadlineLocal: (value: string) => void;
  setMaxExtraMinutes: (value: number) => void;
  setStrideLengthMeters: (value: number) => void;
  setSafetyBufferMinutes: (value: number) => void;
  setSelectedRouteId: (value: string | undefined) => void;
};

const preferences = loadPreferences();

export const useTripStore = create<TripState>((set) => ({
  origin: preferences?.lastOrigin,
  destination: preferences?.lastDestination,
  currentSteps: 0,
  goalSteps: preferences?.dailyGoalSteps ?? 8000,
  deadlineLocal: defaultDeadline(),
  maxExtraMinutes: preferences?.maxExtraMinutes ?? 20,
  strideLengthMeters: preferences?.strideLengthMeters ?? 0.7,
  safetyBufferMinutes: preferences?.safetyBufferMinutes ?? 3,
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
  setDeadlineLocal: (deadlineLocal) => set({ deadlineLocal }),
  setMaxExtraMinutes: (maxExtraMinutes) => set({ maxExtraMinutes }),
  setStrideLengthMeters: (strideLengthMeters) =>
    set({ strideLengthMeters }),
  setSafetyBufferMinutes: (safetyBufferMinutes) =>
    set({ safetyBufferMinutes }),
  setSelectedRouteId: (selectedRouteId) => set({ selectedRouteId }),
}));
