import { MobileApiError } from "./mobile-api-error";

function requestSuffix(requestId: string | null): string {
  return requestId === null ? "" : `\n요청 ID: ${requestId}`;
}

export function kakaoLoginErrorMessage(caught: unknown): string {
  if (caught instanceof MobileApiError) {
    return caught.code === "AUTH_PROVIDER_ERROR"
      ? `카카오 앱 설정 또는 로그인 토큰을 staging 서버가 검증하지 못했습니다.${requestSuffix(caught.requestId)}`
      : `${caught.message}${requestSuffix(caught.requestId)}`;
  }

  const message = caught instanceof Error ? caught.message : "";
  const normalized = message.toLocaleLowerCase("en-US");
  if (
    normalized.includes("koe009") ||
    normalized.includes("bundleid") ||
    normalized.includes("bundle id") ||
    normalized.includes("misconfigured")
  ) {
    return (
      "카카오 앱의 iOS 설정이 일치하지 않습니다. " +
      "Kakao Developers에 org.madcamp.chimap.staging Bundle ID를 등록한 뒤 다시 시도해 주세요."
    );
  }
  if (
    normalized.includes("kakao native login failed") ||
    normalized.includes("kakaosdkcommon.sdkerror") ||
    normalized.includes("rnkakaologins")
  ) {
    return (
      "카카오 네이티브 인증 단계에서 실패했습니다. " +
      "Kakao Developers의 Native App Key에 org.madcamp.chimap.staging Bundle ID가 등록되어 있는지 확인하고, " +
      ".env 변경 후 CNG로 다시 빌드한 앱을 삭제·재설치해 주세요."
    );
  }
  if (
    normalized.includes("cancel") ||
    normalized.includes("취소") ||
    normalized.includes("canceled") ||
    normalized.includes("cancelled")
  ) {
    return "카카오 로그인이 취소되었습니다.";
  }
  return "카카오 로그인을 완료하지 못했습니다. 다시 시도해 주세요.";
}
