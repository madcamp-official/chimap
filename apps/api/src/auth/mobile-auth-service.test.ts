import type { AuthUser } from "@chimap/contracts";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../config.js";
import type { AuthStore } from "./auth-repository.js";
import type {
  EncryptedRetryTokenPair,
  MobileAuthStore,
  MobileRefreshResult,
} from "./mobile-auth-repository.js";
import {
  MobileAuthError,
  MobileAuthService,
} from "./mobile-auth-service.js";
import type { KakaoMobileAuthClientLike } from "./kakao-client.js";
import type { AppleAuthClientLike } from "./apple-client.js";

const user: AuthUser = {
  id: "00000000-0000-4000-8000-000000000000",
  provider: "KAKAO",
  displayName: "춘식이",
  profileImageUrl: null,
};

function mobileConfig() {
  return loadConfig({
    NODE_ENV: "test",
    KAKAO_REST_API_KEY: "rest-key",
    AUTH_MOBILE_ENABLED: "1",
    KAKAO_APP_ID: "123456",
    AUTH_REFRESH_RETRY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  });
}

const applePrivateKey = Buffer.from(
  "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
).toString("base64");

describe("모바일 auth token rotation", () => {
  it("동일한 이전 refresh token의 grace 재시도에는 같은 token pair를 반환한다", async () => {
    let savedEncrypted: EncryptedRetryTokenPair | undefined;
    let savedAccessExpiresAt: Date | undefined;
    const refreshExpiresAt = new Date("2026-08-25T03:00:00.000Z");
    let callCount = 0;
    const store: MobileAuthStore = {
      createMobileSession: vi.fn(async () => undefined),
      findUserByMobileAccess: vi.fn(async () => user),
      revokeMobileFamily: vi.fn(async () => undefined),
      storeAppleRefreshCredential: vi.fn(async () => undefined),
      findAppleRefreshCredentialForValidation: vi.fn(async () => null),
      markAppleRefreshCredentialValidated: vi.fn(async () => undefined),
      deleteMobileAccount: vi.fn(async () => ({
        provider: "KAKAO" as const,
        appleRefreshCredential: null,
      })),
      rotateMobileRefresh: vi.fn(async (input): Promise<MobileRefreshResult> => {
        callCount += 1;
        if (callCount === 1) {
          savedEncrypted = input.encryptedRetryPair;
          savedAccessExpiresAt = input.accessExpiresAt;
          return {
            status: "rotated",
            user,
            platform: "android",
            accessExpiresAt: input.accessExpiresAt,
            refreshExpiresAt,
          };
        }
        return {
          status: "replayed",
          user,
          platform: "android",
          accessExpiresAt: savedAccessExpiresAt as Date,
          refreshExpiresAt,
          encryptedRetryPair: savedEncrypted as EncryptedRetryTokenPair,
        };
      }),
    };
    const service = new MobileAuthService(
      mobileConfig(),
      {
        upsertKakaoUser: vi.fn(async () => user),
        upsertOAuthUser: vi.fn(async () => user),
      },
      store,
      {} as KakaoMobileAuthClientLike,
      () => new Date("2026-07-26T03:00:00.000Z"),
    );

    const first = await service.refresh("same-old-refresh-token");
    const retry = await service.refresh("same-old-refresh-token");

    expect(retry).toEqual(first);
    expect(first.refreshToken).not.toBe("same-old-refresh-token");
  });

  it("grace가 지난 재사용은 상태를 노출하지 않는 동일한 401 오류로 변환한다", async () => {
    const store = {
      rotateMobileRefresh: vi.fn(async () => ({ status: "reuse-detected" })),
    } as unknown as MobileAuthStore;
    const service = new MobileAuthService(
      mobileConfig(),
      {} as Pick<AuthStore, "upsertKakaoUser" | "upsertOAuthUser">,
      store,
      {} as KakaoMobileAuthClientLike,
    );

    await expect(service.refresh("expired-old-refresh-token")).rejects.toMatchObject<MobileAuthError>({
      code: "AUTH_SESSION_INVALID",
    });
  });

  it("카카오 token의 app_id를 검증한 뒤 provider token 대신 CHIMap pair를 발급한다", async () => {
    const store: MobileAuthStore = {
      createMobileSession: vi.fn(async () => undefined),
      findUserByMobileAccess: vi.fn(async () => null),
      rotateMobileRefresh: vi.fn(),
      revokeMobileFamily: vi.fn(async () => undefined),
      storeAppleRefreshCredential: vi.fn(async () => undefined),
      findAppleRefreshCredentialForValidation: vi.fn(async () => null),
      markAppleRefreshCredentialValidated: vi.fn(async () => undefined),
      deleteMobileAccount: vi.fn(async () => ({
        provider: "KAKAO" as const,
        appleRefreshCredential: null,
      })),
    };
    const client: KakaoMobileAuthClientLike = {
      verifyAccessToken: vi.fn(async () => undefined),
      getIdentity: vi.fn(async () => ({
        providerUserId: "1234",
        displayName: "춘식이",
        profileImageUrl: null,
      })),
    };
    const service = new MobileAuthService(
      mobileConfig(),
      {
        upsertKakaoUser: vi.fn(async () => user),
        upsertOAuthUser: vi.fn(async () => user),
      },
      store,
      client,
    );
    const result = await service.loginWithKakao({
      kakaoAccessToken: "provider-access-token-long-enough",
      platform: "ios",
    });

    expect(client.verifyAccessToken).toHaveBeenCalledWith(
      "provider-access-token-long-enough",
      "123456",
    );
    expect(result.accessToken).not.toBe("provider-access-token-long-enough");
    expect(store.createMobileSession).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "ios", userId: user.id }),
    );
  });

  it("같은 family의 access와 refresh가 확인될 때만 계정을 삭제한다", async () => {
    const store = {
      deleteMobileAccount: vi.fn(async () => ({
        provider: "KAKAO" as const,
        appleRefreshCredential: null,
      })),
    } as unknown as MobileAuthStore;
    const service = new MobileAuthService(
      mobileConfig(),
      {} as Pick<AuthStore, "upsertKakaoUser" | "upsertOAuthUser">,
      store,
      {} as KakaoMobileAuthClientLike,
    );

    await service.deleteAccount("access-token", "refresh-token");
    expect(store.deleteMobileAccount).toHaveBeenCalledTimes(1);

    store.deleteMobileAccount.mockResolvedValueOnce(null);
    await expect(
      service.deleteAccount("another-access", "another-refresh"),
    ).rejects.toMatchObject<MobileAuthError>({ code: "AUTH_SESSION_INVALID" });
  });

  it("Apple token의 audience와 nonce를 검증한 identity로 iOS session을 발급한다", async () => {
    const appleUser: AuthUser = { ...user, provider: "APPLE" };
    const identityStore = {
      upsertKakaoUser: vi.fn(async () => user),
      upsertOAuthUser: vi.fn(async () => appleUser),
    };
    let storedAppleCredential: EncryptedRetryTokenPair | undefined;
    const store = {
      createMobileSession: vi.fn(async () => undefined),
      storeAppleRefreshCredential: vi.fn(
        async (_userId: string, credential: EncryptedRetryTokenPair) => {
          storedAppleCredential = credential;
        },
      ),
      deleteMobileAccount: vi.fn(async () => ({
        provider: "APPLE" as const,
        appleRefreshCredential: storedAppleCredential ?? null,
      })),
      rotateMobileRefresh: vi.fn(async (input) => ({
        status: "rotated" as const,
        user: appleUser,
        platform: "ios" as const,
        accessExpiresAt: input.accessExpiresAt,
        refreshExpiresAt: new Date("2026-08-25T03:00:00.000Z"),
      })),
      findAppleRefreshCredentialForValidation: vi.fn(
        async () => storedAppleCredential ?? null,
      ),
      markAppleRefreshCredentialValidated: vi.fn(async () => undefined),
      revokeMobileFamily: vi.fn(async () => undefined),
    } as unknown as MobileAuthStore;
    const appleClient: AppleAuthClientLike = {
      verifyIdentity: vi.fn(async () => ({
        providerUserId: "apple-user",
        displayName: "Apple 사용자",
        profileImageUrl: null,
      })),
      exchangeAuthorizationCode: vi.fn(async () => ({
        refreshToken: "apple-refresh-token",
        identityToken: "exchanged-identity-token",
      })),
      revokeRefreshToken: vi.fn(async () => undefined),
      validateRefreshToken: vi.fn(async () => true),
    };
    const config = loadConfig({
      NODE_ENV: "test",
      KAKAO_REST_API_KEY: "rest-key",
      AUTH_MOBILE_ENABLED: "1",
      KAKAO_APP_ID: "123456",
      APPLE_CLIENT_ID_IOS: "org.madcamp.chimap",
      APPLE_TEAM_ID: "TEAMID1234",
      APPLE_KEY_ID: "KEYID12345",
      APPLE_PRIVATE_KEY_BASE64: applePrivateKey,
      AUTH_REFRESH_RETRY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    });
    const service = new MobileAuthService(
      config,
      identityStore,
      store,
      {} as KakaoMobileAuthClientLike,
      () => new Date("2026-07-26T03:00:00.000Z"),
      appleClient,
    );

    const pair = await service.loginWithApple({
      identityToken: "identity-token-long-enough",
      authorizationCode: "authorization-code",
      nonce: "nonce-value-long-enough",
      displayName: "Apple 사용자",
      platform: "ios",
    });

    expect(pair.user.provider).toBe("APPLE");
    expect(appleClient.verifyIdentity).toHaveBeenNthCalledWith(1, {
      identityToken: "identity-token-long-enough",
      clientId: "org.madcamp.chimap",
      nonce: "nonce-value-long-enough",
      displayName: "Apple 사용자",
    });
    expect(appleClient.verifyIdentity).toHaveBeenNthCalledWith(2, {
      identityToken: "exchanged-identity-token",
      clientId: "org.madcamp.chimap",
      nonce: "nonce-value-long-enough",
      displayName: "Apple 사용자",
    });
    expect(appleClient.exchangeAuthorizationCode).toHaveBeenCalledWith({
      authorizationCode: "authorization-code",
      credentials: config.mobileAuth?.apple,
    });
    expect(store.storeAppleRefreshCredential).toHaveBeenCalledWith(
      appleUser.id,
      expect.objectContaining({
        ciphertext: expect.any(Buffer),
        iv: expect.any(Buffer),
        tag: expect.any(Buffer),
      }),
    );
    expect(store.createMobileSession).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "ios", userId: user.id }),
    );

    await service.refresh("apple-chimap-refresh-token");
    expect(appleClient.validateRefreshToken).toHaveBeenCalledWith({
      refreshToken: "apple-refresh-token",
      credentials: config.mobileAuth?.apple,
    });
    expect(store.markAppleRefreshCredentialValidated).toHaveBeenCalledWith(
      appleUser.id,
    );

    await service.deleteAccount(pair.accessToken, pair.refreshToken);
    expect(appleClient.revokeRefreshToken).toHaveBeenCalledWith({
      refreshToken: "apple-refresh-token",
      credentials: config.mobileAuth?.apple,
    });
    expect(store.deleteMobileAccount).toHaveBeenCalledTimes(1);
  });
});
