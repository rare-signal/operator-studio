-- Step fulfillments: the join between a plan step (inside a session's
-- plan_steps jsonb) and the threads/messages that fulfill it.
--
-- Why a separate table:
-- - Many-to-many in both directions: a message can fulfill multiple
--   steps (e.g. "this message both answered step 1 AND step 2"), and a
--   step can be fulfilled by many threads/messages.
-- - Needs to be queryable both ways: "what fulfills step X" and "what
--   does thread T fulfill."
-- - Independent of session lifecycle timestamps — a fulfillment has
--   its own promoted_at and promoted_by.
--
-- Uniqueness: (session_id, step_id, target_type, target_id) — the same
-- target can't be promoted twice to the same step. Toggle = delete.
--
-- No FK to plan_steps because plan_steps lives in jsonb. Orphaned
-- fulfillments (step deleted) are cleaned up by the UI when the plan
-- editor removes a step.

CREATE TABLE IF NOT EXISTS operator_step_fulfillments (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id       TEXT NOT NULL REFERENCES operator_sessions(id) ON DELETE CASCADE,
  step_id          TEXT NOT NULL,
  target_type      TEXT NOT NULL,  -- 'thread' | 'message'
  target_id        TEXT NOT NULL,
  note             TEXT,
  promoted_by      TEXT NOT NULL,
  promoted_at      TIMESTAMPTZ NOT NULL
);

-- Uniqueness + fast lookup by (session, step).
CREATE UNIQUE INDEX IF NOT EXISTS idx_os_fulfill_unique
  ON operator_step_fulfillments (session_id, step_id, target_type, target_id);

-- "What does this thread/message fulfill?" — reverse lookup.
CREATE INDEX IF NOT EXISTS idx_os_fulfill_target
  ON operator_step_fulfillments (target_type, target_id);

-- "Which fulfillments belong to this workspace?" — needed for
-- workspace-scoped queries.
CREATE INDEX IF NOT EXISTS idx_os_fulfill_workspace
  ON operator_step_fulfillments (workspace_id);
