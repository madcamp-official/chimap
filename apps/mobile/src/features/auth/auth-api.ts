import {
  errorResponseSchema,
  mobileTokenPairSchema,
  type MobileAppleLoginRequest,
  type MobilePlatform,
  type MobileTokenPair,
} from "@chimap/contracts";

import { mobileClientHeaders } from "../api/client-metadata";
import { fetchWithTimeout } from "../api/fetch-with-timeout";
import { MobileApiError } from "./mobile-api-error";

export { MobileApiError } from "./mobile-api-error";

async function responseBody(response: Response): Promise<unknown> {
  const value = await response.text();
  return value.length === 0 ? null : (JSON.parse(value) as unknown);
}

async function expectTokenPair(response: Response): Promise<MobileTokenPair> {
  const body = await responseBody(response);
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(body);
    throw new MobileApiError(
      error.success ? error.data.error.code : "INTERNAL_ERROR",
      error.success ? error.data.error.message : "로그인을 완료하지 못했습니다.",
      error.success ? error.data.error.requestId : null,
      response.status,
    );
  }
  return mobileTokenPairSchema.parse(body);
}

export async function exchangeKakaoToken(input: {
  apiBaseUrl: string;
  kakaoAccessToken: string;
  platform: MobilePlatform;
}): Promise<MobileTokenPair> {
  const response = await fetchWithTimeout(`${input.apiBaseUrl}/api/v1/auth/kakao/mobile`, {
    method: "POST",
    headers: mobileClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      kakaoAccessToken: input.kakaoAccessToken,
      platform: input.platform,
    }),
  });
  return expectTokenPair(response);
}

export async function exchangeAppleToken(
  input: Omit<MobileAppleLoginRequest, "platform"> & { apiBaseUrl: string },
): Promise<MobileTokenPair> {
  const response = await fetchWithTimeout(`${input.apiBaseUrl}/api/v1/auth/apple/mobile`, {
    method: "POST",
    headers: mobileClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      identityToken: input.identityToken,
      authorizationCode: input.authorizationCode,
      nonce: input.nonce,
      displayName: input.displayName,
      platform: "ios",
    }),
  });
  return expectTokenPair(response);
}

const refreshInFlight = new Map<string, Promise<MobileTokenPair>>();

export function rotateRefreshToken(input: {
  apiBaseUrl: string;
  refreshToken: string;
}): Promise<MobileTokenPair> {
  const requestKey = `${input.apiBaseUrl}\u001f${input.refreshToken}`;
  const existing = refreshInFlight.get(requestKey);
  if (existing !== undefined) {
    return existing;
  }
  const request = fetchWithTimeout(`${input.apiBaseUrl}/api/v1/auth/token/refresh`, {
    method: "POST",
    headers: mobileClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ refreshToken: input.refreshToken }),
  })
    .then(expectTokenPair)
    .finally(() => {
      refreshInFlight.delete(requestKey);
    });
  refreshInFlight.set(requestKey, request);
  return request;
}

export async function revokeMobileSession(input: {
  apiBaseUrl: string;
  refreshToken: string;
}): Promise<void> {
  await fetchWithTimeout(`${input.apiBaseUrl}/api/v1/auth/mobile/logout`, {
    method: "POST",
    headers: mobileClientHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ refreshToken: input.refreshToken }),
  });
}

export async function deleteMobileAccount(input: {
  apiBaseUrl: string;
  accessToken: string;
  refreshToken: string;
}): Promise<void> {
  const response = await fetchWithTimeout(
    `${input.apiBaseUrl}/api/v1/auth/mobile/account/delete`,
    {
      method: "POST",
      headers: mobileClientHeaders({
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        refreshToken: input.refreshToken,
        confirmation: "DELETE",
      }),
    },
  );
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(await responseBody(response));
    throw new MobileApiError(
      error.success ? error.data.error.code : "INTERNAL_ERROR",
      error.success
        ? error.data.error.message
        : "계정을 삭제하지 못했습니다.",
    );
  }
}
