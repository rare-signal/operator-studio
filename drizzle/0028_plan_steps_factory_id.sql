-- Plan steps gain factory_id so individual steps can be factory-tagged.
--
-- Plans already have factory_id (per pattern-software-factory-context-air-gap).
-- Per-step factory_id lets a plan span work across factories during the
-- migration period — the F7 plan merge-up sweep classifies existing
-- cards in place rather than forcing a hard split into new plans.
--
-- Resolution order at read sites:
--   step.factory_id ?? plan.factory_id ?? null

ALTER TABLE operator_plan_steps
  ADD COLUMN IF NOT EXISTS factory_id TEXT;

CREATE INDEX IF NOT EXISTS idx_op_plan_steps_factory
  ON operator_plan_steps (workspace_id, factory_id);
