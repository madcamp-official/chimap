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

  it.each(["native callback failed", "KakaoTalk hand-off failed"])(
    "falls back after a recoverable native failure: %s",
    async (nativeMessage) => {
      await expect(
        requestKakaoAccessTokenWithFallback({
          preferredLogin: async () => {
            throw new Error(nativeMessage);
          },
          accountLogin: async () => ({ accessToken: "account-access-token" }),
        }),
      ).resolves.toBe("account-access-token");
    },
  );

  it("falls back when the native wrapper returns an empty token", async () => {
    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => ({ accessToken: "" }),
        accountLogin: async () => ({ accessToken: "account-access-token" }),
      }),
    ).resolves.toBe("account-access-token");
  });

  it("does not reopen login after cancellation", async () => {
    const accountLogin = vi.fn();

    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error("login cancelled by user");
        },
        accountLogin,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(accountLogin).not.toHaveBeenCalled();
  });

  it.each([
    ["KOE009 native origin mismatch", "CONFIGURATION_ERROR"],
    ["Android key hash mismatch", "CONFIGURATION_ERROR"],
    ["HTTP 401 unauthorized", "AUTHORIZATION_REJECTED"],
    ["HTTP 403 forbidden", "AUTHORIZATION_REJECTED"],
    ["opaque SDK failure", "NATIVE_LOGIN_FAILED"],
  ])("does not fall back for %s", async (nativeMessage, code) => {
    const accountLogin = vi.fn();

    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error(nativeMessage);
        },
        accountLogin,
      }),
    ).rejects.toMatchObject({ code });
    expect(accountLogin).not.toHaveBeenCalled();
  });

  it("classifies fallback cancellation without exposing SDK text", async () => {
    await expect(
      requestKakaoAccessTokenWithFallback({
        preferredLogin: async () => {
          throw new Error("native callback failed");
        },
        accountLogin: async () => {
          throw new Error("사용자가 취소했습니다");
        },
      }),
    ).rejects.toMatchObject({
      code: "CANCELLED",
      message: "Kakao login failed (CANCELLED)",
    });
  });

  it("recognizes localized cancellation messages", () => {
    expect(isKakaoLoginCancellation(new Error("로그인이 취소되었습니다"))).toBe(
      true,
    );
  });
});
