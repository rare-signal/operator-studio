-- Session Plans: promote plans out of operator_sessions.plan_steps (jsonb)
-- into their own durable rows so a plan can outlive a single session.
--
-- Before: sessions owned plans (1:1, JSON column). 3h idle gap = new
-- session = lost plan. Plan was a throwaway per-session artifact.
--
-- After: plans are first-class. A plan has a title, a goal (measurable
-- sentence), an outcome (what "done" looks like), lifecycle state, and
-- a pin toggle. Sessions attach to plans (N:1) so you can keep pulling
-- on the same goal across days.
--
-- Step fulfillments keep working unchanged — step_id is still a stable
-- identifier, it just now lives in operator_plan_steps instead of the
-- session's jsonb array. The backfill preserves existing step ids.

-- ─── operator_plans ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_plans (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  -- Measurable goal ("Ship the OSS kickoff by Friday"). Free text.
  goal           TEXT,
  -- Outcome: what "done" looks like. Free text.
  outcome        TEXT,
  -- Lifecycle: drafting | active | paused | shipped | archived.
  -- A newly auto-created blank plan starts as "drafting" until the
  -- user fills in title + at least one step — then it flips to "active".
  state          TEXT NOT NULL DEFAULT 'drafting',
  -- Pinned plans survive beyond their current session and show in the
  -- sidebar plan switcher. Unpinned plans are still queryable but live
  -- in the All Plans list only.
  pinned         INTEGER NOT NULL DEFAULT 0,
  -- Optional — who's accountable. Mirrors operator_threads.owner_name.
  owner_name     TEXT,
  created_by     TEXT NOT NULL,
  shipped_at     TIMESTAMPTZ,
  archived_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_os_plans_workspace
  ON operator_plans (workspace_id);
CREATE INDEX IF NOT EXISTS idx_os_plans_workspace_state
  ON operator_plans (workspace_id, state);
CREATE INDEX IF NOT EXISTS idx_os_plans_workspace_pinned
  ON operator_plans (workspace_id, pinned) WHERE pinned = 1;

-- ─── operator_plan_steps ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operator_plan_steps (
  id             TEXT PRIMARY KEY,
  plan_id        TEXT NOT NULL REFERENCES operator_plans(id) ON DELETE CASCADE,
  -- Keep a workspace_id cached here so workspace-scoped queries can filter
  -- cheaply without joining plans. Denormalized intentionally.
  workspace_id   TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  description    TEXT,
  -- Integer sort key; lower = earlier.
  step_order     INTEGER NOT NULL DEFAULT 0,
  -- Step lifecycle: open | in-motion | covered | skipped.
  -- Computed client-side today via fulfillments, but we store the
  -- baseline here so the Plan editor can override manually.
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_os_plan_steps_plan
  ON operator_plan_steps (plan_id, step_order);
CREATE INDEX IF NOT EXISTS idx_os_plan_steps_workspace
  ON operator_plan_steps (workspace_id);

-- ─── operator_sessions.plan_id ──────────────────────────────────────────────

ALTER TABLE operator_sessions
  ADD COLUMN IF NOT EXISTS plan_id TEXT
  REFERENCES operator_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_os_sessions_plan
  ON operator_sessions (plan_id);

-- ─── Backfill ───────────────────────────────────────────────────────────────
--
-- For every existing session that has a non-empty plan_steps array, spin
-- up a plan (title = session.label or a derived default, state='active',
-- pinned=0), copy the steps into operator_plan_steps preserving ids, and
-- set session.plan_id. No-ops for sessions with empty plan_steps — they
-- stay plan-less until the user creates one.
--
-- NOTE: we preserve step ids exactly so operator_step_fulfillments.step_id
-- references remain valid.

INSERT INTO operator_plans (
  id, workspace_id, title, state, pinned, created_by, created_at, updated_at
)
SELECT
  'plan-' || s.id                                  AS id,
  s.workspace_id                                   AS workspace_id,
  COALESCE(NULLIF(s.label, ''), 'Session plan')    AS title,
  'active'                                          AS state,
  0                                                 AS pinned,
  'backfill'                                        AS created_by,
  s.created_at                                      AS created_at,
  s.updated_at                                      AS updated_at
FROM operator_sessions s
WHERE s.plan_steps IS NOT NULL
  AND jsonb_typeof(s.plan_steps) = 'array'
  AND jsonb_array_length(s.plan_steps) > 0
  AND s.plan_id IS NULL
ON CONFLICT (id) DO NOTHING;

-- Copy each step out of the jsonb array into a normalized row. Use the
-- step's own id when present — that keeps step_fulfillments valid.
INSERT INTO operator_plan_steps (
  id, plan_id, workspace_id, title, description, step_order, status, created_at, updated_at
)
SELECT
  step->>'id'                                      AS id,
  'plan-' || s.id                                  AS plan_id,
  s.workspace_id                                   AS workspace_id,
  COALESCE(step->>'title', 'Untitled step')        AS title,
  step->>'description'                             AS description,
  COALESCE((step->>'order')::int, idx - 1)         AS step_order,
  'open'                                           AS status,
  s.created_at                                      AS created_at,
  s.updated_at                                      AS updated_at
FROM operator_sessions s
CROSS JOIN LATERAL jsonb_array_elements(s.plan_steps) WITH ORDINALITY AS step_list(step, idx)
WHERE s.plan_steps IS NOT NULL
  AND jsonb_typeof(s.plan_steps) = 'array'
  AND jsonb_array_length(s.plan_steps) > 0
  AND s.plan_id IS NULL
  AND step->>'id' IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- Link sessions to the plans we just created.
UPDATE operator_sessions s
  SET plan_id = 'plan-' || s.id, updated_at = NOW()
WHERE s.plan_steps IS NOT NULL
  AND jsonb_typeof(s.plan_steps) = 'array'
  AND jsonb_array_length(s.plan_steps) > 0
  AND s.plan_id IS NULL;

-- NOTE: operator_sessions.plan_steps is INTENTIONALLY left in place.
-- It's now a shadow — nothing reads from it after this migration lands.
-- Keeping it buys us a safety rollback window; a future migration can
-- drop the column once we're confident.
