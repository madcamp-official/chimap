import type { AuthUser } from "@chimap/contracts";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { AppConfig } from "../config.js";
import type { AuthStore } from "./auth-repository.js";
import {
  KakaoAuthClient,
  type KakaoAuthClientLike,
} from "./kakao-client.js";

const LOGIN_STATE_TTL_SECONDS = 10 * 60;

export class AuthFlowError extends Error {
  public constructor(
    public readonly code:
      | "AUTH_NOT_CONFIGURED"
      | "AUTH_STATE_INVALID"
      | "AUTH_PROVIDER_ERROR",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthFlowError";
  }
}

export type AuthServiceLike = {
  readonly enabled: boolean;
  readonly sessionTtlMilliseconds: number;
  beginWebLogin(): { authorizeUrl: string; stateCookie: string };
  completeWebLogin(input: {
    code: string;
    returnedState: string;
    stateCookie: string | undefined;
  }): Promise<{ user: AuthUser; sessionToken: string }>;
  getSessionUser(sessionToken: string | undefined): Promise<AuthUser | null>;
  logout(sessionToken: string | undefined): Promise<void>;
};

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthService implements AuthServiceLike {
  public readonly enabled: boolean;
  public readonly sessionTtlMilliseconds: number;
  private readonly client: KakaoAuthClientLike | undefined;

  public constructor(
    private readonly config: AppConfig,
    private readonly store: AuthStore,
    client?: KakaoAuthClientLike,
  ) {
    this.enabled = config.kakaoAuth !== undefined;
    this.sessionTtlMilliseconds =
      (config.kakaoAuth?.sessionTtlDays ?? 30) * 24 * 60 * 60 * 1000;
    this.client =
      client ??
      (config.kakaoAuth === undefined
        ? undefined
        : new KakaoAuthClient(config.kakaoAuth));
  }

  public beginWebLogin(): { authorizeUrl: string; stateCookie: string } {
    const authConfig = this.requireConfig();
    const client = this.requireClient();
    const state = randomBytes(32).toString("base64url");
    const issuedAt = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", authConfig.sessionSecret)
      .update(`${state}.${issuedAt}`)
      .digest("base64url");
    return {
      authorizeUrl: client.authorizeUrl(state),
      stateCookie: `${state}.${issuedAt}.${signature}`,
    };
  }

  public async completeWebLogin(input: {
    code: string;
    returnedState: string;
    stateCookie: string | undefined;
  }): Promise<{ user: AuthUser; sessionToken: string }> {
    const authConfig = this.requireConfig();
    const client = this.requireClient();
    if (
      !this.validState(
        input.returnedState,
        input.stateCookie,
        authConfig.sessionSecret,
      )
    ) {
      throw new AuthFlowError(
        "AUTH_STATE_INVALID",
        "로그인 요청이 만료됐어요. 다시 시작해 주세요.",
      );
    }
    try {
      const accessToken = await client.exchangeAuthorizationCode(input.code);
      const identity = await client.getIdentity(accessToken);
      const user = await this.store.upsertKakaoUser(identity);
      const sessionToken = randomBytes(32).toString("base64url");
      await this.store.createSession({
        tokenHash: sessionHash(sessionToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + this.sessionTtlMilliseconds),
      });
      return { user, sessionToken };
    } catch (error) {
      if (error instanceof AuthFlowError) {
        throw error;
      }
      throw new AuthFlowError(
        "AUTH_PROVIDER_ERROR",
        "카카오 로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.",
        { cause: error },
      );
    }
  }

  public async getSessionUser(
    sessionToken: string | undefined,
  ): Promise<AuthUser | null> {
    if (!this.enabled || sessionToken === undefined || sessionToken === "") {
      return null;
    }
    return this.store.findUserBySession(sessionHash(sessionToken));
  }

  public async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken !== undefined && sessionToken !== "") {
      await this.store.revokeSession(sessionHash(sessionToken));
    }
  }

  private requireConfig(): NonNullable<AppConfig["kakaoAuth"]> {
    if (this.config.kakaoAuth === undefined) {
      throw new AuthFlowError(
        "AUTH_NOT_CONFIGURED",
        "카카오 로그인을 준비하고 있어요.",
      );
    }
    return this.config.kakaoAuth;
  }

  private requireClient(): KakaoAuthClientLike {
    if (this.client === undefined) {
      throw new AuthFlowError(
        "AUTH_NOT_CONFIGURED",
        "카카오 로그인을 준비하고 있어요.",
      );
    }
    return this.client;
  }

  private validState(
    returnedState: string,
    cookie: string | undefined,
    secret: string,
  ): boolean {
    if (cookie === undefined) {
      return false;
    }
    const [cookieState, issuedAtText, signature] = cookie.split(".");
    if (
      cookieState === undefined ||
      issuedAtText === undefined ||
      signature === undefined ||
      cookieState !== returnedState
    ) {
      return false;
    }
    const issuedAt = Number(issuedAtText);
    const age = Math.floor(Date.now() / 1000) - issuedAt;
    if (!Number.isInteger(issuedAt) || age < 0 || age > LOGIN_STATE_TTL_SECONDS) {
      return false;
    }
    const expected = createHmac("sha256", secret)
      .update(`${cookieState}.${issuedAtText}`)
      .digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, "base64url");
    } catch {
      return false;
    }
    return (
      provided.length === expected.length && timingSafeEqual(provided, expected)
    );
  }
}
