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
    /** Soft FK to a `software_factories` row. Plans without a factory
     *  belong to the implicit `factory-operator-studio` factory until
     *  the F7 plan-merge-up sweep moves them. Per
     *  `pattern-software-factory-context-air-gap`. */
    factoryId: text("factory_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_os_plans_workspace").on(t.workspaceId),
    index("idx_os_plans_workspace_state").on(t.workspaceId, t.state),
    index("idx_os_plans_workspace_pinned").on(t.workspaceId, t.pinned),
    index("idx_os_plans_workspace_factory").on(t.workspaceId, t.factoryId),
  ]
)

// ─── Software Factories — per-org production system bindings ──────────────
//
// A Software Factory binds plans + agents + KB to:
//   - a human team (org, named members, comms substrates),
//   - a product (one or more repos, deploys, prod URL),
//   - and an agentic loop scope (what the LLM watches, what it can write
//     to, who outbound communications go through).
//
// The first factory is `factory-clarifying-telegento`; a second is
// `factory-operator-studio` for meta-work on Operator Studio itself.
// New factories are added by inserting rows here — no schema change.
//
// See `pattern-software-factory-context-air-gap` and
// `kb-software-factory-doctrine` in the KB.
export const softwareFactories = pgTable(
  "software_factories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Friendly title used in surfaces. */
    label: text("label").notNull(),
    orgName: text("org_name").notNull(),
    productName: text("product_name").notNull(),
    /** Absolute filesystem path to the product's primary repo on the
     *  operator's machine. Handed to dispatched agents at launch as
     *  the cwd they are allowed to edit. */
    productRepoPath: text("product_repo_path"),
    productProdUrl: text("product_prod_url"),
    /** [{kind:'ado', org:'…', project:'…'}, {kind:'teams', …}, …] */
    commsSubstrates: jsonb("comms_substrates")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    /** AWS arns, lambdas, repos, supporting URLs — anything an agent
     *  needs to reason about the factory's runtime. Free-form jsonb.  */
    systemMap: jsonb("system_map")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Routing config for outbound — e.g. which Teams channel for
     *  priority bumps, which ADO project for new work items. */
    escalationTargets: jsonb("escalation_targets")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Named stakeholders + their roles. Read-only audience members
     *  appear here too. */
    audience: jsonb("audience")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    /** Free-form notes the operator wants every agent to read. */
    operatorNotes: text("operator_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("idx_software_factories_workspace").on(t.workspaceId)]
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
    /** Soft FK to a software_factories row. Per-step is preferred to
     *  per-plan because the historical plan-valikharlia-agentic-studio-buildout
     *  spans multiple factories' cards. Resolution order at read
     *  sites: step.factoryId ?? plan.factoryId ?? null. */
    factoryId: text("factory_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    /** Soft-delete tombstone. Active steps are `deleted_at IS NULL`; trash
     *  is the complement. Same pattern as operator_notes (migration 0015).
     *  Existing read paths filter `IS NULL` by default. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
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
//
// `labelId` (nullable FK to `operator_promotion_labels`) ties a passage to
// an admin-configured promotion label. Null = "highlighted without a label"
// (still useful as a sacrosanct human elevation; the label adds AI-readable
// context via the label's ai_context blurb).
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
    labelId: text("label_id"),
    promotedBy: text("promoted_by").notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_passages_thread").on(t.threadId, t.promotedAt),
    index("idx_op_passages_message").on(t.messageId),
    index("idx_op_passages_workspace").on(t.workspaceId),
    index("idx_op_passages_label").on(t.labelId),
  ]
)

// ─── Promotion labels (admin-configurable) ───────────────────────────
//
// Workspace-scoped, admin-managed set of named promotion flags. Each
// label has a display name + an `aiContext` blurb that downstream
// AI consumers (Wayseer prompts, KB generation) treat as the
// definition of what the label means. Soft-deletable so retiring a
// label doesn't orphan historical passages.
export const operatorPromotionLabels = pgTable(
  "operator_promotion_labels",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** "What does this label mean to the AI" blurb. Concatenated into
     *  prompts that consume the labeled passage. */
    aiContext: text("ai_context").notNull().default(""),
    /** lucide-react icon name; falls back to a flame glyph. */
    icon: text("icon"),
    /** Tailwind color segment ("emerald", "amber", …). Free-form. */
    color: text("color"),
    sortIndex: integer("sort_index").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_op_promotion_labels_workspace").on(t.workspaceId),
    index("idx_op_promotion_labels_workspace_sort").on(
      t.workspaceId,
      t.sortIndex
    ),
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

// ─── Beta phone surface device tokens + audit log ───────────────────────────
//
// Per-device bearer tokens for /api/beta/*. token_hash is sha256 of the
// plaintext — plaintext is never stored. The CLI prints it once at mint.
//
// Env-var token (OPERATOR_STUDIO_BETA_TOKEN) stays valid as a "legacy-env"
// identity for backwards compat — see app/api/beta/_device-tokens.ts.

export const betaDeviceTokens = pgTable(
  "beta_device_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    deviceLabel: text("device_label").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("idx_beta_device_tokens_token_hash").on(t.tokenHash)]
)

export const betaAuthLog = pgTable(
  "beta_auth_log",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").references(() => betaDeviceTokens.id, {
      onDelete: "set null",
    }),
    endpoint: text("endpoint").notNull(),
    // ok | invalid | revoked | expired | missing | legacy-env
    outcome: text("outcome").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_beta_auth_log_device").on(t.deviceId, t.createdAt),
    index("idx_beta_auth_log_created").on(t.createdAt),
  ]
)

