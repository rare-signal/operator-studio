-- Plan step layout: persistable canvas position + tree relationships
--
-- Adds three nullable columns to operator_plan_steps:
--   - parent_step_id: enables tree structure (a step can be a child
--     of another step). Multiple children of one parent supported;
--     arbitrary DAG (multiple parents) intentionally not.
--   - position_x / position_y: persisted Atelier canvas coordinates.
--     NULL falls back to the deterministic grid layout client-side.

ALTER TABLE operator_plan_steps
  ADD COLUMN IF NOT EXISTS parent_step_id TEXT,
  ADD COLUMN IF NOT EXISTS position_x DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS position_y DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_os_plan_steps_parent
  ON operator_plan_steps(parent_step_id);
