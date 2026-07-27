import { describe, expect, it, vi } from "vitest";

import {
  isKakaoLoginCancellation,
  requestKakaoAccessTokenWithFallback,
} from "./kakao-native-login-flow";

describe("Kakao native login flow", () => {
  it("uses the preferred KakaoTalk/native result when it succeeds", async () => {
    const accountLogin = vi.fn();

    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => ({ accessToken: "native-access-token" }),
        accountLogin,
      }),
    ).resolves.toBe("native-access-token");
    expect(accountLogin).not.toHaveBeenCalled();
  });

  it("falls back to Kakao Account after a non-cancellation native failure", async () => {
    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error("native callback failed");
        },
        accountLogin: async () => ({ accessToken: "account-access-token" }),
      }),
    ).resolves.toBe("account-access-token");
  });

  it("does not reopen login after the user cancels KakaoTalk", async () => {
    const accountLogin = vi.fn();

    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error("login cancelled by user");
        },
        accountLogin,
      }),
    ).rejects.toThrow("cancelled");
    expect(accountLogin).not.toHaveBeenCalled();
  });

  it("surfaces account fallback cancellation as a cancellation", async () => {
    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error("native callback failed");
        },
        accountLogin: async () => {
          throw new Error("사용자가 취소했습니다");
        },
      }),
    ).rejects.toThrow("취소");
  });

  it("keeps both SDK failures for device diagnostics", async () => {
    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error("KOE009 native origin mismatch");
        },
        accountLogin: async () => {
          throw new Error("account authorization failed");
        },
      }),
    ).rejects.toThrow(
      "Kakao native login failed: KOE009 native origin mismatch; Kakao account fallback failed: account authorization failed",
    );
  });

  it("recognizes localized cancellation messages", () => {
    expect(isKakaoLoginCancellation(new Error("로그인이 취소되었습니다"))).toBe(
      true,
    );
  });
});
