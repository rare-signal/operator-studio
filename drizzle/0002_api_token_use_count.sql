-- Per-token usage counter on api_tokens. Populated by authorizeRequest on
-- every bearer-authenticated request so admins can see which tokens are
-- actually in use and which are dormant (along with last_used_at).

ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0;
