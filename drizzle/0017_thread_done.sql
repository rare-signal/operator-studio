-- Persisted "thread is done" state.
--
-- Two writers, one reader path:
--   1. Phrase detection (operator types the configured done sentinel
--      as a user turn in the source chat). Detected lazily by readers
--      that touch a thread's messages — on first hit, columns are
--      stamped and the scan is skipped on every subsequent read.
--      source = 'phrase'.
--   2. Manual click in Operator Studio (thread-detail header).
--      source = 'manual', by = the operator's display name.
--
-- Null `marked_done_at` = not done. The other two columns are
-- meaningless when the timestamp is null and ignored by readers.
--
-- Backfill: nothing to do — pre-migration there was no persisted
-- state. The first read after migration will stamp any thread whose
-- history already contains the active phrase.

ALTER TABLE operator_threads
  ADD COLUMN IF NOT EXISTS marked_done_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS marked_done_by TEXT,
  ADD COLUMN IF NOT EXISTS marked_done_source TEXT;
