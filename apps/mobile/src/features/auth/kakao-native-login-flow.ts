type KakaoTokenResult = {
  accessToken?: string;
};

type KakaoLogin = () => Promise<KakaoTokenResult>;

function errorMessage(caught: unknown): string {
  return caught instanceof Error && caught.message.trim().length > 0
    ? caught.message.trim()
    : "unknown Kakao SDK error";
}

export function isKakaoLoginCancellation(caught: unknown): boolean {
  const normalized = errorMessage(caught).toLocaleLowerCase("en-US");
  return (
    normalized.includes("cancel") ||
    normalized.includes("취소") ||
    normalized.includes("user_cancelled")
  );
}

function requireAccessToken(result: KakaoTokenResult, flow: string): string {
  const token = result.accessToken?.trim();
  if (token === undefined || token.length === 0) {
    throw new Error(`${flow} returned an empty access token`);
  }
  return token;
}

/**
 * The native wrapper's `login()` selects KakaoTalk whenever it is installed,
 * but does not retry with the Kakao Account flow when that hand-off fails.
 * Preserve an explicit user cancellation and use the account flow only for a
 * recoverable KakaoTalk/native failure.
 */
export async function requestKakaoAccessTokenWithFallback(input: {
  preferredLogin: KakaoLogin;
  accountLogin: KakaoLogin;
}): Promise<string> {
  let preferredFailure: unknown;
  try {
    return requireAccessToken(await input.preferredLogin(), "Kakao native login");
  } catch (caught) {
    if (isKakaoLoginCancellation(caught)) {
      throw caught;
    }
    preferredFailure = caught;
  }

  try {
    return requireAccessToken(
      await input.accountLogin(),
      "Kakao account fallback",
    );
  } catch (caught) {
    if (isKakaoLoginCancellation(caught)) {
      throw caught;
    }
    throw new Error(
      `Kakao native login failed: ${errorMessage(preferredFailure)}; ` +
        `Kakao account fallback failed: ${errorMessage(caught)}`,
    );
  }
}
