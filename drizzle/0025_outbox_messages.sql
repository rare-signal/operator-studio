-- Outbox — staged outbound communications, gated send.
--
-- Every outbound communication (ADO comment, Teams post, ADO state /
-- priority / assignment change, stakeholder reply, preview-deploy URL
-- handoff, …) is staged as a row here first. The Outbound PIN gate
-- (`lib/server/agent-bridge/outbound-mode.ts`) consumes a per-row,
-- payload-hash-bound approval at send time. Direct external writes
-- that bypass this row are considered a bug per the
-- `pattern-outbound-pin-gate` KB article.
--
-- Lifecycle:
--   draft → awaiting_approval → approved → sent
--                              → rejected
--                              → expired (armed window passed without
--                                         consume)
--
-- Audit semantics:
--   - `payload_json` holds the EXACT payload that will be passed to
--     the writer. Hashed (canonical-JSON sha256) at approval time.
--   - `rendered_text` holds what David sees on the preview page. May
--     diverge from payload_json.text after edit; the writer always
--     uses payload_json.
--   - `send_result` records the writer's response (e.g. ADO `rev`,
--     work-item URL) on success.
--   - `send_error` records the failure mode on rejection (gate
--     rejected, upstream returned 5xx, network error, …).

CREATE TABLE IF NOT EXISTS operator_outbox_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Soft FK to a software_factories row when F4 lands. Nullable
  -- until then so outbox can ship before factory schema.
  factory_id TEXT,

  -- Pattern: "<surface>" + "<surface>.<verb>"
  --   surface: ado | teams | preview_deploy | email | stakeholder_reply
  --   action:  ado.addComment | ado.updateState | teams.postMessage | ...
  surface TEXT NOT NULL,
  action TEXT NOT NULL,

  -- Upstream id and a human-readable label. e.g. "39" + "ADO #39".
  target_id TEXT NOT NULL,
  target_label TEXT,

  -- Display-only audience list. Not auto-mentioned anywhere.
  audience JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Exact payload passed to the writer. Hashed at send time.
  payload_json JSONB NOT NULL,

  -- What David proofreads on the preview page.
  rendered_text TEXT NOT NULL,
  rendered_text_edited_by TEXT,

  rationale TEXT,

  -- draft | awaiting_approval | approved | sent | rejected | expired
  state TEXT NOT NULL DEFAULT 'draft',

  llm_run_id TEXT,
  source_inbox_event_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_plan_step_id TEXT,

  proposed_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,

  -- Recomputed and stored at send time. Compared against the hash
  -- bound at approval time by the gate.
  payload_hash TEXT,

  send_result JSONB,
  send_error TEXT,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_outbox_workspace
  ON operator_outbox_messages (workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_outbox_workspace_state
  ON operator_outbox_messages (workspace_id, state);
CREATE INDEX IF NOT EXISTS idx_op_outbox_workspace_surface_target
  ON operator_outbox_messages (workspace_id, surface, target_id);
