-- L1 ADO read-model — local mirror of Azure DevOps work-item state.
--
-- Per `step-ado-ingest-schema-and-poller`. The poller writes here on
-- every tick: ado_items holds *current* state (one row per item), the
-- *_history tables are append-only event logs of changes, ado_comments
-- mirrors the comment thread, and ingest_snapshots records what the
-- poller saw so we can reason about gaps.
--
-- Read-only mirror — nothing in this read model writes back to ADO.
-- Outbound mutation still flows through operator_outbox_messages
-- under the outbound PIN gate.

CREATE TABLE IF NOT EXISTS ado_items (
  workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id       TEXT,
  work_item_id     INTEGER NOT NULL,
  rev              INTEGER NOT NULL,
  type             TEXT,
  title            TEXT,
  state            TEXT,
  priority         INTEGER,
  assigned_to      TEXT,
  assigned_to_unique_name TEXT,
  created_by       TEXT,
  changed_by       TEXT,
  changed_at       TIMESTAMPTZ,
  fields_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at    TIMESTAMPTZ NOT NULL,
  last_seen_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, work_item_id)
);
CREATE INDEX IF NOT EXISTS idx_ado_items_factory_changed
  ON ado_items (workspace_id, factory_id, changed_at DESC);

-- Append-only revision log. One row per (work_item_id, rev) the
-- poller has ever observed. Changing snapshot_id lets us correlate
-- a rev to the poll tick that surfaced it.
CREATE TABLE IF NOT EXISTS ado_revisions (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id         TEXT,
  work_item_id       INTEGER NOT NULL,
  rev                INTEGER NOT NULL,
  changed_by         TEXT,
  changed_at         TIMESTAMPTZ,
  fields_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Diff vs previously-stored row in ado_items (per-field {from,to}).
  -- Empty {} on first observation.
  changed_fields_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot_id        TEXT,
  ingested_at        TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ado_revisions_item_rev
  ON ado_revisions (workspace_id, work_item_id, rev);
CREATE INDEX IF NOT EXISTS idx_ado_revisions_item_time
  ON ado_revisions (workspace_id, work_item_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS ado_comments (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id      TEXT,
  work_item_id    INTEGER NOT NULL,
  comment_id      INTEGER NOT NULL,
  created_by      TEXT,
  created_at      TIMESTAMPTZ,
  modified_at     TIMESTAMPTZ,
  body_html       TEXT,
  body_text       TEXT,
  snapshot_id     TEXT,
  ingested_at     TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ado_comments_item_comment
  ON ado_comments (workspace_id, work_item_id, comment_id);
CREATE INDEX IF NOT EXISTS idx_ado_comments_item_time
  ON ado_comments (workspace_id, work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ado_assignment_history (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id    TEXT,
  work_item_id  INTEGER NOT NULL,
  rev           INTEGER NOT NULL,
  from_assignee TEXT,
  to_assignee   TEXT,
  changed_by    TEXT,
  changed_at    TIMESTAMPTZ,
  snapshot_id   TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ado_assignment_history_item_rev
  ON ado_assignment_history (workspace_id, work_item_id, rev);
CREATE INDEX IF NOT EXISTS idx_ado_assignment_history_item_time
  ON ado_assignment_history (workspace_id, work_item_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS ado_priority_history (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id    TEXT,
  work_item_id  INTEGER NOT NULL,
  rev           INTEGER NOT NULL,
  from_priority INTEGER,
  to_priority   INTEGER,
  changed_by    TEXT,
  changed_at    TIMESTAMPTZ,
  snapshot_id   TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ado_priority_history_item_rev
  ON ado_priority_history (workspace_id, work_item_id, rev);
CREATE INDEX IF NOT EXISTS idx_ado_priority_history_item_time
  ON ado_priority_history (workspace_id, work_item_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS ado_state_history (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id    TEXT,
  work_item_id  INTEGER NOT NULL,
  rev           INTEGER NOT NULL,
  from_state    TEXT,
  to_state      TEXT,
  changed_by    TEXT,
  changed_at    TIMESTAMPTZ,
  snapshot_id   TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ado_state_history_item_rev
  ON ado_state_history (workspace_id, work_item_id, rev);
CREATE INDEX IF NOT EXISTS idx_ado_state_history_item_time
  ON ado_state_history (workspace_id, work_item_id, changed_at DESC);

-- One row per poll tick. Records what the poller saw, how long it
-- took, and any errors. Verification of the L1 contract leans on
-- this: poll-twice should produce two snapshots with stable
-- items_seen and a non-decreasing revisions count.
CREATE TABLE IF NOT EXISTS ingest_snapshots (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  factory_id         TEXT,
  source             TEXT NOT NULL,           -- 'ado'
  poll_started_at    TIMESTAMPTZ NOT NULL,
  poll_finished_at   TIMESTAMPTZ NOT NULL,
  items_seen         INTEGER NOT NULL DEFAULT 0,
  items_upserted     INTEGER NOT NULL DEFAULT 0,
  revisions_appended INTEGER NOT NULL DEFAULT 0,
  comments_appended  INTEGER NOT NULL DEFAULT 0,
  errors_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  fixture_mode       INTEGER NOT NULL DEFAULT 0,
  ingested_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ingest_snapshots_workspace_source_time
  ON ingest_snapshots (workspace_id, source, poll_started_at DESC);

-- Identity aliases — collapse the same person across ADO display
-- name, ADO uniqueName (email), and Teams display name. Append
-- mappings as we observe them; the (workspace_id, surface,
-- external_id) tuple is unique so re-observing is a no-op.
CREATE TABLE IF NOT EXISTS identity_aliases (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  surface       TEXT NOT NULL,                 -- ado | teams | …
  external_id   TEXT NOT NULL,                 -- uniqueName / userId
  display_name  TEXT,
  canonical_id  TEXT,                          -- our chosen primary id
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_aliases_workspace_surface_external
  ON identity_aliases (workspace_id, surface, external_id);
CREATE INDEX IF NOT EXISTS idx_identity_aliases_canonical
  ON identity_aliases (workspace_id, canonical_id);
