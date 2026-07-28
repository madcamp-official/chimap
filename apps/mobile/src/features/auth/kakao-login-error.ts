import {
  KakaoLoginFlowError,
  type KakaoLoginFlowErrorCode,
} from "./kakao-native-login-flow";
import { MobileApiError } from "./mobile-api-error";

export type KakaoLoginErrorContext = {
  platform: "android" | "ios";
  environment: "development" | "staging" | "production";
  applicationId: string;
};

function requestSuffix(requestId: string | null): string {
  return requestId === null ? "" : `\n요청 ID: ${requestId}`;
}

function platformConfigurationMessage(context: KakaoLoginErrorContext): string {
  if (context.platform === "android") {
    return (
      "카카오 앱의 Android 설정이 일치하지 않습니다. " +
      `Kakao Developers에 ${context.applicationId} 패키지명과 현재 앱 서명의 키 해시를 등록한 뒤 다시 시도해 주세요.`
    );
  }
  return (
    "카카오 앱의 iOS 설정이 일치하지 않습니다. " +
    `Kakao Developers에 ${context.applicationId} Bundle ID를 등록한 뒤 다시 시도해 주세요.`
  );
}

function rawNativeCode(caught: unknown): KakaoLoginFlowErrorCode {
  const normalized = caught instanceof Error
    ? caught.message.toLocaleLowerCase("en-US")
    : "";
  if (
    normalized.includes("koe") ||
    normalized.includes("key hash") ||
    normalized.includes("keyhash") ||
    normalized.includes("package") ||
    normalized.includes("bundle id") ||
    normalized.includes("bundleid") ||
    normalized.includes("misconfig") ||
    normalized.includes("app key")
  ) {
    return "CONFIGURATION_ERROR";
  }
  if (
    normalized.includes("cancel") ||
    normalized.includes("취소") ||
    normalized.includes("user_cancelled")
  ) {
    return "CANCELLED";
  }
  if (/(^|\D)(401|403)(\D|$)/u.test(normalized)) {
    return "AUTHORIZATION_REJECTED";
  }
  return "NATIVE_LOGIN_FAILED";
}

export function kakaoLoginErrorCode(caught: unknown): string {
  if (caught instanceof MobileApiError) {
    return caught.code;
  }
  return caught instanceof KakaoLoginFlowError
    ? caught.code
    : rawNativeCode(caught);
}

export function kakaoLoginErrorMessage(
  caught: unknown,
  context: KakaoLoginErrorContext,
): string {
  if (caught instanceof MobileApiError) {
    return caught.code === "AUTH_PROVIDER_ERROR"
      ? `카카오 앱 설정 또는 로그인 토큰을 ${context.environment} 서버가 검증하지 못했습니다.${requestSuffix(caught.requestId)}`
      : `${caught.message}${requestSuffix(caught.requestId)}`;
  }

  const code = kakaoLoginErrorCode(caught);
  if (code === "CONFIGURATION_ERROR") {
    return platformConfigurationMessage(context);
  }
  if (code === "AUTHORIZATION_REJECTED") {
    return "카카오 인증 요청이 거부되었습니다. 앱 설정을 확인한 뒤 다시 시도해 주세요.";
  }
  if (code === "CANCELLED") {
    return "카카오 로그인이 취소되었습니다.";
  }
  if (code === "ACCOUNT_FALLBACK_FAILED") {
    return "카카오계정 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return (
    "카카오 네이티브 인증 단계에서 실패했습니다. " +
    `${context.applicationId} 앱 설정을 확인하고, 설정 변경 후 CNG로 다시 빌드한 앱을 삭제·재설치해 주세요.`
  );
}
