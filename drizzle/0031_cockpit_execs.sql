-- Per-workspace cockpit executive thread. The cockpit promotes a single
-- thread to "exec" for a given workspace; that selection is now durable
-- so the role-conflict guard (a thread cannot be both exec and worker)
-- has a server-side source of truth.
--
-- Schema is intentionally minimal — one active exec per workspace; if
-- richer multi-lane semantics arrive later this turns into a table
-- with a `lane_id` column.

CREATE TABLE IF NOT EXISTS operator_cockpit_execs (
  workspace_id TEXT PRIMARY KEY
    REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_id     TEXT NOT NULL,
  agent_kind   TEXT NOT NULL,
  updated_at   TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_cockpit_execs_agent
  ON operator_cockpit_execs (agent_id);
