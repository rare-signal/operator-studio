-- Spawn linkage on agent bindings: the cockpit (and any future
-- executive-managing-worker surface) needs to know which agents were
-- spawned by which executive agent, so the "workers spawned by exec"
-- list is authoritative instead of heuristic.
--
-- spawned_by_agent_id holds the composite id (e.g. `claude:<uuid>`)
-- of the executive that originated this binding's agent. Null for
-- bindings created without that context (e.g. legacy launches, manual
-- adoptions, recommendation-driven spawns where no exec is involved).
--
-- spawn_origin tags how the spawn was originated, so we can later
-- distinguish cockpit lanes from operator-recommendation launches
-- without losing the parent linkage.
ALTER TABLE operator_thread_card_bindings
  ADD COLUMN IF NOT EXISTS spawned_by_agent_id TEXT;

ALTER TABLE operator_thread_card_bindings
  ADD COLUMN IF NOT EXISTS spawn_origin TEXT;

CREATE INDEX IF NOT EXISTS idx_op_thread_bindings_spawned_by
  ON operator_thread_card_bindings (workspace_id, spawned_by_agent_id);
