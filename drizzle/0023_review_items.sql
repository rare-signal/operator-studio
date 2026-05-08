-- David-only review bucket.
--
-- Interstitial layer between agent inference (or any upstream signal)
-- and anything team-visible. Raw conclusions land here as `david_only`
-- until the operator promotes, edits, rejects, snoozes, or imports
-- them into an Operator Studio plan card.
--
-- This is an Operator Studio primitive: the bucket is generic over
-- source_type so it can hold ADO assigned work, Microsoft Teams
-- signals, agent floor-situation summaries, known-issue claims,
-- product-narrative/provenance suggestions, and preview deployment
-- review notes — without reaching into any one lane's product code
-- (TeleGento, Valikharlia, etc.).
--
-- state machine:
--   raw → summarized → candidate → (imported | promoted | rejected | snoozed)
-- visibility:
--   david_only (default) | promoted (cleared for team-facing surfaces)

CREATE TABLE IF NOT EXISTS operator_review_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Lane-agnostic source type. Free-form so new sources don't need a
  -- migration. Recommended values: ado | teams | agent | known_issue
  --   | product_narrative | deployment | signal_intake.
  source_type TEXT NOT NULL,
  -- Friendly label for the source ("Azure DevOps · TeleGento", etc.).
  source_label TEXT,
  -- Stable upstream identifier (work item id, message id, agent run
  -- id, commit sha, etc.). Combined with source_type for dedupe.
  source_id TEXT,
  source_url TEXT,

  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  -- Raw text body when the source is textual (Teams message, agent
  -- conclusion, etc.).
  raw_text TEXT,
  -- Structured payload when the source is JSON (ADO work item, Graph
  -- message envelope, agent run output).
  raw_payload JSONB,

  proposed_action TEXT,
  -- Soft reference; if the related step is later trashed/purged the
  -- review item survives but the link goes stale. We don't FK because
  -- the bucket is intentionally append-only-ish and shouldn't fail
  -- imports because of a downstream delete.
  related_plan_step_id TEXT,

  -- david_only | promoted
  visibility TEXT NOT NULL DEFAULT 'david_only',
  -- raw | summarized | candidate | imported | promoted | rejected | snoozed
  state TEXT NOT NULL DEFAULT 'raw',

  -- Agent provenance (nullable — non-agent sources skip these).
  confidence DOUBLE PRECISION,
  rationale TEXT,
  agent_run_id TEXT,

  tags JSONB NOT NULL DEFAULT '[]'::jsonb,

  snoozed_until TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_review_items_workspace
  ON operator_review_items(workspace_id);

CREATE INDEX IF NOT EXISTS idx_op_review_items_workspace_state
  ON operator_review_items(workspace_id, state);

CREATE INDEX IF NOT EXISTS idx_op_review_items_workspace_source
  ON operator_review_items(workspace_id, source_type, source_id);

-- Dedupe guard: same upstream item shouldn't land twice. Partial
-- index — only enforced when source_id is present (some sources are
-- ad-hoc agent conclusions with no upstream key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_op_review_items_unique_source
  ON operator_review_items(workspace_id, source_type, source_id)
  WHERE source_id IS NOT NULL;
