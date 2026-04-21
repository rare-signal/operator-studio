-- Dedicated promoted_at timestamp for threads. Was proxying through
-- updated_at which moves on every edit, making "daily promoted" charts
-- drift when operators tweak promoted metadata. Now stamped exactly once
-- at the transition into review_state = 'promoted'.
--
-- Backfill: for existing rows in the 'promoted' state, seed promoted_at
-- from updated_at as a best-effort historical anchor.

ALTER TABLE operator_threads
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ;

UPDATE operator_threads
   SET promoted_at = updated_at
 WHERE review_state = 'promoted'
   AND promoted_at IS NULL;
