import type { MobileTokenPair } from "@chimap/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const secureStore = vi.hoisted(() => ({
  values: new Map<string, string>(),
  getItemAsync: vi.fn(async (key: string) => secureStore.values.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStore.values.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    secureStore.values.delete(key);
  }),
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { appEnvironment: "staging" } } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "after-first-unlock-this-device-only",
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
  deleteItemAsync: secureStore.deleteItemAsync,
}));

import {
  clearStoredSession,
  readStoredSession,
  writeStoredSession,
} from "./auth-storage";

const pair: MobileTokenPair = {
  tokenType: "Bearer",
  accessToken: "a".repeat(43),
  accessExpiresAt: "2026-07-26T10:15:00.000Z",
  refreshToken: "r".repeat(43),
  refreshExpiresAt: "2026-08-25T10:00:00.000Z",
  user: {
    id: "7b94e7d4-4094-44c2-917b-4fd8c5ea27be",
    provider: "KAKAO",
    displayName: "CHIMap 사용자",
    profileImageUrl: null,
  },
};

describe("mobile SecureStore session", () => {
  beforeEach(() => {
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it("환경과 OS가 분리된 key에 전체 token pair를 저장하고 복원한다", async () => {
    await writeStoredSession(pair);

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "chimap.staging.ios.auth.session.v1",
      JSON.stringify(pair),
      { keychainAccessible: "after-first-unlock-this-device-only" },
    );
    const storageKey = secureStore.setItemAsync.mock.calls[0]?.[0];
    expect(storageKey).toMatch(/^[A-Za-z0-9._-]+$/);
    await expect(readStoredSession()).resolves.toEqual(pair);

    await clearStoredSession();
    await expect(readStoredSession()).resolves.toBeNull();
  });

  it("손상되거나 계약과 다른 session은 제거하고 사용하지 않는다", async () => {
    secureStore.values.set(
      "chimap.staging.ios.auth.session.v1",
      JSON.stringify({ ...pair, refreshToken: "short" }),
    );

    await expect(readStoredSession()).resolves.toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(
      "chimap.staging.ios.auth.session.v1",
    );
  });
});
