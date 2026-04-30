// Operator Studio schema — workspaces, threads, messages, summaries,
// continuation chat sessions, import runs.
//
// A workspace is an isolated namespace. One workspace is the "global" library
// (`is_global = 1`). Others are sub-workspaces. Threads live in exactly one
// workspace; they can be promoted (copied to global) or pulled down (copied
// from global to a sub-workspace). No implicit inheritance.

import {
  doublePrecision,
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
    // Stamped when the thread transitions into review_state = 'promoted'.
    // Distinct from updated_at, which moves on every edit. Null for
    // never-promoted threads.
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Persisted done-state. Null `markedDoneAt` = not done. Set by
    // either phrase-detection (source='phrase') or a manual click in
    // Operator Studio (source='manual'). See `lib/operator-studio/
    // thread-done.ts` for write paths.
    markedDoneAt: timestamp("marked_done_at", { withTimezone: true }),
    markedDoneBy: text("marked_done_by"),
    markedDoneSource: text("marked_done_source"),
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
    index("idx_os_messages_workspace_time").on(t.workspaceId, t.createdAt),
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
    index("idx_os_chat_messages_workspace_time").on(t.workspaceId, t.createdAt),
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

// ─── Work Sessions ──────────────────────────────────────────────────────────
//
// A work session segments LLM activity into discrete bursts bracketed by
// 3+ hour gaps. Each row represents one such burst of work.
// The time range (startedAt, endedAt) is authoritative — thread
// membership is derived at query time by timestamp overlap, so threads
// can appear in multiple sessions if you picked them back up after a
// break.
//
// Durable intent belongs to operator_plans. The planSteps JSON column below is
// legacy shadow storage from the pre-plan-table model and should not be read by
// new code.
//
// The segmentation logic is pure (see lib/operator-studio/sessions.ts)
// and materialized into this table on demand — upserts are idempotent
// via sessionIdFromStart (minute-resolution id derived from workspace
// + start timestamp).
export const operatorSessions = pgTable(
  "operator_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // User-editable display name. Falls back to a derived default
    // ("Apr 21 morning") when null — the UI should show the fallback
    // without persisting it.
    label: text("label"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    // Legacy ordered plan steps from the old session-owned plan model.
    // This column stays as a rollback shadow only — do NOT read from it in
    // new code. Use operator_plans + operator_plan_steps instead.
    planSteps: jsonb("plan_steps")
      .$type<
        Array<{
          id: string
          title: string
          description?: string
          order: number
        }>
      >()
      .default([]),
    // FK to operator_plans.id. Null = this session has no plan attached
    // yet (pre-backfill history or a session that started before a plan
    // existed).
    planId: text("plan_id"),
    // Derived metadata cached for the list view — recomputed when a
    // session's time range grows. Cheap to recompute, so we don't sweat
    // drift like we do with operator_threads.messageCount.
    threadCount: integer("thread_count").notNull().default(0),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_sessions_workspace").on(t.workspaceId),
    index("idx_os_sessions_started_at").on(t.startedAt),
    index("idx_os_sessions_plan").on(t.planId),
  ]
)

// ─── Plans ─────────────────────────────────────────────────────────────────
//
// Promoted from an inline jsonb column on operator_sessions into their
// own durable table (see 0007_session_plans.sql). A plan has a title, a
// measurable goal, an outcome description, lifecycle state, and a pin
// toggle. Sessions attach to plans N:1 so a plan can span many days.
export const operatorPlans = pgTable(
  "operator_plans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // "What are you trying to get done?" — one measurable sentence.
    goal: text("goal"),
    // "What does done look like?" — outcome description.
    outcome: text("outcome"),
    // drafting | active | paused | shipped | archived
    state: text("state").notNull().default("drafting"),
    // Stored as 0/1 to match the Postgres + SQLite convention used
    // elsewhere in this schema (workspaces.is_global, threads.visible_in_studio).
    pinned: integer("pinned").notNull().default(0),
    ownerName: text("owner_name"),
    createdBy: text("created_by").notNull(),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_plans_workspace").on(t.workspaceId),
    index("idx_os_plans_workspace_state").on(t.workspaceId, t.state),
    index("idx_os_plans_workspace_pinned").on(t.workspaceId, t.pinned),
  ]
)

export const operatorPlanSteps = pgTable(
  "operator_plan_steps",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => operatorPlans.id, { onDelete: "cascade" }),
    // Denormalized for workspace-scoped queries.
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    stepOrder: integer("step_order").notNull().default(0),
    // open | in-motion | covered | skipped — authoritative baseline.
    // View code can still layer evidence-derived coverage status on top.
    status: text("status").notNull().default("open"),
    // Tree relationship — a step can belong as a child to another step
    // in the same plan. NULL means it's a top-level / independent card.
    // Multiple children of one parent is supported (the field is on the
    // child); arbitrary DAG is not (single parent per step).
    parentStepId: text("parent_step_id"),
    // Atelier canvas coordinates. NULL falls back to a deterministic
    // grid layout client-side. Persisted on drag end.
    positionX: doublePrecision("position_x"),
    positionY: doublePrecision("position_y"),
    /** URL of an optional per-card cover image. Served by the studio
     *  uploads route handler at /api/operator-studio/uploads/step-covers/. */
    coverImageUrl: text("cover_image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_plan_steps_plan").on(t.planId, t.stepOrder),
    index("idx_os_plan_steps_workspace").on(t.workspaceId),
    index("idx_os_plan_steps_parent").on(t.parentStepId),
  ]
)

