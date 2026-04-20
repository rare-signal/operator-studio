-- Full-text search columns + GIN indexes.
--
-- Drizzle-kit doesn't model generated tsvector columns natively, so this is
-- hand-rolled as a follow-up migration. The columns are STORED generated so
-- writes to the underlying text columns automatically update the index.

ALTER TABLE operator_threads
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(promoted_title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(raw_title, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(promoted_summary, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(raw_summary, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(why_it_matters, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(project_slug, '')), 'D')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_os_threads_search_tsv
  ON operator_threads USING gin (search_tsv);

ALTER TABLE operator_thread_messages
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_os_thread_messages_search_tsv
  ON operator_thread_messages USING gin (search_tsv);

-- Workspace + search helper: common query pattern is "search within a
-- workspace," so bundle a composite btree + gin.
CREATE INDEX IF NOT EXISTS idx_os_threads_workspace_search
  ON operator_threads (workspace_id) INCLUDE (search_tsv);
