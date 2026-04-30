-- Operator notes — workspace-scoped scratchpad with arbitrary nesting.
--
-- A note has the same parent/child shape as operator_plan_steps so a note
-- (or a parent + its descendants) can be promoted onto the plan canvas
-- as plan steps without a structural mismatch. Notes are independent of
-- plans and sessions — they live for the workspace and are visible from
-- the Plan page's tab-rail "Notes" popover.

CREATE TABLE IF NOT EXISTS operator_notes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Self-referential. NULL = top-level note. Single-parent (tree, not DAG).
  parent_note_id text REFERENCES operator_notes(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text,
  -- Ordering among siblings. Recompacted on reorder.
  sort_index integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_os_notes_workspace ON operator_notes (workspace_id);
CREATE INDEX IF NOT EXISTS idx_os_notes_parent ON operator_notes (parent_note_id);
CREATE INDEX IF NOT EXISTS idx_os_notes_workspace_sort
  ON operator_notes (workspace_id, parent_note_id, sort_index);
