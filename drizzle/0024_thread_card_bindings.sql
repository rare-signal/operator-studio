-- Durable worker-thread → plan-card bindings.
--
-- Today the Operations desk derives card→thread links from two
-- ephemeral signals: a tail-sniff over recent JSONL turns, and a
-- localStorage map maintained by the Bento UI. Both are useful but
-- neither survives across browsers, machines, or server restarts.
--
-- This table records the binding the moment Operator Studio launches
-- (or the operator manually attaches) a Claude/Codex worker against a
-- plan card, so the provenance spine
--   lane → plan card → worker thread → message/passage → covered
-- has a server-side anchor instead of a UI hint.
--
-- Append-friendly, idempotent on (workspace, agent_id):
--   - The same agent rebinding to a different card replaces the row;
--     there is one active binding per agent at a time.
--   - source records *how* we learned the binding so Operations can
--     prefer launch > manual > tail-sniff > scheduled when displaying.
--   - related_plan_step_id is intentionally NOT a foreign key: the
--     plan-step table soft-deletes (deleted_at) and we don't want
--     binding writes to fail because a card was trashed mid-session.

CREATE TABLE IF NOT EXISTS operator_thread_card_bindings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Composite agent id, e.g. `claude:7b315fae-…`, `codex:rollout-…`,
  -- `tmux:<session>`. Same shape used elsewhere in the agent bridge.
  agent_id TEXT NOT NULL,
  -- claude | codex | tmux (free-form for forward-compat).
  agent_kind TEXT NOT NULL,

  plan_step_id TEXT NOT NULL,
  -- Denormalized for cheap lookups; the step's plan rarely moves.
  plan_id TEXT,

  -- launch | manual | tail-sniff | scheduled.
  source TEXT NOT NULL,
  -- 0..1, optional. Reserved for future agent-curated bindings.
  confidence DOUBLE PRECISION,
  -- Free-form provenance: launch route id, recommendation id, the
  -- card description prefix used by tail-sniff, etc.
  rationale TEXT,
  -- The recommendation/route that produced this binding, if any.
  source_recommendation_id TEXT,

  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  -- Soft-detach: setting detached_at preserves the historical binding
  -- while keeping it out of "current" reads.
  detached_at TIMESTAMPTZ
);

-- One active binding per agent per workspace. Detached rows are
-- excluded so an agent can be re-bound to a new card without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_op_thread_bindings_unique_active
  ON operator_thread_card_bindings(workspace_id, agent_id)
  WHERE detached_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_op_thread_bindings_step
  ON operator_thread_card_bindings(workspace_id, plan_step_id)
  WHERE detached_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_op_thread_bindings_workspace
  ON operator_thread_card_bindings(workspace_id);
