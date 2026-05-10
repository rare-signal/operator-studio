-- Multi-tier review state: distinguish "Berthier acknowledged" from
-- "human signed off". A worker that posts task_done is *not* yet
-- human-approved; David must explicitly tap. Berthier may add an
-- intermediate acknowledgement that surfaces interstitial review risk
-- (work that Berthier looked at but David never validated).
ALTER TABLE operator_thread_card_bindings
  ADD COLUMN IF NOT EXISTS berthier_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS human_approved_at    TIMESTAMPTZ;
