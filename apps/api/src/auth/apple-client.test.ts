import { describe, expect, it, vi } from "vitest";

import { AppleAuthClient } from "./apple-client.js";

describe("Apple identity token verification", () => {
  it("검증된 subject와 같은 nonce만 CHIMap identity로 변환한다", async () => {
    const verify = vi.fn(async () => ({
      sub: "apple-user-123",
      nonce: "expected-nonce-value",
    }));
    const client = new AppleAuthClient(verify);

    await expect(
      client.verifyIdentity({
        identityToken: "signed-identity-token",
        clientId: "org.madcamp.chimap",
        nonce: "expected-nonce-value",
        displayName: "사용자",
      }),
    ).resolves.toEqual({
      providerUserId: "apple-user-123",
      displayName: "사용자",
      profileImageUrl: null,
    });
    expect(verify).toHaveBeenCalledWith(
      "signed-identity-token",
      "org.madcamp.chimap",
    );
  });

  it("nonce가 다르면 identity를 거절한다", async () => {
    const client = new AppleAuthClient(async () => ({
      sub: "apple-user-123",
      nonce: "different-nonce",
    }));
    await expect(
      client.verifyIdentity({
        identityToken: "signed-identity-token",
        clientId: "org.madcamp.chimap",
        nonce: "expected-nonce-value",
        displayName: null,
      }),
    ).rejects.toThrow(/claims/u);
  });

  it("authorization code를 server에서 교환하고 refresh token을 철회한다", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "apple-access",
            token_type: "bearer",
            expires_in: 3600,
            refresh_token: "apple-refresh",
            id_token: "exchanged-identity",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "fresh-access",
            token_type: "bearer",
            expires_in: 3600,
            id_token: "fresh-identity",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      );
    const credentials = {
      clientId: "org.madcamp.chimap",
      teamId: "TEAMID1234",
      keyId: "KEYID12345",
      privateKey: "private-key",
    };
    const client = new AppleAuthClient(
      async () => ({}),
      async () => "signed-client-secret",
      fetcher,
    );

    await expect(
      client.exchangeAuthorizationCode({
        authorizationCode: "one-time-code",
        credentials,
      }),
    ).resolves.toEqual({
      refreshToken: "apple-refresh",
      identityToken: "exchanged-identity",
    });
    await client.revokeRefreshToken({ refreshToken: "apple-refresh", credentials });
    await expect(
      client.validateRefreshToken({ refreshToken: "apple-refresh", credentials }),
    ).resolves.toBe(true);
    await expect(
      client.validateRefreshToken({ refreshToken: "revoked-refresh", credentials }),
    ).resolves.toBe(false);

    expect(String(fetcher.mock.calls[0]?.[1]?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(fetcher.mock.calls[1]?.[1]?.body)).toContain(
      "token_type_hint=refresh_token",
    );
    expect(String(fetcher.mock.calls[2]?.[1]?.body)).toContain(
      "grant_type=refresh_token",
    );
  });
});
