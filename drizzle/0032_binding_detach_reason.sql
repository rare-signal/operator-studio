-- Per-detach reason on agent bindings: when a worker is marked done
-- with `cockpit-mark-done --reason="..."`, the rationale is persisted
-- on the binding row so the recently-completed drawer can surface it
-- (taking precedence over the original spawn rationale).
ALTER TABLE operator_thread_card_bindings
  ADD COLUMN IF NOT EXISTS detach_reason TEXT;