// ─── Per-workspace optional module flags ─────────────────────────────
//
// Generic enable-ment table. `module_key` is a stable identifier
// ("knowledge_base" today; future modules attach without schema
// changes). Surfaces and writers MUST gate on `enabled = 1` before
// doing work — the KB is opt-in, not on-by-default.
export const workspaceModules = pgTable(
  "workspace_modules",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull(),
    enabled: integer("enabled").notNull().default(0),
    configJson: jsonb("config_json").$type<Record<string, unknown> | null>(),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    enabledBy: text("enabled_by"),
  },
  (t) => [
    uniqueIndex("idx_workspace_modules_pk").on(t.workspaceId, t.moduleKey),
    index("idx_workspace_modules_enabled").on(
      t.workspaceId,
      t.moduleKey,
      t.enabled
    ),
  ]
)

// ─── Knowledge Base — entries (article layer) ─────────────────────────
//
// Encyclopedic markdown articles. Curated from claim clusters or
// hand-written. Browseable surface modeled 1:1 on AIDA Observatory
// intelligence/memory. Citations stay inline (jsonb) — one INSERT/
// SELECT per write. Side table for cross-entry citation queries
// can come later if it earns its place.
export const operatorKbEntries = pgTable(
  "operator_kb_entries",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // concept | pattern | metric | procedure | agent | comparison |
    // anomaly | todo | report
    entryType: text("entry_type").notNull().default("concept"),
    // evergreen | stable | fluctuant | draft
    stability: text("stability").notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    bodyMarkdown: text("body_markdown").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    relatedEntryIds: jsonb("related_entry_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    parentEntryId: text("parent_entry_id"),
    sourceThreadId: text("source_thread_id").references(
      () => operatorThreads.id,
      { onDelete: "set null" }
    ),
    sourcePassageIds: jsonb("source_passage_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** Inline citations referenced from the body markdown. Each entry:
     *  { kind: "passage"|"message"|"thread"|"claim",
     *    threadId?, messageId?, passageId?, claimId?,
     *    excerpt?: string, label?: string } */
    citations: jsonb("citations")
      .$type<KbCitation[]>()
      .notNull()
      .default([]),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    refreshIntervalHours: integer("refresh_interval_hours"),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
    lastUserEditAt: timestamp("last_user_edit_at", { withTimezone: true }),
    lastUserEditBy: text("last_user_edit_by"),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    versionCount: integer("version_count").notNull().default(1),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_kb_entries_workspace").on(t.workspaceId),
    index("idx_op_kb_entries_workspace_updated").on(
      t.workspaceId,
      t.updatedAt
    ),
    index("idx_op_kb_entries_workspace_type").on(t.workspaceId, t.entryType),
    index("idx_op_kb_entries_workspace_stability").on(
      t.workspaceId,
      t.stability
    ),
    index("idx_op_kb_entries_parent").on(t.parentEntryId),
  ]
)

// ─── Knowledge Base — claims (atomic-fact layer) ──────────────────────
//
// One claim = one proposition. Cheap for an LLM to produce from a
// promoted passage; easy to supersede when newer evidence arrives.
// Claims are what entries cite. Confidence is 0..1 from the model.
// valid_at = when the claim was true (defaults to created_at).
export const operatorKbClaims = pgTable(
  "operator_kb_claims",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    /** Optional subject — the entity the claim is about (an agent,
     *  a feature, a metric). Helps cluster claims for entry curation. */
    subject: text("subject"),
    confidence: doublePrecision("confidence").notNull().default(0.8),
    sourceThreadId: text("source_thread_id").references(
      () => operatorThreads.id,
      { onDelete: "set null" }
    ),
    sourceMessageId: text("source_message_id").references(
      () => operatorThreadMessages.id,
      { onDelete: "set null" }
    ),
    sourcePassageId: text("source_passage_id").references(
      () => operatorThreadPassages.id,
      { onDelete: "set null" }
    ),
    sourceExcerpt: text("source_excerpt"),
    validAt: timestamp("valid_at", { withTimezone: true }).notNull(),
    /** When set, this claim was contradicted/replaced by another. The
     *  pointer is to a sibling claim id in the same workspace. */
    supersededById: text("superseded_by_id"),
    /** Best-effort cache of entry ids that cite this claim. Rebuildable
     *  by scanning entries.citations[].claim_id. */
    citedByEntryIds: jsonb("cited_by_entry_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    promptVersion: text("prompt_version"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_kb_claims_workspace").on(t.workspaceId),
    index("idx_op_kb_claims_workspace_valid").on(t.workspaceId, t.validAt),
    index("idx_op_kb_claims_thread").on(t.sourceThreadId),
    index("idx_op_kb_claims_passage").on(t.sourcePassageId),
    index("idx_op_kb_claims_active").on(t.workspaceId, t.supersededById),
  ]
)

