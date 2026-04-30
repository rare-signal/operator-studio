-- Soft-delete for operator notes — gives the user a recoverable trash.
--
-- Hard delete used to cascade through the whole subtree via the existing
-- FK ON DELETE CASCADE, which made an accidental click on the trash icon
-- unrecoverable. We now stamp `deleted_at` instead. The active-notes
-- queries filter `deleted_at IS NULL`; the trash view selects the
-- complement. A separate purge step (manual "Empty trash" or the 30-day
-- TTL applied lazily on trash open) does the actual row removal, at
-- which point the FK cascade still cleans up any descendants that were
-- soft-deleted alongside the parent.

ALTER TABLE operator_notes
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Hot path is "list active notes for workspace" — partial index keeps
-- it cheap even as trash accumulates.
CREATE INDEX IF NOT EXISTS idx_os_notes_workspace_active
  ON operator_notes (workspace_id)
  WHERE deleted_at IS NULL;

-- For the trash view + TTL purge.
CREATE INDEX IF NOT EXISTS idx_os_notes_workspace_trash
  ON operator_notes (workspace_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
