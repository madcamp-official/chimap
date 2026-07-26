import {
  mobileTokenPairSchema,
  type AuthUser,
  type MobileAppleLoginRequest,
  type MobileKakaoLoginRequest,
  type MobileTokenPair,
} from "@chimap/contracts";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { AuthStore } from "./auth-repository.js";
import {
  AppleAuthClient,
  type AppleAuthClientLike,
} from "./apple-client.js";
import {
  type EncryptedRetryTokenPair,
  type MobileAuthStore,
} from "./mobile-auth-repository.js";
import {
  KakaoAuthClient,
  type KakaoMobileAuthClientLike,
} from "./kakao-client.js";

const retryTokenPayloadSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
  })
  .strict();

export class MobileAuthError extends Error {
  public constructor(
    public readonly code:
      | "AUTH_NOT_CONFIGURED"
      | "AUTH_PROVIDER_ERROR"
      | "AUTH_SESSION_INVALID",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MobileAuthError";
  }
}

export type MobileAuthServiceLike = {
  readonly enabled: boolean;
  readonly appleEnabled: boolean;
  loginWithKakao(input: MobileKakaoLoginRequest): Promise<MobileTokenPair>;
  loginWithApple(input: MobileAppleLoginRequest): Promise<MobileTokenPair>;
  refresh(refreshToken: string): Promise<MobileTokenPair>;
  getAccessUser(accessToken: string | undefined): Promise<AuthUser | null>;
  logout(refreshToken: string): Promise<void>;
  deleteAccount(accessToken: string | undefined, refreshToken: string): Promise<void>;
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function encryptRetryPair(
  accessToken: string,
  refreshToken: string,
  key: Buffer,
): EncryptedRetryTokenPair {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(
    JSON.stringify({ accessToken, refreshToken }),
    "utf8",
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptRetryPair(
  encrypted: EncryptedRetryTokenPair,
  key: Buffer,
): { accessToken: string; refreshToken: string } {
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
  decipher.setAuthTag(encrypted.tag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return retryTokenPayloadSchema.parse(JSON.parse(plaintext) as unknown);
}

function encryptSecret(value: string, key: Buffer): EncryptedRetryTokenPair {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(value, "utf8")),
    cipher.final(),
  ]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptSecret(
  encrypted: EncryptedRetryTokenPair,
  key: Buffer,
): string {
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

export class MobileAuthService implements MobileAuthServiceLike {
  public readonly enabled: boolean;
  public readonly appleEnabled: boolean;
  private readonly client: KakaoMobileAuthClientLike | undefined;
  private readonly appleClient: AppleAuthClientLike;

  public constructor(
    private readonly config: AppConfig,
    private readonly identityStore: Pick<
      AuthStore,
      "upsertKakaoUser" | "upsertOAuthUser"
    >,
    private readonly mobileStore: MobileAuthStore,
    client?: KakaoMobileAuthClientLike,
    private readonly clock: () => Date = () => new Date(),
    appleClient: AppleAuthClientLike = new AppleAuthClient(),
  ) {
    this.enabled = config.mobileAuth !== undefined;
    this.appleEnabled = config.mobileAuth?.apple !== undefined;
    this.appleClient = appleClient;
    this.client =
      client ??
      (config.mobileAuth === undefined || config.kakaoRestApiKey === undefined
        ? undefined
        : new KakaoAuthClient({ clientId: config.kakaoRestApiKey }));
  }

  public async loginWithKakao(
    input: MobileKakaoLoginRequest,
  ): Promise<MobileTokenPair> {
    const authConfig = this.requireConfig();
    const client = this.requireClient();
    let identity: Awaited<
      ReturnType<KakaoMobileAuthClientLike["getIdentity"]>
    >;
    try {
      await client.verifyAccessToken(
        input.kakaoAccessToken,
        authConfig.kakaoAppId,
      );
      identity = await client.getIdentity(input.kakaoAccessToken);
    } catch (error) {
      if (error instanceof MobileAuthError) {
        throw error;
      }
      throw new MobileAuthError(
        "AUTH_PROVIDER_ERROR",
        "카카오 모바일 로그인을 완료하지 못했습니다.",
        { cause: error },
      );
    }
    const user = await this.identityStore.upsertKakaoUser(identity);

    return this.issueMobilePair(user, input.platform);
  }

  public async loginWithApple(
    input: MobileAppleLoginRequest,
  ): Promise<MobileTokenPair> {
    const authConfig = this.requireConfig();
    if (authConfig.apple === undefined) {
      throw new MobileAuthError(
        "AUTH_NOT_CONFIGURED",
        "Apple 로그인을 준비하고 있습니다.",
      );
    }
    let identity: Awaited<ReturnType<AppleAuthClientLike["verifyIdentity"]>>;
    let appleRefreshToken: string;
    try {
      identity = await this.appleClient.verifyIdentity({
        identityToken: input.identityToken,
        clientId: authConfig.apple.clientId,
        nonce: input.nonce,
        displayName: input.displayName,
      });
      const exchanged = await this.appleClient.exchangeAuthorizationCode({
        authorizationCode: input.authorizationCode,
        credentials: authConfig.apple,
      });
      const exchangedIdentity = await this.appleClient.verifyIdentity({
        identityToken: exchanged.identityToken,
        clientId: authConfig.apple.clientId,
        nonce: input.nonce,
        displayName: input.displayName,
      });
      if (exchangedIdentity.providerUserId !== identity.providerUserId) {
        throw new Error("Apple authorization code identity does not match.");
      }
      appleRefreshToken = exchanged.refreshToken;
    } catch (error) {
      throw new MobileAuthError(
        "AUTH_PROVIDER_ERROR",
        "Apple 로그인을 완료하지 못했습니다.",
        { cause: error },
      );
    }
    const user = await this.identityStore.upsertOAuthUser({
      provider: "APPLE",
      ...identity,
    });
    await this.mobileStore.storeAppleRefreshCredential(
      user.id,
      encryptSecret(appleRefreshToken, authConfig.retryEncryptionKey),
    );
    return this.issueMobilePair(user, "ios");
  }

  private async issueMobilePair(
    user: AuthUser,
    platform: MobileKakaoLoginRequest["platform"],
  ): Promise<MobileTokenPair> {
    const authConfig = this.requireConfig();
    const now = this.clock();
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const accessExpiresAt = new Date(
      now.getTime() + authConfig.accessTtlMinutes * 60 * 1000,
    );
    const refreshExpiresAt = new Date(
      now.getTime() + authConfig.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    await this.mobileStore.createMobileSession({
      userId: user.id,
      platform,
      familyId: randomUUID(),
      accessTokenHash: tokenHash(accessToken),
      refreshTokenHash: tokenHash(refreshToken),
      accessExpiresAt,
      refreshExpiresAt,
    });
    return this.tokenPair({
      user,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
    });
  }

  public async refresh(refreshToken: string): Promise<MobileTokenPair> {
    const authConfig = this.requireConfig();
    const newAccessToken = opaqueToken();
    const newRefreshToken = opaqueToken();
    const oldRefreshTokenHash = tokenHash(refreshToken);
    const accessExpiresAt = new Date(
      this.clock().getTime() + authConfig.accessTtlMinutes * 60 * 1000,
    );
    const result = await this.mobileStore.rotateMobileRefresh({
      oldRefreshTokenHash,
      newAccessTokenHash: tokenHash(newAccessToken),
      newRefreshTokenHash: tokenHash(newRefreshToken),
      accessExpiresAt,
      graceSeconds: authConfig.graceSeconds,
      encryptedRetryPair: encryptRetryPair(
        newAccessToken,
        newRefreshToken,
        authConfig.retryEncryptionKey,
      ),
    });
    if (result.status === "invalid" || result.status === "reuse-detected") {
      throw new MobileAuthError(
        "AUTH_SESSION_INVALID",
        "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
      );
    }
    let tokens: { accessToken: string; refreshToken: string };
    if (result.status === "rotated") {
      tokens = { accessToken: newAccessToken, refreshToken: newRefreshToken };
    } else {
      try {
        tokens = decryptRetryPair(
          result.encryptedRetryPair,
          authConfig.retryEncryptionKey,
        );
      } catch (error) {
        await this.mobileStore.revokeMobileFamily(oldRefreshTokenHash);
        throw new MobileAuthError(
          "AUTH_SESSION_INVALID",
          "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
          { cause: error },
        );
      }
    }
    await this.validateAppleGrantIfDue(result.user, tokens.refreshToken);
    return this.tokenPair({
      user: result.user,
      ...tokens,
      accessExpiresAt: result.accessExpiresAt,
      refreshExpiresAt: result.refreshExpiresAt,
    });
  }

  private async validateAppleGrantIfDue(
    user: AuthUser,
    currentRefreshToken: string,
  ): Promise<void> {
    const appleConfig = this.config.mobileAuth?.apple;
    if (user.provider !== "APPLE" || appleConfig === undefined) {
      return;
    }
    const credential =
      await this.mobileStore.findAppleRefreshCredentialForValidation(user.id);
    if (credential === null) {
      return;
    }
    let appleRefreshToken: string;
    try {
      appleRefreshToken = decryptSecret(
        credential,
        this.requireConfig().retryEncryptionKey,
      );
    } catch (error) {
      await this.mobileStore.revokeMobileFamily(tokenHash(currentRefreshToken));
      throw new MobileAuthError(
        "AUTH_SESSION_INVALID",
        "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
        { cause: error },
      );
    }
    let valid: boolean;
    try {
      valid = await this.appleClient.validateRefreshToken({
        refreshToken: appleRefreshToken,
        credentials: appleConfig,
      });
    } catch {
      // Provider 일시 장애에는 기존 CHIMap session을 유지하고 다음 refresh에서 재시도한다.
      return;
    }
    if (!valid) {
      await this.mobileStore.revokeMobileFamily(tokenHash(currentRefreshToken));
      throw new MobileAuthError(
        "AUTH_SESSION_INVALID",
        "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
      );
    }
    await this.mobileStore.markAppleRefreshCredentialValidated(user.id);
  }

  public async getAccessUser(
    accessToken: string | undefined,
  ): Promise<AuthUser | null> {
    if (!this.enabled || accessToken === undefined || accessToken.length === 0) {
      return null;
    }
    return this.mobileStore.findUserByMobileAccess(tokenHash(accessToken));
  }

  public async logout(refreshToken: string): Promise<void> {
    this.requireConfig();
    await this.mobileStore.revokeMobileFamily(tokenHash(refreshToken));
  }

  public async deleteAccount(
    accessToken: string | undefined,
    refreshToken: string,
  ): Promise<void> {
    this.requireConfig();
    if (accessToken === undefined) {
      throw new MobileAuthError(
        "AUTH_SESSION_INVALID",
        "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
      );
    }
    const accessTokenHash = tokenHash(accessToken);
    const refreshTokenHash = tokenHash(refreshToken);
    const account = await this.mobileStore.deleteMobileAccount(
      accessTokenHash,
      refreshTokenHash,
    );
    if (account === null) {
      throw new MobileAuthError(
        "AUTH_SESSION_INVALID",
        "모바일 세션이 유효하지 않습니다. 다시 로그인해 주세요.",
      );
    }
    const appleConfig = this.config.mobileAuth?.apple;
    if (
      account.provider === "APPLE" &&
      account.appleRefreshCredential !== null &&
      appleConfig !== undefined
    ) {
      try {
        await this.appleClient.revokeRefreshToken({
          refreshToken: decryptSecret(
            account.appleRefreshCredential,
            this.requireConfig().retryEncryptionKey,
          ),
          credentials: appleConfig,
        });
      } catch {
        // Apple 장애나 이미 철회된 grant가 내부 계정 삭제를 막아서는 안 된다.
      }
    }
  }

  private tokenPair(input: {
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): MobileTokenPair {
    return mobileTokenPairSchema.parse({
      tokenType: "Bearer",
      accessToken: input.accessToken,
      accessExpiresAt: input.accessExpiresAt.toISOString(),
      refreshToken: input.refreshToken,
      refreshExpiresAt: input.refreshExpiresAt.toISOString(),
      user: input.user,
    });
  }

  private requireConfig(): NonNullable<AppConfig["mobileAuth"]> {
    if (this.config.mobileAuth === undefined) {
      throw new MobileAuthError(
        "AUTH_NOT_CONFIGURED",
        "모바일 로그인을 준비하고 있습니다.",
      );
    }
    return this.config.mobileAuth;
  }

  private requireClient(): KakaoMobileAuthClientLike {
    if (this.client === undefined) {
      throw new MobileAuthError(
        "AUTH_NOT_CONFIGURED",
        "모바일 로그인을 준비하고 있습니다.",
      );
    }
    return this.client;
  }
}
