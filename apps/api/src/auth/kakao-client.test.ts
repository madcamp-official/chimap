import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import { KakaoAuthClient } from "./kakao-client.js";

function config() {
  return loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "rest-key",
    KAKAO_OAUTH_CLIENT_SECRET: "client-secret",
    KAKAO_OAUTH_REDIRECT_URI:
      "http://localhost:8080/api/v1/auth/kakao/callback",
    AUTH_SESSION_SECRET: "a-secure-session-secret-with-32-characters",
  }).kakaoAuth!;
}

describe("Kakao REST 인증 client", () => {
  it("인가 코드를 Client Secret과 함께 토큰으로 교환한다", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new KakaoAuthClient(config(), request as typeof fetch);

    expect(await client.exchangeAuthorizationCode("authorize-code")).toBe(
      "access-token",
    );
    const [url, options] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://kauth.kakao.com/oauth/token");
    expect(String(options.body)).toContain("client_secret=client-secret");
    expect(String(options.body)).toContain("code=authorize-code");
  });

  it("JavaScript 안전 정수보다 큰 카카오 회원번호도 문자열로 보존한다", async () => {
    const request = vi.fn(async () =>
      new Response(
        `{"id":1285016924429472463,"kakao_account":{"profile":{"nickname":"춘식이"}}}`,
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new KakaoAuthClient(config(), request as typeof fetch);

    await expect(client.getIdentity("access-token")).resolves.toEqual({
      providerUserId: "1285016924429472463",
      displayName: "춘식이",
      profileImageUrl: null,
    });
  });

  it("카카오 프로필 이미지를 HTTPS로 정규화한다", async () => {
    const request = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 1234,
          kakao_account: {
            profile: {
              nickname: "춘식이",
              profile_image_url: "http://k.kakaocdn.net/profile.jpg",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new KakaoAuthClient(config(), request as typeof fetch);

    await expect(client.getIdentity("access-token")).resolves.toMatchObject({
      profileImageUrl: "https://k.kakaocdn.net/profile.jpg",
    });
  });

  it("모바일 access token의 Kakao app_id와 만료를 검증한다", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify({ app_id: 123456, expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = new KakaoAuthClient(config(), request as typeof fetch);

    await expect(
      client.verifyAccessToken("mobile-access-token", "123456"),
    ).resolves.toBeUndefined();
    await expect(
      client.verifyAccessToken("mobile-access-token", "999999"),
    ).rejects.toThrow(/다른 앱/u);
  });
});
