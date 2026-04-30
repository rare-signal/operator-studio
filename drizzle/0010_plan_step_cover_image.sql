-- Plan step cover image
--
-- Adds an optional per-card cover image URL on operator_plan_steps,
-- mirroring the same field on operator_plans (migration 0009). Used
-- by the Atelier canvas to render a hero image on individual cards.
-- NULL means no cover.
--
-- The column was already declared in lib/server/db/schema.ts; this
-- migration brings the DB in line. Without it, every read of a plan
-- step (loadActivePlan, getActivePlan, getPlanById, …) errors with
-- "column position_z does not exist" — which broke the Plan page,
-- the thread reader's Quote→Step popover, and any other surface
-- that resolves the active plan.

ALTER TABLE operator_plan_steps
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
