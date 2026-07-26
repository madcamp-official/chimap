import type {
  AuthProvider,
  AuthUser,
  MobilePlatform,
} from "@chimap/contracts";
import type pg from "pg";

export type EncryptedRetryTokenPair = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
};

export type MobileSessionIssue = {
  userId: string;
  platform: MobilePlatform;
  familyId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

export type MobileRefreshRotation = {
  oldRefreshTokenHash: string;
  newAccessTokenHash: string;
  newRefreshTokenHash: string;
  accessExpiresAt: Date;
  graceSeconds: number;
  encryptedRetryPair: EncryptedRetryTokenPair;
};

export type MobileRefreshResult =
  | {
      status: "rotated";
      user: AuthUser;
      platform: MobilePlatform;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
    }
  | {
      status: "replayed";
      user: AuthUser;
      platform: MobilePlatform;
      accessExpiresAt: Date;
      refreshExpiresAt: Date;
      encryptedRetryPair: EncryptedRetryTokenPair;
    }
  | { status: "invalid" }
  | { status: "reuse-detected" };

export type MobileAccountDeletionContext = {
  provider: AuthProvider;
  appleRefreshCredential: EncryptedRetryTokenPair | null;
};

export type MobileAuthStore = {
  createMobileSession(input: MobileSessionIssue): Promise<void>;
  findUserByMobileAccess(tokenHash: string): Promise<AuthUser | null>;
  rotateMobileRefresh(input: MobileRefreshRotation): Promise<MobileRefreshResult>;
  revokeMobileFamily(refreshTokenHash: string): Promise<void>;
  storeAppleRefreshCredential(
    userId: string,
    credential: EncryptedRetryTokenPair,
  ): Promise<void>;
  findAppleRefreshCredentialForValidation(
    userId: string,
  ): Promise<EncryptedRetryTokenPair | null>;
  markAppleRefreshCredentialValidated(userId: string): Promise<void>;
  deleteMobileAccount(
    accessTokenHash: string,
    refreshTokenHash: string,
  ): Promise<MobileAccountDeletionContext | null>;
};

type MobileSessionRow = {
  user_id: string;
  display_name: string | null;
  profile_image_url: string | null;
  provider: AuthProvider;
  client_platform: MobilePlatform;
  family_id: string;
  generation: number;
  expires_at: Date;
  rotated_at: Date | null;
  grace_period_expires_at: Date | null;
  retry_response_ciphertext: Buffer | null;
  retry_response_iv: Buffer | null;
  retry_response_tag: Buffer | null;
  retry_access_expires_at: Date | null;
  revoked_at: Date | null;
  is_unexpired: boolean;
  within_grace: boolean;
};

type AuthUserRow = Pick<
  MobileSessionRow,
  "user_id" | "display_name" | "profile_image_url"
> & { provider: AuthProvider };

function rowToUser(row: AuthUserRow): AuthUser {
  return {
    id: row.user_id,
    provider: row.provider,
    displayName: row.display_name,
    profileImageUrl: row.profile_image_url,
  };
}

export class MobileAuthRepository implements MobileAuthStore {
  public constructor(private readonly pool: pg.Pool) {}

  public async createMobileSession(input: MobileSessionIssue): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO auth_sessions(
           token_hash, user_id, created_at, last_seen_at, expires_at,
           token_kind, client_platform, family_id, generation
         ) VALUES
           ($1, $2, now(), now(), $3, 'MOBILE_ACCESS', $5, $6, 0),
           ($4, $2, now(), now(), $7, 'MOBILE_REFRESH', $5, $6, 0)`,
        [
          input.accessTokenHash,
          input.userId,
          input.accessExpiresAt,
          input.refreshTokenHash,
          input.platform,
          input.familyId,
          input.refreshExpiresAt,
        ],
      );
      await client.query(
        `UPDATE auth_sessions
         SET retry_response_ciphertext = NULL,
             retry_response_iv = NULL,
             retry_response_tag = NULL
         WHERE grace_period_expires_at < now()
           AND retry_response_ciphertext IS NOT NULL`,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async findUserByMobileAccess(tokenHash: string): Promise<AuthUser | null> {
    const result = await this.pool.query<AuthUserRow>(
      `SELECT sessions.user_id, users.display_name, users.profile_image_url,
              accounts.provider
       FROM auth_sessions AS sessions
       JOIN app_users AS users ON users.id = sessions.user_id
       JOIN oauth_accounts AS accounts ON accounts.user_id = sessions.user_id
       WHERE sessions.token_hash = $1
         AND sessions.token_kind = 'MOBILE_ACCESS'
         AND sessions.revoked_at IS NULL
         AND sessions.expires_at > now()`,
      [tokenHash],
    );
    if (result.rowCount !== 1 || result.rows[0] === undefined) {
      return null;
    }
    await this.pool.query(
      `UPDATE auth_sessions
       SET last_seen_at = now()
       WHERE token_hash = $1
         AND last_seen_at < now() - interval '5 minutes'`,
      [tokenHash],
    );
    return rowToUser(result.rows[0]);
  }

  public async rotateMobileRefresh(
    input: MobileRefreshRotation,
  ): Promise<MobileRefreshResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE auth_sessions
         SET retry_response_ciphertext = NULL,
             retry_response_iv = NULL,
             retry_response_tag = NULL
         WHERE grace_period_expires_at < now()
           AND retry_response_ciphertext IS NOT NULL`,
      );
      const selected = await client.query<MobileSessionRow>(
        `SELECT
           sessions.user_id,
           users.display_name,
           users.profile_image_url,
           accounts.provider,
           sessions.client_platform,
           sessions.family_id,
           sessions.generation,
           sessions.expires_at,
           sessions.rotated_at,
           sessions.grace_period_expires_at,
           sessions.retry_response_ciphertext,
           sessions.retry_response_iv,
           sessions.retry_response_tag,
           sessions.retry_access_expires_at,
           sessions.revoked_at,
           sessions.expires_at > now() AS is_unexpired,
           sessions.grace_period_expires_at >= now() AS within_grace
         FROM auth_sessions AS sessions
         JOIN app_users AS users ON users.id = sessions.user_id
         JOIN oauth_accounts AS accounts ON accounts.user_id = sessions.user_id
         WHERE sessions.token_hash = $1
           AND sessions.token_kind = 'MOBILE_REFRESH'
         FOR UPDATE OF sessions`,
        [input.oldRefreshTokenHash],
      );
      const row = selected.rows[0];
      if (selected.rowCount !== 1 || row === undefined || row.revoked_at !== null) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }
      if (!row.is_unexpired) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }
      if (row.rotated_at !== null) {
        if (
          row.within_grace &&
          row.retry_response_ciphertext !== null &&
          row.retry_response_iv !== null &&
          row.retry_response_tag !== null &&
          row.retry_access_expires_at !== null
        ) {
          await client.query("COMMIT");
          return {
            status: "replayed",
            user: rowToUser(row),
            platform: row.client_platform,
            accessExpiresAt: row.retry_access_expires_at,
            refreshExpiresAt: row.expires_at,
            encryptedRetryPair: {
              ciphertext: row.retry_response_ciphertext,
              iv: row.retry_response_iv,
              tag: row.retry_response_tag,
            },
          };
        }
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = COALESCE(revoked_at, now()),
               revoke_reason = COALESCE(revoke_reason, 'REFRESH_REUSE'),
               retry_response_ciphertext = NULL,
               retry_response_iv = NULL,
               retry_response_tag = NULL
           WHERE family_id = $1`,
          [row.family_id],
        );
        await client.query("COMMIT");
        return { status: "reuse-detected" };
      }

      const nextGeneration = row.generation + 1;
      await client.query(
        `INSERT INTO auth_sessions(
           token_hash, user_id, created_at, last_seen_at, expires_at,
           token_kind, client_platform, family_id, generation
         ) VALUES
           ($1, $3, now(), now(), $4, 'MOBILE_ACCESS', $5, $6, $7),
           ($2, $3, now(), now(), $8, 'MOBILE_REFRESH', $5, $6, $7)`,
        [
          input.newAccessTokenHash,
          input.newRefreshTokenHash,
          row.user_id,
          input.accessExpiresAt,
          row.client_platform,
          row.family_id,
          nextGeneration,
          row.expires_at,
        ],
      );
      await client.query(
        `UPDATE auth_sessions
         SET rotated_at = now(),
             replaced_by_token_hash = $2,
             grace_period_expires_at = now() + ($3 * interval '1 second'),
             retry_response_ciphertext = $4,
             retry_response_iv = $5,
             retry_response_tag = $6,
             retry_access_expires_at = $7,
             last_seen_at = now()
         WHERE token_hash = $1`,
        [
          input.oldRefreshTokenHash,
          input.newRefreshTokenHash,
          input.graceSeconds,
          input.encryptedRetryPair.ciphertext,
          input.encryptedRetryPair.iv,
          input.encryptedRetryPair.tag,
          input.accessExpiresAt,
        ],
      );
      await client.query("COMMIT");
      return {
        status: "rotated",
        user: rowToUser(row),
        platform: row.client_platform,
        accessExpiresAt: input.accessExpiresAt,
        refreshExpiresAt: row.expires_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async revokeMobileFamily(refreshTokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_sessions
       SET revoked_at = COALESCE(revoked_at, now()),
           revoke_reason = COALESCE(revoke_reason, 'LOGOUT'),
           retry_response_ciphertext = NULL,
           retry_response_iv = NULL,
           retry_response_tag = NULL
       WHERE family_id = (
         SELECT family_id
         FROM auth_sessions
         WHERE token_hash = $1 AND token_kind = 'MOBILE_REFRESH'
       )`,
      [refreshTokenHash],
    );
  }

  public async storeAppleRefreshCredential(
    userId: string,
    credential: EncryptedRetryTokenPair,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE oauth_accounts
       SET refresh_token_ciphertext = $2,
           refresh_token_iv = $3,
           refresh_token_tag = $4,
           refresh_token_validated_at = now(),
           updated_at = now()
       WHERE user_id = $1 AND provider = 'APPLE'`,
      [userId, credential.ciphertext, credential.iv, credential.tag],
    );
    if (result.rowCount !== 1) {
      throw new Error("Apple OAuth account was not found.");
    }
  }

  public async findAppleRefreshCredentialForValidation(
    userId: string,
  ): Promise<EncryptedRetryTokenPair | null> {
    const result = await this.pool.query<{
      refresh_token_ciphertext: Buffer;
      refresh_token_iv: Buffer;
      refresh_token_tag: Buffer;
    }>(
      `SELECT refresh_token_ciphertext, refresh_token_iv, refresh_token_tag
       FROM oauth_accounts
       WHERE user_id = $1
         AND provider = 'APPLE'
         AND refresh_token_ciphertext IS NOT NULL
         AND refresh_token_iv IS NOT NULL
         AND refresh_token_tag IS NOT NULL
         AND refresh_token_validated_at < now() - interval '24 hours'`,
      [userId],
    );
    const row = result.rows[0];
    return result.rowCount !== 1 || row === undefined
      ? null
      : {
          ciphertext: row.refresh_token_ciphertext,
          iv: row.refresh_token_iv,
          tag: row.refresh_token_tag,
        };
  }

  public async markAppleRefreshCredentialValidated(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE oauth_accounts
       SET refresh_token_validated_at = now(), updated_at = now()
       WHERE user_id = $1 AND provider = 'APPLE'`,
      [userId],
    );
  }

  public async deleteMobileAccount(
    accessTokenHash: string,
    refreshTokenHash: string,
  ): Promise<MobileAccountDeletionContext | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query<{
        user_id: string;
        provider: AuthProvider;
        refresh_token_ciphertext: Buffer | null;
        refresh_token_iv: Buffer | null;
        refresh_token_tag: Buffer | null;
      }>(
        `SELECT access.user_id,
                accounts.provider,
                accounts.refresh_token_ciphertext,
                accounts.refresh_token_iv,
                accounts.refresh_token_tag
         FROM auth_sessions AS access
         JOIN auth_sessions AS refresh
           ON refresh.user_id = access.user_id
          AND refresh.family_id = access.family_id
         JOIN oauth_accounts AS accounts ON accounts.user_id = access.user_id
         WHERE access.token_hash = $1
           AND access.token_kind = 'MOBILE_ACCESS'
           AND access.revoked_at IS NULL
           AND access.expires_at > now()
           AND refresh.token_hash = $2
           AND refresh.token_kind = 'MOBILE_REFRESH'
           AND refresh.revoked_at IS NULL
           AND refresh.expires_at > now()
         FOR UPDATE OF access, refresh, accounts`,
        [accessTokenHash, refreshTokenHash],
      );
      const account = selected.rows[0];
      if (selected.rowCount !== 1 || account === undefined) {
        await client.query("ROLLBACK");
        return null;
      }
      const deleted = await client.query(
        "DELETE FROM app_users WHERE id = $1",
        [account.user_id],
      );
      if (deleted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("COMMIT");
      const hasCredential =
        account.refresh_token_ciphertext !== null &&
        account.refresh_token_iv !== null &&
        account.refresh_token_tag !== null;
      return {
        provider: account.provider,
        appleRefreshCredential: hasCredential
          ? {
              ciphertext: account.refresh_token_ciphertext as Buffer,
              iv: account.refresh_token_iv as Buffer,
              tag: account.refresh_token_tag as Buffer,
            }
          : null,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
