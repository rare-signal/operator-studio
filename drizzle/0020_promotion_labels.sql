-- Configurable promotion labels.
--
-- The user wanted promote-time labels to be workspace-configurable:
-- not a fixed enum, but a small admin-managed set of named flags
-- where each label carries a definition / context blurb that the AI
-- can read alongside the elevated passage. The label IS the signal;
-- the context blurb tells downstream consumers (Wayseer prompts,
-- KB-generation heuristics, MCP tools) what the label means.
--
-- Two-table change:
--
--   * operator_promotion_labels — workspace-scoped, soft-deletable.
--   * operator_thread_passages.label_id — nullable FK; set null on
--     label delete so historical passages don't disappear when an
--     admin retires a label.
--
-- The column is nullable on purpose so the existing "highlight
-- without a label" flow keeps working. Promote… can require a label
-- via UI policy without a NOT NULL constraint forcing a backfill.

CREATE TABLE IF NOT EXISTS operator_promotion_labels (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- The "what does this label mean to the AI" blurb. This is what
  -- gets concatenated into prompts that consume promoted passages.
  ai_context TEXT NOT NULL DEFAULT '',
  -- Lucide-react icon name (display); falls back to a flame glyph.
  icon TEXT,
  -- Tailwind color name segment ("emerald", "amber", "rose"…) used
  -- to tint the label chip. Free-form so admins can pick any of the
  -- standard palette without a JS-side allowlist.
  color TEXT,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  -- Soft delete. Active labels are `archived_at IS NULL`. A retired
  -- label keeps its row so historical passages can still resolve their
  -- former label name + context.
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_op_promotion_labels_workspace
  ON operator_promotion_labels(workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_promotion_labels_workspace_sort
  ON operator_promotion_labels(workspace_id, sort_index)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_op_promotion_labels_unique_active
  ON operator_promotion_labels(workspace_id, label)
  WHERE archived_at IS NULL;

-- Add label_id to passages. Nullable; ON DELETE SET NULL preserves
-- historical promotion rows when an admin deletes a label outright.
ALTER TABLE operator_thread_passages
  ADD COLUMN IF NOT EXISTS label_id TEXT
    REFERENCES operator_promotion_labels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_op_passages_label
  ON operator_thread_passages(label_id);
