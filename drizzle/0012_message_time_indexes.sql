-- Composite (workspace_id, created_at) indexes on the message tables.
--
-- Every Pulse render runs queries shaped like
--   WHERE workspace_id = X AND created_at BETWEEN start AND end
-- against operator_thread_messages and operator_chat_messages. With
-- only single-column indexes on workspace_id, Postgres reads every
-- row in the workspace and filters by date in memory. On workspaces
-- with tens of thousands of messages this is the dominant cost on
-- every session switch (loadPulseGraph alone fires three of these
-- queries per render).
--
-- A composite index on (workspace_id, created_at) lets PG do an
-- index-range scan: jump to (workspace_id=X, created_at=start) and
-- read forward until end. Same shape used by ensureSessionsForWorkspace,
-- getMessagesInSessionWindow, getPulseFreshness, getThreadsInSession.

CREATE INDEX IF NOT EXISTS idx_os_messages_workspace_time
  ON operator_thread_messages (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_os_chat_messages_workspace_time
  ON operator_chat_messages (workspace_id, created_at);
