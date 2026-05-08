-- Knowledge Base — optional module per workspace.
--
-- Two-layer model (per the synthetic-Wikipedia-of-your-own-madness
-- design discussed 2026-05-03):
--
--   * operator_kb_claims    — atomic, dated, sourced propositions.
--                             What the LLM is good at producing from
--                             promoted passages. Each claim cites a
--                             single source passage / message / thread
--                             and carries a freshness window.
--
--   * operator_kb_entries   — encyclopedic markdown articles. Curated
--                             from claim clusters (or hand-written).
--                             Browseable surface modeled 1:1 on the
--                             AIDA Observatory intelligence/memory UI.
--
-- The KB is opt-in per workspace via workspace_modules. Surfaces and
-- writers must check `isKbEnabled(workspaceId)` before doing work.
-- Per the LLM-layering rule, the manual surface works without any
-- LLM endpoint configured; LLM writers (wayseer hook + MCP tools)
-- are an additive layer.

-- ─── Module enablement ──────────────────────────────────────────────
--
-- Generic per-workspace module flag table. KB is the first module to
-- use it; future optional modules attach without schema changes.
-- key = stable module identifier ("knowledge_base" for now).

CREATE TABLE IF NOT EXISTS workspace_modules (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json JSONB,
  enabled_at TIMESTAMPTZ,
  enabled_by TEXT,
  PRIMARY KEY (workspace_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_modules_enabled
  ON workspace_modules(workspace_id, module_key, enabled);

-- ─── Knowledge base entries (article layer) ─────────────────────────
--
-- AIDA's monolithic ObservatoryMemoryEntry, ported. Citations stay
-- inline (jsonb) per the agreed design — one INSERT/SELECT per write,
-- side table can come later if cross-entry citation queries appear.
--
-- entry_type: concept | pattern | metric | procedure | agent |
--             comparison | anomaly | todo | report
-- stability:  evergreen | stable | fluctuant | draft
--
-- citations[] shape: { thread_id, message_id?, passage_id?, claim_id?,
--                       excerpt, label?, kind: "passage"|"message"|"thread"|"claim" }
--
-- source_passage_ids/source_thread_id record the sacrosanct human
-- elevations that motivated the entry — distinct from citations
-- (which are what the entry references in its body).

CREATE TABLE IF NOT EXISTS operator_kb_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  entry_type TEXT NOT NULL DEFAULT 'concept',
  stability TEXT NOT NULL DEFAULT 'draft',

  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',

  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_entry_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  parent_entry_id TEXT,

  source_thread_id TEXT REFERENCES operator_threads(id) ON DELETE SET NULL,
  source_passage_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,

  last_verified_at TIMESTAMPTZ,
  refresh_interval_hours INTEGER,
  next_refresh_at TIMESTAMPTZ,
  last_user_edit_at TIMESTAMPTZ,
  last_user_edit_by TEXT,

  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  version_count INTEGER NOT NULL DEFAULT 1,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_kb_entries_workspace
  ON operator_kb_entries(workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_kb_entries_workspace_updated
  ON operator_kb_entries(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_kb_entries_workspace_type
  ON operator_kb_entries(workspace_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_op_kb_entries_workspace_stability
  ON operator_kb_entries(workspace_id, stability);
CREATE INDEX IF NOT EXISTS idx_op_kb_entries_parent
  ON operator_kb_entries(parent_entry_id);
CREATE INDEX IF NOT EXISTS idx_op_kb_entries_refresh
  ON operator_kb_entries(workspace_id, next_refresh_at)
  WHERE stability = 'fluctuant';

-- ─── Knowledge base claims (atomic-fact layer) ──────────────────────
--
-- One claim = one proposition. Cheap for an LLM to produce, easy to
-- supersede (set superseded_by_id when a newer claim contradicts an
-- older one). Confidence is 0..1 from the model; valid_at is when
-- the claim was true (defaults to created_at).
--
-- A claim may be cited by zero or many entries. Entries cite claims
-- via the entries.citations[].claim_id pointer; reverse lookup is
-- via the cited_by_entry_ids cache below (best-effort, rebuildable).

CREATE TABLE IF NOT EXISTS operator_kb_claims (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  subject TEXT,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8,

  source_thread_id TEXT REFERENCES operator_threads(id) ON DELETE SET NULL,
  source_message_id TEXT REFERENCES operator_thread_messages(id) ON DELETE SET NULL,
  source_passage_id TEXT REFERENCES operator_thread_passages(id) ON DELETE SET NULL,
  source_excerpt TEXT,

  valid_at TIMESTAMPTZ NOT NULL,
  superseded_by_id TEXT,
  cited_by_entry_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  model_provider TEXT,
  model_name TEXT,
  prompt_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_op_kb_claims_workspace
  ON operator_kb_claims(workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_kb_claims_workspace_valid
  ON operator_kb_claims(workspace_id, valid_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_kb_claims_thread
  ON operator_kb_claims(source_thread_id);
CREATE INDEX IF NOT EXISTS idx_op_kb_claims_passage
  ON operator_kb_claims(source_passage_id);
CREATE INDEX IF NOT EXISTS idx_op_kb_claims_active
  ON operator_kb_claims(workspace_id, superseded_by_id);
