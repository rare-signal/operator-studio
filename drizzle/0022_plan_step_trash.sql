-- Soft-delete for plan steps — same recoverable-trash pattern as
-- operator_notes (migration 0015). Hard delete cascades through children
-- via the existing FK CASCADE on plan_id / workspace_id, which means an
-- accidental click on a parent's trash icon used to vaporize an entire
-- subtree with no recovery path. We now stamp `deleted_at` instead.
--
-- Active queries filter `deleted_at IS NULL`; a future trash view selects
-- the complement. A separate purge step (manual "Empty trash" or a TTL
-- on trash open) does the actual row removal, at which point the FK
-- cascade still cleans up any descendants that were soft-deleted
-- alongside the parent.
--
-- This migration is additive: existing rows have `deleted_at = NULL`
-- (active), so nothing changes for in-flight plans on apply. Behavior
-- changes (hard → soft delete in the existing UI delete buttons) are
-- handled in the application layer; the column itself is harmless.

ALTER TABLE operator_plan_steps
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Hot path is "list active steps for plan" — partial index keeps it
-- cheap even as trash accumulates.
CREATE INDEX IF NOT EXISTS idx_os_plan_steps_plan_active
  ON operator_plan_steps (plan_id, step_order)
  WHERE deleted_at IS NULL;

-- For the trash view + TTL purge.
CREATE INDEX IF NOT EXISTS idx_os_plan_steps_plan_trash
  ON operator_plan_steps (plan_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
