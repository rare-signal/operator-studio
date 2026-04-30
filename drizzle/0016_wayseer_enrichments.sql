-- Wayseer per-thread enrichment runs.
--
-- Each row represents one execution of the thread-analysis contract
-- (see lib/operator-studio/wayseer/contracts/thread-analysis.ts) for a
-- given thread. We store the full structured response in result_payload
-- so the UI can render the timeline / attitude / what-got-done summary
-- without re-calling the LLM. contract_version pins a row to the prompt
-- + response schema that produced it, so we can detect stale rows and
-- re-run when the contract evolves.

CREATE TABLE IF NOT EXISTS operator_thread_enrichments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES operator_threads(id) ON DELETE CASCADE,
  -- pending | running | completed | failed
  status text NOT NULL DEFAULT 'pending',
  contract_version text NOT NULL,
  -- Structured analysis. Shape is governed by contract_version. Null
  -- until the run completes (or it failed before producing output).
  result_payload jsonb,
  -- Operational telemetry — useful for cost-per-thread accounting and
  -- for spotting endpoint regressions when we do roll out budget gates.
  prompt_tokens integer,
  completion_tokens integer,
  latency_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_op_enrichments_workspace
  ON operator_thread_enrichments (workspace_id);
CREATE INDEX IF NOT EXISTS idx_op_enrichments_thread
  ON operator_thread_enrichments (thread_id);
-- Hot path: "give me the most-recently-completed enrichment for this
-- thread" — the GET endpoint hits this every time the thread reader
-- mounts.
CREATE INDEX IF NOT EXISTS idx_op_enrichments_thread_completed
  ON operator_thread_enrichments (thread_id, completed_at DESC);
