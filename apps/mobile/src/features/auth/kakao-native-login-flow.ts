type KakaoTokenResult = {
  accessToken?: string;
};

type KakaoLogin = () => Promise<KakaoTokenResult>;

export type KakaoLoginFlowErrorCode =
  | "CANCELLED"
  | "CONFIGURATION_ERROR"
  | "AUTHORIZATION_REJECTED"
  | "NATIVE_LOGIN_FAILED"
  | "ACCOUNT_FALLBACK_FAILED";

export class KakaoLoginFlowError extends Error {
  public constructor(
    public readonly code: KakaoLoginFlowErrorCode,
    options?: ErrorOptions,
  ) {
    super(`Kakao login failed (${code})`, options);
    this.name = "KakaoLoginFlowError";
  }
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error && caught.message.trim().length > 0
    ? caught.message.trim()
    : "unknown Kakao SDK error";
}

function normalizedError(caught: unknown): string {
  return errorMessage(caught).toLocaleLowerCase("en-US");
}

export function isKakaoLoginCancellation(caught: unknown): boolean {
  const normalized = normalizedError(caught);
  return (
    normalized.includes("cancel") ||
    normalized.includes("취소") ||
    normalized.includes("user_cancelled")
  );
}

function nonRecoverableCode(caught: unknown): KakaoLoginFlowErrorCode | null {
  const normalized = normalizedError(caught);
  if (
    normalized.includes("koe") ||
    normalized.includes("key hash") ||
    normalized.includes("keyhash") ||
    normalized.includes("package") ||
    normalized.includes("bundle id") ||
    normalized.includes("bundleid") ||
    normalized.includes("origin mismatch") ||
    normalized.includes("misconfig") ||
    normalized.includes("app key")
  ) {
    return "CONFIGURATION_ERROR";
  }
  if (
    /(^|\D)(401|403)(\D|$)/u.test(normalized) ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden")
  ) {
    return "AUTHORIZATION_REJECTED";
  }
  return null;
}

function recoverableNativeFailure(caught: unknown): boolean {
  const normalized = normalizedError(caught);
  return (
    normalized.includes("empty access token") ||
    normalized.includes("callback") ||
    normalized.includes("hand-off") ||
    normalized.includes("handoff") ||
    normalized.includes("kakaotalk") ||
    normalized.includes("kakao talk") ||
    normalized.includes("talk login")
  );
}

function requireAccessToken(result: KakaoTokenResult, flow: string): string {
  const token = result.accessToken?.trim();
  if (token === undefined || token.length === 0) {
    throw new Error(`${flow} returned an empty access token`);
  }
  return token;
}

function classifiedError(caught: unknown): KakaoLoginFlowError {
  if (caught instanceof KakaoLoginFlowError) {
    return caught;
  }
  if (isKakaoLoginCancellation(caught)) {
    return new KakaoLoginFlowError("CANCELLED", { cause: caught });
  }
  return new KakaoLoginFlowError(
    nonRecoverableCode(caught) ?? "NATIVE_LOGIN_FAILED",
    { cause: caught },
  );
}

/**
 * The native wrapper's `login()` selects KakaoTalk whenever it is installed.
 * Retry with Kakao Account only when the Talk hand-off/callback itself is
 * recoverable. Configuration, authorization and cancellation failures must be
 * surfaced without opening a second login flow.
 */
export async function requestKakaoAccessTokenWithFallback(input: {
  preferredLogin: KakaoLogin;
  accountLogin: KakaoLogin;
}): Promise<string> {
  try {
    return requireAccessToken(await input.preferredLogin(), "Kakao native login");
  } catch (caught) {
    if (
      isKakaoLoginCancellation(caught) ||
      nonRecoverableCode(caught) !== null ||
      !recoverableNativeFailure(caught)
    ) {
      throw classifiedError(caught);
    }
  }

  try {
    return requireAccessToken(
      await input.accountLogin(),
      "Kakao account fallback",
    );
  } catch (caught) {
    if (isKakaoLoginCancellation(caught)) {
      throw new KakaoLoginFlowError("CANCELLED", { cause: caught });
    }
    const configurationCode = nonRecoverableCode(caught);
    throw new KakaoLoginFlowError(
      configurationCode ?? "ACCOUNT_FALLBACK_FAILED",
      { cause: caught },
    );
  }
}
