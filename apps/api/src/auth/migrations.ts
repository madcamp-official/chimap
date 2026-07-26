export const AUTH_SESSION_ROTATION_MIGRATION = {
  version: 4,
  name: "mobile_auth_refresh_rotation",
  sql: `
    ALTER TABLE auth_sessions
      ADD COLUMN token_kind varchar(20) NOT NULL DEFAULT 'WEB_SESSION',
      ADD COLUMN client_platform varchar(10) NOT NULL DEFAULT 'web',
      ADD COLUMN family_id uuid,
      ADD COLUMN generation integer NOT NULL DEFAULT 0,
      ADD COLUMN rotated_at timestamptz,
      ADD COLUMN replaced_by_token_hash char(64),
      ADD COLUMN grace_period_expires_at timestamptz,
      ADD COLUMN retry_response_ciphertext bytea,
      ADD COLUMN retry_response_iv bytea,
      ADD COLUMN retry_response_tag bytea,
      ADD COLUMN retry_access_expires_at timestamptz,
      ADD COLUMN revoked_at timestamptz,
      ADD COLUMN revoke_reason varchar(40);

    ALTER TABLE auth_sessions
      ADD CONSTRAINT auth_sessions_token_kind_check
        CHECK (token_kind IN ('WEB_SESSION', 'MOBILE_ACCESS', 'MOBILE_REFRESH')),
      ADD CONSTRAINT auth_sessions_platform_check
        CHECK (client_platform IN ('web', 'ios', 'android')),
      ADD CONSTRAINT auth_sessions_generation_check
        CHECK (generation >= 0),
      ADD CONSTRAINT auth_sessions_mobile_family_check
        CHECK (
          token_kind = 'WEB_SESSION'
          OR (family_id IS NOT NULL AND client_platform IN ('ios', 'android'))
        );

    CREATE INDEX auth_sessions_family_index
      ON auth_sessions(family_id)
      WHERE family_id IS NOT NULL;
    CREATE INDEX auth_sessions_rotated_grace_index
      ON auth_sessions(grace_period_expires_at)
      WHERE rotated_at IS NOT NULL AND retry_response_ciphertext IS NOT NULL;
    CREATE UNIQUE INDEX auth_sessions_family_generation_kind_unique
      ON auth_sessions(family_id, generation, token_kind)
      WHERE family_id IS NOT NULL;
  `,
} as const;

export const AUTH_PROVIDER_EXPANSION_MIGRATION = {
  version: 5,
  name: "apple_auth_provider",
  sql: `
    ALTER TABLE oauth_accounts
      DROP CONSTRAINT IF EXISTS oauth_accounts_provider_check;
    ALTER TABLE oauth_accounts
      ADD CONSTRAINT oauth_accounts_provider_check
        CHECK (provider IN ('KAKAO', 'APPLE'));
  `,
} as const;

export const APPLE_REFRESH_CREDENTIAL_MIGRATION = {
  version: 6,
  name: "apple_refresh_credential",
  sql: `
    ALTER TABLE oauth_accounts
      ADD COLUMN refresh_token_ciphertext bytea,
      ADD COLUMN refresh_token_iv bytea,
      ADD COLUMN refresh_token_tag bytea,
      ADD COLUMN refresh_token_validated_at timestamptz;

    ALTER TABLE oauth_accounts
      ADD CONSTRAINT oauth_accounts_refresh_credential_check
        CHECK (
          (refresh_token_ciphertext IS NULL
            AND refresh_token_iv IS NULL
            AND refresh_token_tag IS NULL
            AND refresh_token_validated_at IS NULL)
          OR
          (provider = 'APPLE'
            AND refresh_token_ciphertext IS NOT NULL
            AND refresh_token_iv IS NOT NULL
            AND refresh_token_tag IS NOT NULL
            AND refresh_token_validated_at IS NOT NULL)
        );
  `,
} as const;
