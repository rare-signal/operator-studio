-- Per-device bearer tokens + audit log for the beta phone surface.
--
-- Replaces the single shared OPERATOR_STUDIO_BETA_TOKEN env var as
-- the only auth source. The env var stays valid as a "legacy-env"
-- identity so existing pinned phones don't break mid-rollout — see
-- app/api/beta/_device-tokens.ts.
--
-- Plaintext tokens are NEVER stored. We sha256-hash on mint, store
-- the hash, and look up by hash on every request. The plaintext is
-- printed exactly once by the CLI (`pnpm beta:devices add`).
--
-- Lookups index on token_hash (UNIQUE). Audit log indexes on
-- (device_id, created_at DESC) for "show me recent activity for this
-- device" and (created_at DESC) for "show me the global tail."

CREATE TABLE IF NOT EXISTS beta_device_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_beta_device_tokens_token_hash
  ON beta_device_tokens(token_hash);

-- Audit log of every auth attempt against /api/beta/*. Rolling
-- forensic trail for spotting brute-force attempts, revoked-token
-- reuse, etc.
--
-- device_id is null when the presented token didn't match any row
-- (and the env-var fallback didn't accept it either) — outcome
-- column disambiguates: invalid | revoked | expired | missing |
-- legacy-env | ok.

CREATE TABLE IF NOT EXISTS beta_auth_log (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES beta_device_tokens(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,
  outcome TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_beta_auth_log_device
  ON beta_auth_log(device_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_beta_auth_log_created
  ON beta_auth_log(created_at DESC);
