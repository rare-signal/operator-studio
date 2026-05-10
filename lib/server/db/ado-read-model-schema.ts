// L1 ADO read-model schema — kept in its own module so changes here
// don't collide with concurrent edits to lib/server/db/schema.ts.
// Per `step-ado-ingest-schema-and-poller`. Direct
// `db.select().from(table)` works without these being in the
// drizzle `schema` map — only `db.query.tableName` style queries
// need that map.

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import { workspaces } from "@/lib/server/db/schema"

export const adoItems = pgTable(
  "ado_items",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    workItemId: integer("work_item_id").notNull(),
    rev: integer("rev").notNull(),
    type: text("type"),
    title: text("title"),
    state: text("state"),
    priority: integer("priority"),
    assignedTo: text("assigned_to"),
    assignedToUniqueName: text("assigned_to_unique_name"),
    createdBy: text("created_by"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    fieldsJson: jsonb("fields_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_ado_items_factory_changed").on(
      t.workspaceId,
      t.factoryId,
      t.changedAt
    ),
  ]
)

export const adoRevisions = pgTable(
  "ado_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    workItemId: integer("work_item_id").notNull(),
    rev: integer("rev").notNull(),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    fieldsJson: jsonb("fields_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    changedFieldsJson: jsonb("changed_fields_json")
      .$type<Record<string, { from: unknown; to: unknown }>>()
      .notNull()
      .default({}),
    snapshotId: text("snapshot_id"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_ado_revisions_item_rev").on(
      t.workspaceId,
      t.workItemId,
      t.rev
    ),
    index("idx_ado_revisions_item_time").on(
      t.workspaceId,
      t.workItemId,
      t.changedAt
    ),
  ]
)

export const adoComments = pgTable(
  "ado_comments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    workItemId: integer("work_item_id").notNull(),
    commentId: integer("comment_id").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    modifiedAt: timestamp("modified_at", { withTimezone: true }),
    bodyHtml: text("body_html"),
    bodyText: text("body_text"),
    snapshotId: text("snapshot_id"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_ado_comments_item_comment").on(
      t.workspaceId,
      t.workItemId,
      t.commentId
    ),
    index("idx_ado_comments_item_time").on(
      t.workspaceId,
      t.workItemId,
      t.createdAt
    ),
  ]
)

export const adoAssignmentHistory = pgTable(
  "ado_assignment_history",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    workItemId: integer("work_item_id").notNull(),
    rev: integer("rev").notNull(),
    fromAssignee: text("from_assignee"),
    toAssignee: text("to_assignee"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    snapshotId: text("snapshot_id"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_ado_assignment_history_item_rev").on(
      t.workspaceId,
      t.workItemId,
      t.rev
    ),
  ]
)

export const adoPriorityHistory = pgTable(
  "ado_priority_history",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    workItemId: integer("work_item_id").notNull(),
    rev: integer("rev").notNull(),
    fromPriority: integer("from_priority"),
    toPriority: integer("to_priority"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    snapshotId: text("snapshot_id"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_ado_priority_history_item_rev").on(
      t.workspaceId,
      t.workItemId,
      t.rev
    ),
  ]
)

export const adoStateHistory = pgTable(
  "ado_state_history",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    workItemId: integer("work_item_id").notNull(),
    rev: integer("rev").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    changedBy: text("changed_by"),
    changedAt: timestamp("changed_at", { withTimezone: true }),
    snapshotId: text("snapshot_id"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_ado_state_history_item_rev").on(
      t.workspaceId,
      t.workItemId,
      t.rev
    ),
  ]
)

export const ingestSnapshots = pgTable(
  "ingest_snapshots",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    factoryId: text("factory_id"),
    source: text("source").notNull(),
    pollStartedAt: timestamp("poll_started_at", {
      withTimezone: true,
    }).notNull(),
    pollFinishedAt: timestamp("poll_finished_at", {
      withTimezone: true,
    }).notNull(),
    itemsSeen: integer("items_seen").notNull().default(0),
    itemsUpserted: integer("items_upserted").notNull().default(0),
    revisionsAppended: integer("revisions_appended").notNull().default(0),
    commentsAppended: integer("comments_appended").notNull().default(0),
    errorsJson: jsonb("errors_json").$type<string[]>().notNull().default([]),
    fixtureMode: integer("fixture_mode").notNull().default(0),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_ingest_snapshots_workspace_source_time").on(
      t.workspaceId,
      t.source,
      t.pollStartedAt
    ),
  ]
)

export const identityAliases = pgTable(
  "identity_aliases",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    surface: text("surface").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name"),
    canonicalId: text("canonical_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_identity_aliases_workspace_surface_external").on(
      t.workspaceId,
      t.surface,
      t.externalId
    ),
    index("idx_identity_aliases_canonical").on(t.workspaceId, t.canonicalId),
  ]
)
