import { beforeEach, describe, expect, it, vi } from "vitest";

const persisted = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => persisted.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      persisted.set(key, value);
    },
    removeItem: async (key: string) => {
      persisted.delete(key);
    },
  },
}));

import { createRouteStore } from "./route-store";

beforeEach(() => {
  persisted.clear();
});

describe("RouteStore persistence", () => {
  it("eviction 뒤 선택 route만 복원하고 상세 modal은 닫힌 상태로 시작한다", async () => {
    const first = createRouteStore("chimap:development:ios:user-a:route:v1");
    first.getState().openDetail("goal-route", "GOAL");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const restored = createRouteStore("chimap:development:ios:user-a:route:v1");
    await restored.persist.rehydrate();

    expect(restored.getState()).toMatchObject({
      hydrated: true,
      selectedRouteId: "goal-route",
      selectedRouteType: "GOAL",
      detailSheet: { open: false, routeId: null },
    });
  });

  it("경로 카드 선택은 지도만 바꾸고 상세 sheet는 자세히 동작에서만 연다", () => {
    const store = createRouteStore("chimap:development:ios:user-a:route:v1");

    store.getState().selectRoute("fast-route", "FAST");
    expect(store.getState()).toMatchObject({
      selectedRouteId: "fast-route",
      detailSheet: { open: false, routeId: null },
    });

    store.getState().openDetail("fast-route", "FAST");
    expect(store.getState()).toMatchObject({
      selectedRouteId: "fast-route",
      detailSheet: { open: true, routeId: "fast-route" },
    });
  });

  it("다른 platform/user namespace에는 UI 상태가 섞이지 않는다", async () => {
    const first = createRouteStore("chimap:development:ios:user-a:route:v1");
    first.getState().selectRoute("fast-route", "FAST");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const isolated = createRouteStore("chimap:development:android:user-a:route:v1");
    await isolated.persist.rehydrate();

    expect(isolated.getState()).toMatchObject({
      selectedRouteId: null,
      detailSheet: { open: false, routeId: null },
    });
  });

  it("손상되거나 서로 맞지 않는 요청·상세 상태는 안전한 초기값으로 복구한다", async () => {
    const key = "chimap:development:ios:user-a:route:v1";
    persisted.set(
      key,
      JSON.stringify({
        version: 1,
        state: {
          version: 1,
          lastRequest: { origin: "invalid" },
          requestHash: "not-a-sha256",
          selectedRouteId: "route-a",
          selectedRouteType: "UNKNOWN",
          detailSheet: { open: true, routeId: "route-b" },
        },
      }),
    );
    const store = createRouteStore(key);
    await store.persist.rehydrate();

    expect(store.getState()).toMatchObject({
      hydrated: true,
      lastRequest: null,
      requestHash: null,
      selectedRouteId: "route-a",
      selectedRouteType: null,
      detailSheet: { open: false, routeId: null },
    });
  });

  it("sheet 선택 시각과 추천 요청 날짜를 분리해 자정 이후 걸음을 보호한다", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
      const store = createRouteStore("chimap:development:ios:user-a:route:v1");
      store.getState().rememberRequest(
        {
          origin: {
            id: "origin",
            name: "출발",
            address: "",
            roadAddress: "",
            category: "",
            location: { lng: 127.36, lat: 36.37 },
          },
          destination: {
            id: "destination",
            name: "도착",
            address: "",
            roadAddress: "",
            category: "",
            location: { lng: 127.4, lat: 36.4 },
          },
          currentSteps: 1000,
          goalSteps: 8000,
          walkingMetric: {
            stepLengthMeters: 0.7,
            source: "RESEARCH_ESTIMATE",
            modelVersion: "HAN_2026_V1",
          },
        },
        "a".repeat(64),
      );
      const requestSavedAt = store.getState().requestSavedAt;
      vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
      store.getState().selectRoute("goal-route", "GOAL");

      expect(store.getState().requestSavedAt).toBe(requestSavedAt);
      expect(store.getState().savedAt).not.toBe(requestSavedAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
