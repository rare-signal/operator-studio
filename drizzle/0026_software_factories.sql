-- Software Factories — per-org production system bindings.
--
-- A factory binds plans + agents + KB to (org, product, comms
-- substrates, audience). See `kb-software-factory-doctrine` and
-- `pattern-software-factory-context-air-gap` in the KB.
--
-- Plans gain `factory_id` so the plan switcher can scope context.

CREATE TABLE IF NOT EXISTS software_factories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  org_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_repo_path TEXT,
  product_prod_url TEXT,
  comms_substrates JSONB NOT NULL DEFAULT '[]'::jsonb,
  system_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  escalation_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
  audience JSONB NOT NULL DEFAULT '[]'::jsonb,
  operator_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_software_factories_workspace
  ON software_factories (workspace_id);

ALTER TABLE operator_plans
  ADD COLUMN IF NOT EXISTS factory_id TEXT;

CREATE INDEX IF NOT EXISTS idx_os_plans_workspace_factory
  ON operator_plans (workspace_id, factory_id);
