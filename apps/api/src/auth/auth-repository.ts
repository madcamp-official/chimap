import type { AuthUser } from "@chimap/contracts";
import { randomUUID } from "node:crypto";
import type pg from "pg";

export type KakaoIdentity = {
  providerUserId: string;
  displayName: string | null;
  profileImageUrl: string | null;
};

export type AuthStore = {
  upsertKakaoUser(identity: KakaoIdentity): Promise<AuthUser>;
  createSession(input: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  findUserBySession(tokenHash: string): Promise<AuthUser | null>;
  revokeSession(tokenHash: string): Promise<void>;
};

type AuthUserRow = {
  id: string;
  display_name: string | null;
  profile_image_url: string | null;
};

function rowToAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    provider: "KAKAO",
    displayName: row.display_name,
    profileImageUrl: row.profile_image_url,
  };
}

export class AuthRepository implements AuthStore {
  public constructor(private readonly pool: pg.Pool) {}

  public async upsertKakaoUser(identity: KakaoIdentity): Promise<AuthUser> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`KAKAO:${identity.providerUserId}`],
      );
      const existing = await client.query<AuthUserRow>(
        `SELECT users.id, users.display_name, users.profile_image_url
         FROM oauth_accounts AS accounts
         JOIN app_users AS users ON users.id = accounts.user_id
         WHERE accounts.provider = 'KAKAO'
           AND accounts.provider_user_id = $1
         FOR UPDATE OF users, accounts`,
        [identity.providerUserId],
      );

      let user: AuthUser;
      if (existing.rowCount === 1 && existing.rows[0] !== undefined) {
        const updated = await client.query<AuthUserRow>(
          `UPDATE app_users
           SET display_name = $2,
               profile_image_url = $3,
               updated_at = now(),
               last_login_at = now()
           WHERE id = $1
           RETURNING id, display_name, profile_image_url`,
          [
            existing.rows[0].id,
            identity.displayName,
            identity.profileImageUrl,
          ],
        );
        await client.query(
          `UPDATE oauth_accounts
           SET updated_at = now()
           WHERE provider = 'KAKAO' AND provider_user_id = $1`,
          [identity.providerUserId],
        );
        user = rowToAuthUser(updated.rows[0] as AuthUserRow);
      } else {
        const userId = randomUUID();
        const inserted = await client.query<AuthUserRow>(
          `INSERT INTO app_users(
             id, display_name, profile_image_url,
             created_at, updated_at, last_login_at
           ) VALUES ($1, $2, $3, now(), now(), now())
           RETURNING id, display_name, profile_image_url`,
          [userId, identity.displayName, identity.profileImageUrl],
        );
        await client.query(
          `INSERT INTO oauth_accounts(
             provider, provider_user_id, user_id, created_at, updated_at
           ) VALUES ('KAKAO', $1, $2, now(), now())`,
          [identity.providerUserId, userId],
        );
        user = rowToAuthUser(inserted.rows[0] as AuthUserRow);
      }
      await client.query("COMMIT");
      return user;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async createSession(input: {
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions(
         token_hash, user_id, created_at, last_seen_at, expires_at
       ) VALUES ($1, $2, now(), now(), $3)`,
      [input.tokenHash, input.userId, input.expiresAt],
    );
    await this.pool.query(
      "DELETE FROM auth_sessions WHERE expires_at <= now()",
    );
  }

  public async findUserBySession(tokenHash: string): Promise<AuthUser | null> {
    const result = await this.pool.query<AuthUserRow>(
      `SELECT users.id, users.display_name, users.profile_image_url
       FROM auth_sessions AS sessions
       JOIN app_users AS users ON users.id = sessions.user_id
       JOIN oauth_accounts AS accounts
         ON accounts.user_id = users.id AND accounts.provider = 'KAKAO'
       WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`,
      [tokenHash],
    );
    if (result.rowCount !== 1 || result.rows[0] === undefined) {
      await this.pool.query(
        "DELETE FROM auth_sessions WHERE token_hash = $1 AND expires_at <= now()",
        [tokenHash],
      );
      return null;
    }
    await this.pool.query(
      `UPDATE auth_sessions
       SET last_seen_at = now()
       WHERE token_hash = $1
         AND last_seen_at < now() - interval '1 hour'`,
      [tokenHash],
    );
    return rowToAuthUser(result.rows[0]);
  }

  public async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(
      "DELETE FROM auth_sessions WHERE token_hash = $1",
      [tokenHash],
    );
  }
}
