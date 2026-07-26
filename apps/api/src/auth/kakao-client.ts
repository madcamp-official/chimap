import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { KakaoIdentity } from "./auth-repository.js";

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
  })
  .passthrough();

const kakaoUserPayloadSchema = z
  .object({
    kakao_account: z
      .object({
        profile: z
          .object({
            nickname: z.string().trim().min(1).max(100).optional(),
            profile_image_url: z.url().max(2048).optional(),
            thumbnail_image_url: z.url().max(2048).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function secureProfileImageUrl(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const url = new URL(value);
  if (url.protocol === "http:") {
    url.protocol = "https:";
  }
  return url.protocol === "https:" ? url.toString() : null;
}

export class KakaoAuthError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KakaoAuthError";
  }
}

export type KakaoAuthClientLike = {
  authorizeUrl(state: string): string;
  exchangeAuthorizationCode(code: string): Promise<string>;
  getIdentity(accessToken: string): Promise<KakaoIdentity>;
};

export class KakaoAuthClient implements KakaoAuthClientLike {
  public constructor(
    private readonly config: NonNullable<AppConfig["kakaoAuth"]>,
    private readonly request: typeof fetch = fetch,
  ) {}

  public authorizeUrl(state: string): string {
    const url = new URL("https://kauth.kakao.com/oauth/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
    }).toString();
    return url.toString();
  }

  public async exchangeAuthorizationCode(code: string): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      code,
      client_secret: this.config.clientSecret,
    });
    const response = await this.request("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new KakaoAuthError("카카오 토큰을 발급받지 못했습니다.");
    }
    const parsed = tokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new KakaoAuthError("카카오 토큰 응답을 확인하지 못했습니다.");
    }
    return parsed.data.access_token;
  }

  public async getIdentity(accessToken: string): Promise<KakaoIdentity> {
    const response = await this.request("https://kapi.kakao.com/v2/user/me", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      throw new KakaoAuthError("카카오 사용자 정보를 확인하지 못했습니다.");
    }
    const responseText = await response.text();
    const providerUserId = /^\s*\{[\s\S]*?"id"\s*:\s*(\d+)/u.exec(
      responseText,
    )?.[1];
    if (providerUserId === undefined) {
      throw new KakaoAuthError("카카오 회원번호를 확인하지 못했습니다.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch (error) {
      throw new KakaoAuthError("카카오 사용자 응답을 읽지 못했습니다.", {
        cause: error,
      });
    }
    const parsed = kakaoUserPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new KakaoAuthError("카카오 사용자 응답 형식이 올바르지 않습니다.");
    }
    const profile = parsed.data.kakao_account?.profile;
    return {
      providerUserId,
      displayName: profile?.nickname ?? null,
      profileImageUrl: secureProfileImageUrl(
        profile?.profile_image_url ?? profile?.thumbnail_image_url,
      ),
    };
  }
}
