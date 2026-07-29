import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  RecommendationRequest,
  RecommendationResponse,
  RecommendationType,
} from "@chimap/contracts";
import {
  recommendationRequestSchema,
  recommendationTypeSchema,
} from "@chimap/contracts";
import { reconcileRouteSelection } from "@chimap/app-core";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";

export type PersistedRouteStateV1 = {
  version: 1;
  savedAt: string | null;
  requestSavedAt: string | null;
  lastRequest: RecommendationRequest | null;
  requestHash: string | null;
  selectedRouteId: string | null;
  selectedRouteType: RecommendationType | null;
  detailSheet: {
    open: boolean;
    routeId: string | null;
  };
};

export type RouteStoreState = PersistedRouteStateV1 & {
  hydrated: boolean;
  setHydrated(hydrated: boolean): void;
  rememberRequest(request: RecommendationRequest, requestHash: string): void;
  selectRoute(routeId: string, routeType: RecommendationType): void;
  openDetail(routeId: string, routeType: RecommendationType): void;
  reconcileRecommendations(response: RecommendationResponse): void;
  closeDetailSheet(): void;
  reset(): void;
};

const initialPersistedState: PersistedRouteStateV1 = {
  version: 1,
  savedAt: null,
  requestSavedAt: null,
  lastRequest: null,
  requestHash: null,
  selectedRouteId: null,
  selectedRouteType: null,
  detailSheet: { open: false, routeId: null },
};

function persistedPart(state: RouteStoreState): PersistedRouteStateV1 {
  return {
    version: 1,
    savedAt: state.savedAt,
    requestSavedAt: state.requestSavedAt,
    lastRequest: state.lastRequest,
    requestHash: state.requestHash,
    selectedRouteId: state.selectedRouteId,
    selectedRouteType: state.selectedRouteType,
    // A modal is ephemeral UI. Restoring it can mount two native maps during
    // cold start before either surface is ready; preserve selection, not focus.
    detailSheet: { open: false, routeId: null },
  };
}

function migratePersistedState(value: unknown): PersistedRouteStateV1 {
  if (typeof value !== "object" || value === null) {
    return initialPersistedState;
  }
  const candidate = value as Partial<PersistedRouteStateV1>;
  if (candidate.version !== 1) {
    return initialPersistedState;
  }
  const request = recommendationRequestSchema.safeParse(candidate.lastRequest);
  const routeType = recommendationTypeSchema.safeParse(candidate.selectedRouteType);
  const selectedRouteId =
    typeof candidate.selectedRouteId === "string" &&
    candidate.selectedRouteId.length > 0
      ? candidate.selectedRouteId
      : null;
  const requestHash =
    request.success &&
    typeof candidate.requestHash === "string" &&
    /^[a-f0-9]{64}$/u.test(candidate.requestHash)
      ? candidate.requestHash
      : null;
  const savedAt =
    typeof candidate.savedAt === "string" &&
    Number.isFinite(Date.parse(candidate.savedAt))
      ? candidate.savedAt
      : null;
  const requestSavedAt =
    typeof candidate.requestSavedAt === "string" &&
    Number.isFinite(Date.parse(candidate.requestSavedAt))
      ? candidate.requestSavedAt
      : savedAt;
  return {
    version: 1,
    savedAt,
    requestSavedAt,
    lastRequest: requestHash === null || !request.success ? null : request.data,
    requestHash,
    selectedRouteId,
    selectedRouteType: routeType.success ? routeType.data : null,
    detailSheet: { open: false, routeId: null },
  };
}

export function createRouteStore(storageKey: string) {
  return createStore<RouteStoreState>()(
    persist(
      (set) => ({
        ...initialPersistedState,
        hydrated: false,
        setHydrated: (hydrated) => set({ hydrated }),
        rememberRequest: (lastRequest, requestHash) => {
          const now = new Date().toISOString();
          set({ lastRequest, requestHash, savedAt: now, requestSavedAt: now });
        },
        selectRoute: (selectedRouteId, selectedRouteType) =>
          set({
            selectedRouteId,
            selectedRouteType,
            detailSheet: { open: false, routeId: null },
            savedAt: new Date().toISOString(),
          }),
        openDetail: (selectedRouteId, selectedRouteType) =>
          set({
            selectedRouteId,
            selectedRouteType,
            detailSheet: { open: true, routeId: selectedRouteId },
            savedAt: new Date().toISOString(),
          }),
        reconcileRecommendations: (response) =>
          set((state) => {
            const next = reconcileRouteSelection(
              {
                selectedRouteId: state.selectedRouteId,
                selectedRouteType: state.selectedRouteType,
                detailSheetOpen: state.detailSheet.open,
              },
              response,
            );
            return {
              selectedRouteId: next.selectedRouteId,
              selectedRouteType: next.selectedRouteType,
              detailSheet: {
                open: next.detailSheetOpen,
                routeId: next.detailSheetOpen ? next.selectedRouteId : null,
              },
              savedAt: new Date().toISOString(),
            };
          }),
        closeDetailSheet: () =>
          set({
            detailSheet: { open: false, routeId: null },
            savedAt: new Date().toISOString(),
          }),
        reset: () => set({ ...initialPersistedState, hydrated: true }),
      }),
      {
        name: storageKey,
        storage: createJSONStorage(() => AsyncStorage),
        version: 1,
        skipHydration: true,
        partialize: persistedPart,
        migrate: (persisted) => migratePersistedState(persisted),
        merge: (persisted, current) => ({
          ...current,
          ...migratePersistedState(persisted),
        }),
        onRehydrateStorage: () => (state) => state?.setHydrated(true),
      },
    ),
  );
}

export type RouteStore = ReturnType<typeof createRouteStore>;
