-- Session Spaces: segments of LLM activity bracketed by 3h+ idle gaps.
--
-- Time range (started_at, ended_at) is authoritative; thread membership
-- is derived at query time via timestamp overlap with operator_threads.
-- That means threads can appear in multiple sessions if picked back up
-- after a break — intentional, not a bug.
--
-- plan_steps is a jsonb array of {id, title, description?, order}. Edited
-- via the Plan editor (ships in Phase 2). Column exists from Phase 1 so
-- the migration is one-shot.
--
-- threadCount / messageCount are cached derived counts for the list view.
-- Cheap to recompute, so no strict-sync requirement — recomputed when a
-- session's time range grows.

CREATE TABLE IF NOT EXISTS operator_sessions (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label           TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ NOT NULL,
  plan_steps      JSONB DEFAULT '[]'::jsonb,
  thread_count    INTEGER NOT NULL DEFAULT 0,
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_os_sessions_workspace
  ON operator_sessions (workspace_id);

CREATE INDEX IF NOT EXISTS idx_os_sessions_started_at
  ON operator_sessions (started_at);
