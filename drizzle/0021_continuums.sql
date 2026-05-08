-- Continuum: fresh-agent handoff for stalled threads.
--
-- A Continuum row is a persisted handoff packet. The user hits
-- "Continuum this thread" on a thread that's about to compact / stall /
-- otherwise become unsafe to keep, and we materialize a digest + a
-- paste-ready resume prompt so a fresh Claude/Codex agent can pick up
-- without inheriting the broken thread's tokens. The source thread is
-- the break-glass — the digest links back to it for when the handoff
-- isn't enough.
--
-- The digest is stored as JSON so the heuristic and (later) LLM-drafted
-- shapes can co-exist without a schema bump. Status starts as "draft"
-- the moment we build it; "published" once the read-only page is
-- generated; "consumed" when a downstream session attaches via the
-- in-app continuation flow (future hook — not wired in v1).
--
-- The source thread reference is intentionally NOT a foreign key —
-- threads can be deleted (or never persisted in the first place, e.g.
-- a Codex thread imported via showcase snapshot), and the Continuum
-- row remains useful as a frozen snapshot even if the source vanishes.

CREATE TABLE IF NOT EXISTS operator_continuums (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Thread the handoff was minted from. Soft reference (no FK) so the
  -- Continuum survives if the source thread is deleted.
  source_thread_id TEXT NOT NULL,
  -- Frozen digest payload — heuristic structure today, room for an
  -- LLM-drafted shape behind a `kind` discriminator inside the JSON.
  digest_json JSONB NOT NULL,
  -- Paste-ready prompt for a fresh agent. Plain text so the user can
  -- copy-paste without escape mishaps.
  resume_prompt TEXT NOT NULL,
  -- draft | published | consumed
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_continuums_workspace
  ON operator_continuums(workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_continuums_source_thread
  ON operator_continuums(workspace_id, source_thread_id);
CREATE INDEX IF NOT EXISTS idx_op_continuums_created_at
  ON operator_continuums(workspace_id, created_at DESC);
