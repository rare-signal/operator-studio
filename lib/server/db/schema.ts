// Operator Studio schema — workspaces, threads, messages, summaries,
// continuation chat sessions, import runs.
//
// A workspace is an isolated namespace. One workspace is the "global" library
// (`is_global = 1`). Others are sub-workspaces. Threads live in exactly one
// workspace; they can be promoted (copied to global) or pulled down (copied
// from global to a sub-workspace). No implicit inheritance.

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  isGlobal: integer("is_global").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
})

export const operatorThreads = pgTable(
  "operator_threads",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceApp: text("source_app").notNull(),
    sourceThreadKey: text("source_thread_key"),
    sourceLocator: text("source_locator"),
    importedBy: text("imported_by").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    importRunId: text("import_run_id"),
    rawTitle: text("raw_title"),
    rawSummary: text("raw_summary"),
    promotedTitle: text("promoted_title"),
    promotedSummary: text("promoted_summary"),
    privacyState: text("privacy_state").notNull().default("private"),
    reviewState: text("review_state").notNull().default("imported"),
    tags: jsonb("tags").$type<string[]>().default([]),
    projectSlug: text("project_slug"),
    ownerName: text("owner_name"),
    whyItMatters: text("why_it_matters"),
    // Short AI-generated rationale produced at ingest time: "what's the value
    // in capturing this thread?" Distinct from whyItMatters (which operators
    // fill in when promoting to express strategic significance).
    captureReason: text("capture_reason"),
    sourcePayloadJson: jsonb("source_payload_json").$type<Record<string, unknown> | null>(),
    // Fork link: points at the thread this was forked from (same workspace).
    parentThreadId: text("parent_thread_id"),
    // Cross-workspace provenance: set when copied via promote/pull.
    promotedFromId: text("promoted_from_id"),
    pulledFromId: text("pulled_from_id"),
    visibleInStudio: integer("visible_in_studio").notNull().default(1),
    messageCount: integer("message_count").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_threads_workspace").on(t.workspaceId),
    index("idx_os_threads_workspace_state").on(t.workspaceId, t.reviewState),
    index("idx_os_threads_workspace_source").on(t.workspaceId, t.sourceApp),
    index("idx_os_threads_imported_at").on(t.importedAt),
    // Dedupe: within a single workspace, the same upstream thread key should
    // only land once. Nulls are allowed for manual pastes that have no key.
    uniqueIndex("idx_os_threads_workspace_source_key").on(
      t.workspaceId,
      t.sourceApp,
      t.sourceThreadKey
    ),
  ]
)

export const operatorThreadMessages = pgTable(
  "operator_thread_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    turnIndex: integer("turn_index").notNull(),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedBy: text("promoted_by"),
    promotionNote: text("promotion_note"),
    promotionKind: text("promotion_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_messages_thread").on(t.threadId, t.turnIndex),
    index("idx_os_messages_workspace").on(t.workspaceId),
  ]
)

export const operatorThreadSummaries = pgTable(
  "operator_thread_summaries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull(),
    summaryKind: text("summary_kind").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_summaries_thread").on(t.threadId),
    index("idx_os_summaries_workspace").on(t.workspaceId),
  ]
)

export const operatorChatSessions = pgTable(
  "operator_chat_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id"),
    sessionTitle: text("session_title"),
    operatorName: text("operator_name").notNull(),
    contextSnapshotJson: jsonb("context_snapshot_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_sessions_thread").on(t.threadId),
    index("idx_os_sessions_workspace").on(t.workspaceId),
  ]
)

export const operatorChatMessages = pgTable(
  "operator_chat_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    modelLabel: text("model_label"),
    contextSnapshotJson: jsonb("context_snapshot_json").$type<Record<string, unknown> | null>(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    promotedBy: text("promoted_by"),
    promotionNote: text("promotion_note"),
    promotionKind: text("promotion_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_chat_messages_session").on(t.sessionId, t.createdAt),
    index("idx_os_chat_messages_workspace").on(t.workspaceId),
  ]
)

export const operatorImportRuns = pgTable(
  "operator_import_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceApp: text("source_app").notNull(),
    sourcePath: text("source_path"),
    importedBy: text("imported_by").notNull(),
    threadCount: integer("thread_count").notNull().default(0),
    status: text("status").notNull().default("running"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_os_import_runs_workspace").on(t.workspaceId),
    index("idx_os_import_runs_status").on(t.status),
  ]
)

// ─── API tokens ─────────────────────────────────────────────────────────────
//
// Per-user bearer tokens for machine-facing routes. Tokens are stored as
// SHA-256 hashes; the plaintext is shown once at creation time. Each token
// carries a `display_name` which becomes the `importedBy` / `promotedBy`
// attribution when the token is used — i.e. calls authenticated with Alex's
// token are attributable to Alex regardless of what the caller claims.

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    // Optional workspace scope. When null, the token can reach any workspace
    // the active cookie / request params select. When set, it's pinned.
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    displayName: text("display_name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(), // first 8 chars for display
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("idx_api_tokens_hash").on(t.tokenHash),
    index("idx_api_tokens_workspace").on(t.workspaceId),
  ]
)

// ─── Webhook subscriptions ──────────────────────────────────────────────────
//
// Outbound webhooks fired when notable events happen (thread.promoted,
// thread.imported, etc). Secrets are shared with the receiver for HMAC
// signature verification.

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    secret: text("secret"),
    // Comma-separated event names the receiver cares about, e.g.
    // "thread.promoted,thread.imported". Null = all events.
    events: text("events"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    lastStatus: integer("last_status"),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [index("idx_webhooks_workspace").on(t.workspaceId)]
)

export const schema = {
  workspaces,
  operatorThreads,
  operatorThreadMessages,
  operatorThreadSummaries,
  operatorChatSessions,
  operatorChatMessages,
  operatorImportRuns,
  apiTokens,
  webhookSubscriptions,
}