/** Inline citation shape used in operator_kb_entries.citations[]. */
export interface KbCitation {
  kind: "passage" | "message" | "thread" | "claim"
  threadId?: string
  messageId?: string
  passageId?: string
  claimId?: string
  excerpt?: string
  label?: string
}

// ─── Continuum ─────────────────────────────────────────────────────────────
//
// A persisted handoff packet — see drizzle/0021_continuums.sql for the
// rationale. The digest_json column stores a versioned shape; the v1
// `ContinuumDigestV1` is defined in lib/operator-studio/continuum.ts so
// the schema layer stays free of feature-specific shapes. JSONB here is
// deliberate — it lets the heuristic and (eventual) LLM-drafted shapes
// share storage without a migration.
export const operatorContinuums = pgTable(
  "operator_continuums",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Soft reference (no FK) — the Continuum row should survive thread
     *  deletion as a frozen snapshot. */
    sourceThreadId: text("source_thread_id").notNull(),
    digestJson: jsonb("digest_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    resumePrompt: text("resume_prompt").notNull(),
    /** draft | published | consumed */
    status: text("status").notNull().default("draft"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_continuums_workspace").on(t.workspaceId),
    index("idx_op_continuums_source_thread").on(t.workspaceId, t.sourceThreadId),
    index("idx_op_continuums_created_at").on(t.workspaceId, t.createdAt),
  ]
)

// ─── David-only review bucket ─────────────────────────────────────────
//
// Interstitial layer between agent inference (or any upstream signal)
// and team-visible surfaces. Raw conclusions land here as `david_only`
// until promoted/edited/rejected/snoozed/imported. Generic across
// lanes — TeleGento, Valikharlia, etc. surface as `source_type` values,
// not bespoke tables.
//
// state machine:
//   raw → summarized → candidate → (imported | promoted | rejected | snoozed)
export const operatorReviewItems = pgTable(
  "operator_review_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Free-form. Recommended: ado | teams | agent | known_issue |
     *  product_narrative | deployment | signal_intake. */
    sourceType: text("source_type").notNull(),
    sourceLabel: text("source_label"),
    /** Stable upstream identifier (work item id, message id, agent
     *  run id, commit sha). Combined with sourceType for dedupe. */
    sourceId: text("source_id"),
    sourceUrl: text("source_url"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    rawText: text("raw_text"),
    rawPayload: jsonb("raw_payload").$type<Record<string, unknown> | null>(),
    proposedAction: text("proposed_action"),
    /** Soft reference. No FK so review items survive plan-step deletes. */
    relatedPlanStepId: text("related_plan_step_id"),
    /** david_only | promoted */
    visibility: text("visibility").notNull().default("david_only"),
    /** raw | summarized | candidate | imported | promoted | rejected | snoozed */
    state: text("state").notNull().default("raw"),
    confidence: doublePrecision("confidence"),
    rationale: text("rationale"),
    agentRunId: text("agent_run_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_review_items_workspace").on(t.workspaceId),
    index("idx_op_review_items_workspace_state").on(t.workspaceId, t.state),
    index("idx_op_review_items_workspace_source").on(
      t.workspaceId,
      t.sourceType,
      t.sourceId
    ),
  ]
)

// ─── Thread → plan-card bindings ────────────────────────────────────────────
//
// Durable record of "this Claude/Codex/tmux worker is operating on this
// plan card." Replaces the localStorage map that the Bento UI uses for
// the same purpose so the binding survives across browsers and is
// readable by server-side derivation (Operations desk, MCP tools, the
// recent-activity API).
//
// One active binding per (workspaceId, agentId). Detached rows preserve
// history; the unique index is partial on `detached_at IS NULL`.
//
// Soft FK to plan_step_id (no real FK) so a plan-step soft-delete
// doesn't fail binding writes; readers should join carefully.
export const operatorThreadCardBindings = pgTable(
  "operator_thread_card_bindings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Composite agent id, e.g. `claude:<uuid>`, `codex:rollout-…`. */
    agentId: text("agent_id").notNull(),
    /** claude | codex | tmux (free-form for forward-compat). */
    agentKind: text("agent_kind").notNull(),
    planStepId: text("plan_step_id").notNull(),
    /** Denormalized — cheap lookups when the active plan changes rarely. */
    planId: text("plan_id"),
    /** launch | manual | tail-sniff | scheduled. */
    source: text("source").notNull(),
    confidence: doublePrecision("confidence"),
    rationale: text("rationale"),
    sourceRecommendationId: text("source_recommendation_id"),
    /** Composite agent id of the executive that originated this binding's
     *  agent (e.g. `claude:<uuid>` of the cockpit exec). Null for
     *  bindings created without an executive context (legacy launches,
     *  manual adoptions, operator-recommendation launches). */
    spawnedByAgentId: text("spawned_by_agent_id"),
    /** How the spawn was originated. Free-form for forward-compat —
     *  current values: `cockpit` | `recommendation` | `manual`. */
    spawnOrigin: text("spawn_origin"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    /** Soft-detach. Keeps the historical link out of "current" reads. */
    detachedAt: timestamp("detached_at", { withTimezone: true }),
  },
  // The migration also creates a partial unique index on
  // (workspace_id, agent_id) WHERE detached_at IS NULL — drizzle's
  // index DSL doesn't model partial uniques cleanly, so it lives in
  // SQL only. Readers should treat (workspace_id, agent_id, detached_at)
  // as the active-row key.
  (t) => [
    index("idx_op_thread_bindings_step").on(t.workspaceId, t.planStepId),
    index("idx_op_thread_bindings_workspace").on(t.workspaceId),
    index("idx_op_thread_bindings_agent").on(t.workspaceId, t.agentId),
    index("idx_op_thread_bindings_spawned_by").on(t.workspaceId, t.spawnedByAgentId),
  ]
)

// ─── Outbox — staged outbound communications (gated send) ─────────────────
//
// Every outbound communication (ADO comment, Teams post, ADO state/priority
// change, stakeholder reply, preview-deploy URL handoff, …) is staged here
// as a row first. The Outbound PIN gate
// (`lib/server/agent-bridge/outbound-mode.ts`) consumes a per-row,
// payload-hash-bound approval at send time. Direct external writes that
// bypass this row are considered a bug per
// `pattern-outbound-pin-gate`.
//
// Lifecycle: draft → awaiting_approval → approved → sent
//                                     → rejected
//                                     → expired (armed window passed)
export const operatorOutboxMessages = pgTable(
  "operator_outbox_messages",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Soft FK to a software_factories row when F4 lands; nullable
     *  until then. */
    factoryId: text("factory_id"),
    /** ado | teams | preview_deploy | email | stakeholder_reply | … */
    surface: text("surface").notNull(),
    /** Verb-noun pair, e.g. "ado.addComment", "teams.postMessage". */
    action: text("action").notNull(),
    /** Upstream identifier (ADO work-item id, Teams channel id, …). */
    targetId: text("target_id").notNull(),
    /** Human-readable target label, e.g. "ADO #39". */
    targetLabel: text("target_label"),
    /** Display-only audience list, e.g. ["Micky","Rob"]. Not used to
     *  auto-mention — kept for the operator's situational awareness. */
    audience: jsonb("audience").$type<string[]>().notNull().default([]),
    /** The exact payload that will be passed to the outbound writer.
     *  Hashed (canonical-JSON sha256) to bind to a per-row approval. */
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    /** Operator-facing rendered text — what David proofreads. May
     *  diverge from payload_json.text after edit; the writer always
     *  uses payload_json. */
    renderedText: text("rendered_text").notNull(),
    /** Null when LLM-authored; set when David edits. */
    renderedTextEditedBy: text("rendered_text_edited_by"),
    /** LLM-supplied "why this needs to go out". */
    rationale: text("rationale"),
    /** draft | awaiting_approval | approved | sent | rejected | expired */
    state: text("state").notNull().default("draft"),
    /** Provenance for audit. Free-form. */
    llmRunId: text("llm_run_id"),
    /** Inbox event ids that triggered this draft. */
    sourceInboxEventIds: jsonb("source_inbox_event_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    relatedPlanStepId: text("related_plan_step_id"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Recomputed and stored at send time. The gate compares this to
     *  the hash bound at approval time. */
    payloadHash: text("payload_hash"),
    /** Writer response (e.g. {rev: 6, workItemUrl: "..."}). */
    sendResult: jsonb("send_result").$type<Record<string, unknown> | null>(),
    /** Set when the writer threw (gate rejection or upstream failure). */
    sendError: text("send_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_outbox_workspace").on(t.workspaceId),
    index("idx_op_outbox_workspace_state").on(t.workspaceId, t.state),
    index("idx_op_outbox_workspace_surface_target").on(
      t.workspaceId,
      t.surface,
      t.targetId
    ),
  ]
)

// ─── Inbox events — read-only mirror of upstream events ────────────────────
//
// Generic mirror of upstream-event ingestion (ADO comments / state
// transitions, Teams posts, stakeholder feature requests, …). Per
// `pattern-inbox-ingest` in the KB.
//
// Three permission tiers governing how the LLM may act on these rows
// live in the tool / route layer (free read, confirm continuation,
// hot-mode engineering, outbound-gated). The inbox itself is read-only
// — no row here ever causes a side effect against an external system.
export const operatorInboxEvents = pgTable(
  "operator_inbox_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Soft FK to a software_factories row when scoped to one.  */
    factoryId: text("factory_id"),
    /** ado | teams | stakeholder_request | linear | atlassian_status | … */
    surface: text("surface").notNull(),
    /** Stable upstream identifier. With surface, used for dedupe via a
     *  partial unique index (created in SQL). */
    upstreamId: text("upstream_id"),
    /** comment | state_transition | priority_change | assignment_change
     *  | mention | feature_request | reply | post | … */
    upstreamKind: text("upstream_kind").notNull(),
    actorName: text("actor_name"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payloadJson: jsonb("payload_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    textExcerpt: text("text_excerpt"),
    relatedWorkId: text("related_work_id"),
    relatedWorkLabel: text("related_work_label"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull(),
    /** LLM's first-pass read of this event. Bounded (≤1KB by
     *  convention) and one-shot from the LLM side. */
    llmInitialLog: text("llm_initial_log"),
    llmInitialLogAt: timestamp("llm_initial_log_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("idx_op_inbox_workspace").on(t.workspaceId),
    index("idx_op_inbox_workspace_factory_occurred").on(
      t.workspaceId,
      t.factoryId,
      t.occurredAt
    ),
    index("idx_op_inbox_workspace_surface").on(
      t.workspaceId,
      t.surface,
      t.occurredAt
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
  betaDeviceTokens,
  betaAuthLog,
  workspaceModules,
  operatorKbEntries,
  operatorKbClaims,
  operatorPromotionLabels,
  operatorContinuums,
  operatorReviewItems,
  operatorThreadCardBindings,
  operatorOutboxMessages,
  softwareFactories,
  operatorInboxEvents,
}
