-- Work lanes — tertiary container above plans, below workspace.
--
-- A workspace can host multiple air-gapped work lanes. Each lane has
-- its own cockpit exec (the Berthier driving that lane's worker rail)
-- and its own pulled-in scope (plan steps / KB entries the lane
-- cares about). Mobile cockpit's top-level picker switches between
-- lanes inside the active workspace.
--
-- The earlier `operator_cockpit_execs` row stays as the workspace
-- *default* exec for backward-compat; on migration each existing
-- exec row is auto-promoted into a "Default lane" so the cockpit
-- has somewhere to land. See scripts/apply-work-lanes-migration.ts.

CREATE TABLE IF NOT EXISTS operator_work_lanes (
  id             TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL
    REFERENCES workspaces(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  exec_agent_id  TEXT,
  exec_agent_kind TEXT,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL,
  archived_at    TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_op_work_lanes_workspace
  ON operator_work_lanes (workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_work_lanes_active
  ON operator_work_lanes (workspace_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_op_work_lanes_exec_agent
  ON operator_work_lanes (exec_agent_id) WHERE exec_agent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS operator_work_lane_membership (
  lane_id     TEXT NOT NULL
    REFERENCES operator_work_lanes(id) ON DELETE CASCADE,
  member_kind TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  added_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY (lane_id, member_kind, member_id)
);

CREATE INDEX IF NOT EXISTS idx_op_work_lane_membership_lane
  ON operator_work_lane_membership (lane_id);
CREATE INDEX IF NOT EXISTS idx_op_work_lane_membership_member
  ON operator_work_lane_membership (member_kind, member_id);
