import {
  createRemoteJWKSet,
  importPKCS8,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import { z } from "zod";

const appleKeys = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);
const appleTokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.number().int().positive(),
    refresh_token: z.string().min(1),
    id_token: z.string().min(1),
  })
  .passthrough();
const appleRefreshValidationResponseSchema = z
  .object({
    access_token: z.string().min(1),
    token_type: z.string().min(1),
    expires_in: z.number().int().positive(),
    id_token: z.string().min(1),
  })
  .passthrough();
const appleErrorResponseSchema = z
  .object({ error: z.string().min(1) })
  .passthrough();

export type AppleServerCredentials = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
};

export type AppleIdentity = {
  providerUserId: string;
  displayName: string | null;
  profileImageUrl: null;
};

export type AppleAuthClientLike = {
  verifyIdentity(input: {
    identityToken: string;
    clientId: string;
    nonce: string;
    displayName: string | null;
  }): Promise<AppleIdentity>;
  exchangeAuthorizationCode(input: {
    authorizationCode: string;
    credentials: AppleServerCredentials;
  }): Promise<{ refreshToken: string; identityToken: string }>;
  revokeRefreshToken(input: {
    refreshToken: string;
    credentials: AppleServerCredentials;
  }): Promise<void>;
  validateRefreshToken(input: {
    refreshToken: string;
    credentials: AppleServerCredentials;
  }): Promise<boolean>;
};

type VerifyToken = (
  identityToken: string,
  clientId: string,
) => Promise<JWTPayload>;
type CreateClientSecret = (credentials: AppleServerCredentials) => Promise<string>;

const verifyAppleToken: VerifyToken = async (identityToken, clientId) => {
  const result = await jwtVerify(identityToken, appleKeys, {
    algorithms: ["RS256"],
    issuer: "https://appleid.apple.com",
    audience: clientId,
  });
  return result.payload;
};

const createAppleClientSecret: CreateClientSecret = async (credentials) => {
  const key = await importPKCS8(credentials.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: credentials.keyId })
    .setIssuer(credentials.teamId)
    .setSubject(credentials.clientId)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
};

export class AppleAuthClient implements AppleAuthClientLike {
  public constructor(
    private readonly verifyToken: VerifyToken = verifyAppleToken,
    private readonly clientSecret: CreateClientSecret = createAppleClientSecret,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public async verifyIdentity(input: {
    identityToken: string;
    clientId: string;
    nonce: string;
    displayName: string | null;
  }): Promise<AppleIdentity> {
    const payload = await this.verifyToken(input.identityToken, input.clientId);
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.nonce !== input.nonce
    ) {
      throw new Error("Apple identity token claims are invalid.");
    }
    return {
      providerUserId: payload.sub,
      displayName: input.displayName,
      profileImageUrl: null,
    };
  }

  public async exchangeAuthorizationCode(input: {
    authorizationCode: string;
    credentials: AppleServerCredentials;
  }): Promise<{ refreshToken: string; identityToken: string }> {
    const response = await this.fetcher("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({
        client_id: input.credentials.clientId,
        client_secret: await this.clientSecret(input.credentials),
        code: input.authorizationCode,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(`Apple authorization code exchange failed (${response.status}).`);
    }
    const token = appleTokenResponseSchema.parse(await response.json());
    return {
      refreshToken: token.refresh_token,
      identityToken: token.id_token,
    };
  }

  public async revokeRefreshToken(input: {
    refreshToken: string;
    credentials: AppleServerCredentials;
  }): Promise<void> {
    const response = await this.fetcher("https://appleid.apple.com/auth/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({
        client_id: input.credentials.clientId,
        client_secret: await this.clientSecret(input.credentials),
        token: input.refreshToken,
        token_type_hint: "refresh_token",
      }).toString(),
    });
    if (!response.ok) {
      throw new Error(`Apple token revocation failed (${response.status}).`);
    }
  }

  public async validateRefreshToken(input: {
    refreshToken: string;
    credentials: AppleServerCredentials;
  }): Promise<boolean> {
    const response = await this.fetcher("https://appleid.apple.com/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(8_000),
      body: new URLSearchParams({
        client_id: input.credentials.clientId,
        client_secret: await this.clientSecret(input.credentials),
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
      }).toString(),
    });
    const body = (await response.json()) as unknown;
    if (response.ok) {
      appleRefreshValidationResponseSchema.parse(body);
      return true;
    }
    const providerError = appleErrorResponseSchema.safeParse(body);
    if (response.status === 400 && providerError.data?.error === "invalid_grant") {
      return false;
    }
    throw new Error(`Apple refresh token validation failed (${response.status}).`);
  }
}
