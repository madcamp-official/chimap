import { describe, expect, it } from "vitest";

import { KakaoLoginFlowError } from "./kakao-native-login-flow";
import {
  kakaoLoginErrorCode,
  kakaoLoginErrorMessage,
  type KakaoLoginErrorContext,
} from "./kakao-login-error";
import { MobileApiError } from "./mobile-api-error";

const iosContext: KakaoLoginErrorContext = {
  platform: "ios",
  environment: "staging",
  applicationId: "org.madcamp.chimap.staging",
};

const androidContext: KakaoLoginErrorContext = {
  platform: "android",
  environment: "production",
  applicationId: "org.madcamp.chimap",
};

describe("Kakao login error message", () => {
  it("uses the actual iOS Bundle ID for configuration guidance", () => {
    const message = kakaoLoginErrorMessage(
      new KakaoLoginFlowError("CONFIGURATION_ERROR"),
      iosContext,
    );

    expect(message).toContain("org.madcamp.chimap.staging");
    expect(message).toContain("Bundle ID");
    expect(message).not.toContain("키 해시");
  });

  it("uses the actual Android package and key-hash guidance", () => {
    const message = kakaoLoginErrorMessage(
      new KakaoLoginFlowError("CONFIGURATION_ERROR"),
      androidContext,
    );

    expect(message).toContain("org.madcamp.chimap");
    expect(message).toContain("패키지명");
    expect(message).toContain("키 해시");
  });

  it("preserves only the provider classification and request ID", () => {
    const error = new MobileApiError(
      "AUTH_PROVIDER_ERROR",
      "provider failed with sensitive SDK detail",
      "00000000-0000-4000-8000-000000000000",
      401,
    );
    const message = kakaoLoginErrorMessage(error, androidContext);

    expect(kakaoLoginErrorCode(error)).toBe("AUTH_PROVIDER_ERROR");
    expect(message).toContain("production 서버");
    expect(message).toContain("00000000-0000-4000-8000-000000000000");
    expect(message).not.toContain("sensitive SDK detail");
  });

  it("distinguishes cancellation from configuration errors", () => {
    expect(
      kakaoLoginErrorMessage(
        new KakaoLoginFlowError("CANCELLED"),
        androidContext,
      ),
    ).toBe("카카오 로그인이 취소되었습니다.");
  });
});
