import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { version: "0.1.0" } },
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

import { rotateRefreshToken } from "./auth-api";

const pair = {
  tokenType: "Bearer",
  accessToken: "a".repeat(43),
  accessExpiresAt: "2026-07-26T03:15:00.000Z",
  refreshToken: "r".repeat(43),
  refreshExpiresAt: "2026-08-25T03:00:00.000Z",
  user: {
    id: "00000000-0000-4000-8000-000000000000",
    provider: "KAKAO",
    displayName: null,
    profileImageUrl: null,
  },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile refresh client", () => {
  it("동시 refresh 호출을 하나로 합쳐 같은 pair를 공유한다", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify(pair), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", request);

    const first = rotateRefreshToken({
      apiBaseUrl: "https://api.invalid",
      refreshToken: "old-refresh-token",
    });
    const second = rotateRefreshToken({
      apiBaseUrl: "https://api.invalid",
      refreshToken: "old-refresh-token",
    });

    await expect(first).resolves.toEqual(pair);
    await expect(second).resolves.toEqual(pair);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
