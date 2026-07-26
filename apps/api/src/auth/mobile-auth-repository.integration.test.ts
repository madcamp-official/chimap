import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TransitRepository } from "../transit/transit-repository.js";
import { AuthRepository } from "./auth-repository.js";
import { MobileAuthRepository } from "./mobile-auth-repository.js";

const databaseUrl = process.env.DATABASE_TEST_URL;

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe.skipIf(databaseUrl === undefined)(
  "모바일 refresh rotation PostgreSQL 통합",
  () => {
    it("grace 안에는 동일 pair를 재생하고 grace 뒤에는 family 전체를 폐기한다", async () => {
      const transitRepository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      const userId = randomUUID();
      const familyId = randomUUID();
      const oldRefreshHash = hash("old-refresh");
      try {
        await transitRepository.migrate();
        await transitRepository.pool.query(
          `INSERT INTO app_users(id, display_name)
           VALUES ($1, 'rotation-test')`,
          [userId],
        );
        await transitRepository.pool.query(
          `INSERT INTO oauth_accounts(provider, provider_user_id, user_id)
           VALUES ('KAKAO', $1, $2)`,
          [`rotation-${userId}`, userId],
        );
        const repository = new MobileAuthRepository(transitRepository.pool);
        const webRepository = new AuthRepository(transitRepository.pool);
        const webTokenHash = hash("independent-web-session");
        await webRepository.createSession({
          tokenHash: webTokenHash,
          userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        });
        await repository.createMobileSession({
          userId,
          platform: "android",
          familyId,
          accessTokenHash: hash("old-access"),
          refreshTokenHash: oldRefreshHash,
          accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
        const encryptedRetryPair = {
          ciphertext: Buffer.from("encrypted-pair"),
          iv: Buffer.alloc(12, 1),
          tag: Buffer.alloc(16, 2),
        };
        const rotation = {
          oldRefreshTokenHash: oldRefreshHash,
          newAccessTokenHash: hash("new-access"),
          newRefreshTokenHash: hash("new-refresh"),
          accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          graceSeconds: 120,
          encryptedRetryPair,
        };
        const competingRotation = {
          ...rotation,
          newAccessTokenHash: hash("competing-access"),
          newRefreshTokenHash: hash("competing-refresh"),
          encryptedRetryPair: {
            ciphertext: Buffer.from("competing-encrypted-pair"),
            iv: Buffer.alloc(12, 3),
            tag: Buffer.alloc(16, 4),
          },
        };

        const concurrent = await Promise.all([
          repository.rotateMobileRefresh(rotation),
          repository.rotateMobileRefresh(competingRotation),
        ]);
        expect(concurrent.map((result) => result.status).sort()).toEqual([
          "replayed",
          "rotated",
        ]);
        await expect(repository.rotateMobileRefresh(rotation)).resolves.toMatchObject({
          status: "replayed",
        });

        await transitRepository.pool.query(
          `UPDATE auth_sessions
           SET grace_period_expires_at = now() - interval '1 second'
           WHERE token_hash = $1`,
          [oldRefreshHash],
        );
        await expect(repository.rotateMobileRefresh(rotation)).resolves.toEqual({
          status: "reuse-detected",
        });
        const revoked = await transitRepository.pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM auth_sessions
           WHERE family_id = $1 AND revoked_at IS NOT NULL`,
          [familyId],
        );
        expect(Number(revoked.rows[0]?.count)).toBe(4);
        await expect(
          repository.findUserByMobileAccess(hash("new-access")),
        ).resolves.toBeNull();
        await expect(webRepository.findUserBySession(webTokenHash)).resolves.toMatchObject({
          id: userId,
        });
        await expect(
          webRepository.findUserBySession(hash("new-access")),
        ).resolves.toBeNull();
      } finally {
        await transitRepository.pool.query(
          "DELETE FROM app_users WHERE id = $1",
          [userId],
        ).catch(() => undefined);
        await transitRepository.close();
      }
    });

    it("Apple account 삭제가 암호화 credential을 반환하고 모든 session을 cascade한다", async () => {
      const transitRepository = new TransitRepository({
        url: databaseUrl!,
        poolMax: 2,
        connectTimeoutMs: 3000,
        statementTimeoutMs: 5000,
        sslMode: "disable",
      });
      const userId = randomUUID();
      const accessTokenHash = hash("apple-access");
      const refreshTokenHash = hash("apple-refresh");
      try {
        await transitRepository.migrate();
        await transitRepository.pool.query(
          `INSERT INTO app_users(id, display_name)
           VALUES ($1, 'apple-delete-test')`,
          [userId],
        );
        await transitRepository.pool.query(
          `INSERT INTO oauth_accounts(provider, provider_user_id, user_id)
           VALUES ('APPLE', $1, $2)`,
          [`apple-${userId}`, userId],
        );
        const repository = new MobileAuthRepository(transitRepository.pool);
        const encrypted = {
          ciphertext: Buffer.from("encrypted-apple-refresh"),
          iv: Buffer.alloc(12, 5),
          tag: Buffer.alloc(16, 6),
        };
        await repository.storeAppleRefreshCredential(userId, encrypted);
        await repository.createMobileSession({
          userId,
          platform: "ios",
          familyId: randomUUID(),
          accessTokenHash,
          refreshTokenHash,
          accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
          refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        await expect(
          repository.deleteMobileAccount(accessTokenHash, refreshTokenHash),
        ).resolves.toEqual({
          provider: "APPLE",
          appleRefreshCredential: encrypted,
        });
        const counts = await transitRepository.pool.query<{
          users: string;
          accounts: string;
          sessions: string;
        }>(
          `SELECT
             (SELECT COUNT(*) FROM app_users WHERE id = $1)::text AS users,
             (SELECT COUNT(*) FROM oauth_accounts WHERE user_id = $1)::text AS accounts,
             (SELECT COUNT(*) FROM auth_sessions WHERE user_id = $1)::text AS sessions`,
          [userId],
        );
        expect(counts.rows[0]).toEqual({ users: "0", accounts: "0", sessions: "0" });
      } finally {
        await transitRepository.pool.query(
          "DELETE FROM app_users WHERE id = $1",
          [userId],
        ).catch(() => undefined);
        await transitRepository.close();
      }
    });
  },
);
