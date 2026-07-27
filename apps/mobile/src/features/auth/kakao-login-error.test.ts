import { describe, expect, it } from "vitest";

import { kakaoLoginErrorMessage } from "./kakao-login-error";
import { MobileApiError } from "./mobile-api-error";

describe("Kakao login error message", () => {
  it("iOS Bundle ID 설정 오류를 사용자가 고칠 수 있게 안내한다", () => {
    expect(
      kakaoLoginErrorMessage(
        new Error("KOE009: IOS bundleId validation failed (misconfigured)"),
      ),
    ).toContain("org.madcamp.chimap.staging");
  });

  it("provider 오류에는 서버 요청 ID를 보존한다", () => {
    expect(
      kakaoLoginErrorMessage(
        new MobileApiError(
          "AUTH_PROVIDER_ERROR",
          "provider failed",
          "00000000-0000-4000-8000-000000000000",
          401,
        ),
      ),
    ).toContain("00000000-0000-4000-8000-000000000000");
  });

  it("사용자 취소와 설정 오류를 구분한다", () => {
    expect(kakaoLoginErrorMessage(new Error("login cancelled"))).toBe(
      "카카오 로그인이 취소되었습니다.",
    );
  });
});