// ─── Step Evidence / Fulfillments ───────────────────────────────────────────
//
// Accepted evidence for a durable plan step. The table keeps the historical
// "fulfillment" name for compatibility, but product copy should say evidence.
// sessionId records the work session where the evidence was accepted; stepId is
// the durable plan-step link.
export const operatorStepFulfillments = pgTable(
  "operator_step_fulfillments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => operatorSessions.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    // "thread" | "message" — the kind of entity attached as evidence.
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    note: text("note"),
    promotedBy: text("promoted_by").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("idx_os_fulfill_unique").on(
      t.sessionId,
      t.stepId,
      t.targetType,
      t.targetId
    ),
    index("idx_os_fulfill_target").on(t.targetType, t.targetId),
    index("idx_os_fulfill_workspace").on(t.workspaceId),
  ]
)

// ─── Thread passages ────────────────────────────────────────────────────────
//
// Operator-promoted spans of text within a thread message. Standalone artifact
// — exists independent of any plan step. Powers thread-reader highlights and
// the "show all elevated passages" view; later, can be linked to a plan step
// as a third evidence kind alongside thread + message.
export const operatorThreadPassages = pgTable(
  "operator_thread_passages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => operatorThreads.id, { onDelete: "cascade" }),
    messageId: text("message_id")
      .notNull()
      .references(() => operatorThreadMessages.id, { onDelete: "cascade" }),
    // Character offsets into messages.content at promotion time. If the
    // message later edits and offsets drift, textSnapshot still wins —
    // it is the durable record of what the operator elevated.
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    textSnapshot: text("text_snapshot").notNull(),
    textHash: text("text_hash").notNull(),
    note: text("note"),
    promotedBy: text("promoted_by").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_passages_thread").on(t.threadId, t.promotedAt),
    index("idx_op_passages_message").on(t.messageId),
    index("idx_op_passages_workspace").on(t.workspaceId),
  ]
)

// ─── Notes (workspace scratchpad) ──────────────────────────────────────────
//
// Free-form nestable notes/todos. Same parent/child shape as plan steps so
// a note (or a parent + descendants) can be promoted to plan steps via the
// drag-from-rail interaction. Independent of plans/sessions — purely a
// per-workspace scratchpad.
export const operatorNotes = pgTable(
  "operator_notes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentNoteId: text("parent_note_id"),
    title: text("title").notNull().default(""),
    body: text("body"),
    /** lucide-react icon name (e.g. "Star"). Nullable; falls back to a
     *  bullet glyph in the row UI when null. */
    icon: text("icon"),
    sortIndex: integer("sort_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    /** Soft-delete tombstone. Active notes are `deleted_at IS NULL`;
     *  trash is the complement. A separate purge step removes rows
     *  permanently (TTL or user action). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_os_notes_workspace").on(t.workspaceId),
    index("idx_os_notes_parent").on(t.parentNoteId),
    index("idx_os_notes_workspace_sort").on(
      t.workspaceId,
      t.parentNoteId,
      t.sortIndex
    ),
  ]
)

// ─── Wayseer enrichments (per-thread LLM analysis) ────────────────────────
//
// Each row is one run of the thread-analysis contract for a given thread.
// status moves pending → running → completed|failed. result_payload holds
// the structured timeline/attitude/what-got-done JSON; the shape is
// governed by contract_version so we can detect stale rows when the
// prompt template or response schema evolve.
export const operatorThreadEnrichments = pgTable(
  "operator_thread_enrichments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => operatorThreads.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    contractVersion: text("contract_version").notNull(),
    resultPayload: jsonb("result_payload"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    latencyMs: integer("latency_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_op_enrichments_workspace").on(t.workspaceId),
    index("idx_op_enrichments_thread").on(t.threadId),
    index("idx_op_enrichments_thread_completed").on(
      t.threadId,
      t.completedAt
    ),
  ]
)

export const schema = {
  workspaces,
  operatorThreads,
  operatorThreadMessages,
  operatorThreadSummaries,
  operatorChatSessions,
  operatorChatMessages,
  operatorImportRuns,
  operatorSessions,
  operatorStepFulfillments,
  operatorThreadPassages,
  operatorPlans,
  operatorPlanSteps,
  operatorNotes,
  operatorThreadEnrichments,
  apiTokens,
  webhookSubscriptions,
}
