-- Inbox events — read-only mirror of upstream events.
--
-- Generalization of upstream-event ingestion (ADO comments / state
-- transitions, Teams posts, stakeholder feature requests, …). Per
-- `pattern-inbox-ingest` in the KB.
--
-- Three permission tiers governing how the LLM may act on these rows
-- live in the tool / route layer (free-read, confirm-continuation,
-- hot-mode-engineering, outbound-gated). The inbox itself is
-- read-only ingest — no row here ever causes a side effect against
-- an external system.
--
-- The first writer is the existing ADO signal-intake layer (which
-- today is stateless); a follow-up will persist live ADO ingest into
-- this table. The schema is intentionally generic so future surfaces
-- (Teams, Linear, Atlassian status, etc.) need no migration.

CREATE TABLE IF NOT EXISTS operator_inbox_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Soft FK to a software_factories row when the event is scoped to
  -- one. Null = factory-agnostic / cross-factory.
  factory_id TEXT,

  -- ado | teams | stakeholder_request | linear | atlassian_status | ...
  surface TEXT NOT NULL,

  -- Stable upstream identifier. Combined with surface for dedupe.
  upstream_id TEXT,

  -- comment | state_transition | priority_change | assignment_change
  --   | mention | feature_request | reply | post | ...
  upstream_kind TEXT NOT NULL,

  actor_name TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,

  -- Full upstream payload, stable for replays.
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Operator-facing excerpt (text body of the comment, headline of
  -- the state transition, etc.).
  text_excerpt TEXT,

  -- Loose link back to the upstream work item / message / thread.
  related_work_id TEXT,
  related_work_label TEXT,

  ingested_at TIMESTAMPTZ NOT NULL,

  -- LLM's first-pass read of this event. Bounded (≤1KB by convention)
  -- and one-shot per row from the LLM side; the operator may edit.
  llm_initial_log TEXT,
  llm_initial_log_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_inbox_workspace
  ON operator_inbox_events (workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_inbox_workspace_factory_occurred
  ON operator_inbox_events (workspace_id, factory_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_inbox_workspace_surface
  ON operator_inbox_events (workspace_id, surface, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_op_inbox_workspace_surface_upstream
  ON operator_inbox_events (workspace_id, surface, upstream_id)
  WHERE upstream_id IS NOT NULL;
