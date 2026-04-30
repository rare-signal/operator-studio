-- Thread passages — operator-promoted spans of text inside a single
-- thread message. First-class durable artifact: a passage exists
-- whether or not it has been linked to a plan step. Highlighting in
-- the thread reader, the "show me all elevated passages" view, and
-- (later) passage-as-evidence on a plan step all read from this one
-- table.
--
-- start_offset / end_offset index into operator_thread_messages.content
-- as captured at promotion time. text_snapshot is the durable artifact;
-- if the message later edits and the offsets no longer match, the
-- snapshot still tells us what the operator originally elevated and
-- the UI can show a "drifted" badge.

CREATE TABLE IF NOT EXISTS operator_thread_passages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES operator_threads(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES operator_thread_messages(id) ON DELETE CASCADE,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  text_snapshot text NOT NULL,
  text_hash text NOT NULL,
  note text,
  promoted_by text NOT NULL,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (start_offset >= 0 AND end_offset > start_offset)
);

CREATE INDEX IF NOT EXISTS idx_op_passages_thread
  ON operator_thread_passages(thread_id, promoted_at DESC);
CREATE INDEX IF NOT EXISTS idx_op_passages_message
  ON operator_thread_passages(message_id);
CREATE INDEX IF NOT EXISTS idx_op_passages_workspace
  ON operator_thread_passages(workspace_id);
