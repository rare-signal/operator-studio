-- Flip operator_thread_card_bindings.surface DEFAULT from 'desktop' to
-- 'claude-cli'. Project went fully CLI-only on 2026-05-12; new spawn
-- code paths all set surface explicitly, but the column default lines
-- up with reality so any future code that inserts without a surface
-- value lands as 'claude-cli' instead of silently reactivating the
-- (deleted) AX clipboard+paste send-path.
--
-- EXISTING ROWS ARE NOT REWRITTEN. Bindings whose JSONLs were created
-- by the legacy Claude/Codex Desktop AX path keep surface='desktop' so
-- the cockpit can still flag their origin. Send-route dispatch treats
-- all claude:<id> sessions identically (CLI-resume on the JSONL),
-- regardless of the surface column, so the legacy rows remain fully
-- participable. The column is now mostly informational.

ALTER TABLE operator_thread_card_bindings
  ALTER COLUMN surface SET DEFAULT 'claude-cli';
