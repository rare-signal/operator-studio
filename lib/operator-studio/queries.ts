import { and, asc, desc, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorChatMessages,
  operatorChatSessions,
  operatorImportRuns,
  operatorPlans,
  operatorPlanSteps,
  operatorSessions,
  operatorStepFulfillments,
  operatorThreadMessages,
  operatorThreadPassages,
  operatorThreadSummaries,
  operatorThreads,
} from "@/lib/server/db/schema"
import {
  computeSessions,
  sessionIdFromStart,
  type ActivityPoint,
} from "./sessions"
import type {
  OperatorChatMessage,
  OperatorChatSession,
  OperatorDashboardStats,
  OperatorFulfillmentTargetType,
  OperatorImportRun,
  OperatorPlanStep,
  OperatorReviewState,
  OperatorSession,
  OperatorSourceApp,
  OperatorStepFulfillment,
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadPassage,
  OperatorThreadSummary,
  PromotionKind,
} from "./types"

// ─── Row → Domain mappers ────────────────────────────────────────────────────

function toThread(row: typeof operatorThreads.$inferSelect): OperatorThread {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceApp: row.sourceApp as OperatorSourceApp,
    sourceThreadKey: row.sourceThreadKey,
    sourceLocator: row.sourceLocator,
    importedBy: row.importedBy,
    importedAt: row.importedAt.toISOString(),
    importRunId: row.importRunId,
    rawTitle: row.rawTitle,
    rawSummary: row.rawSummary,
    promotedTitle: row.promotedTitle,
    promotedSummary: row.promotedSummary,
    privacyState: row.privacyState as "private" | "team",
    reviewState: row.reviewState as OperatorReviewState,
    tags: (row.tags as string[] | null) ?? [],
    projectSlug: row.projectSlug,
    ownerName: row.ownerName,
    whyItMatters: row.whyItMatters,
    captureReason: row.captureReason,
    parentThreadId: row.parentThreadId,
    promotedFromId: row.promotedFromId,
    pulledFromId: row.pulledFromId,
    visibleInStudio: row.visibleInStudio === 1,
    messageCount: row.messageCount,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    markedDoneAt: row.markedDoneAt?.toISOString() ?? null,
    markedDoneBy: row.markedDoneBy ?? null,
    markedDoneSource:
      row.markedDoneSource === "phrase" || row.markedDoneSource === "manual"
        ? row.markedDoneSource
        : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toMessage(
  row: typeof operatorThreadMessages.$inferSelect
): OperatorThreadMessage {
  return {
    id: row.id,
    threadId: row.threadId,
    role: row.role as OperatorThreadMessage["role"],
    content: row.content,
    turnIndex: row.turnIndex,
    metadataJson: row.metadataJson as Record<string, unknown> | null,
    promotedAt: row.promotedAt?.toISOString() ?? null,
    promotedBy: row.promotedBy ?? null,
    promotionNote: row.promotionNote ?? null,
    promotionKind: row.promotionKind as OperatorThreadMessage["promotionKind"],
    createdAt: row.createdAt.toISOString(),
  }
}

function toSummary(
  row: typeof operatorThreadSummaries.$inferSelect
): OperatorThreadSummary {
  return {
    id: row.id,
    threadId: row.threadId,
    summaryKind: row.summaryKind as OperatorThreadSummary["summaryKind"],
    content: row.content,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

function toChatSession(
  row: typeof operatorChatSessions.$inferSelect
): OperatorChatSession {
  return {
    id: row.id,
    threadId: row.threadId,
    sessionTitle: row.sessionTitle,
    operatorName: row.operatorName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toChatMessage(
  row: typeof operatorChatMessages.$inferSelect
): OperatorChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as "user" | "assistant",
    content: row.content,
    modelLabel: row.modelLabel,
    promotedAt: row.promotedAt?.toISOString() ?? null,
    promotedBy: row.promotedBy ?? null,
    promotionNote: row.promotionNote ?? null,
    promotionKind: row.promotionKind as OperatorChatMessage["promotionKind"],
    createdAt: row.createdAt.toISOString(),
  }
}

function toImportRun(
  row: typeof operatorImportRuns.$inferSelect
): OperatorImportRun {
  return {
    id: row.id,
    sourceApp: row.sourceApp as OperatorSourceApp,
    sourcePath: row.sourcePath,
    importedBy: row.importedBy,
    threadCount: row.threadCount,
    status: row.status as OperatorImportRun["status"],
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

// ─── Thread queries (workspace-scoped) ──────────────────────────────────────

export async function getVisibleThreads(
  workspaceId: string,
  opts?: { limit?: number }
): Promise<OperatorThread[]> {
  const db = getDb()
  const base = db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.visibleInStudio, 1)
      )
    )
    .orderBy(desc(operatorThreads.importedAt))
  const rows =
    typeof opts?.limit === "number" && opts.limit > 0
      ? await base.limit(opts.limit)
      : await base
  return rows.map(toThread)
}

/**
 * Lightweight summary of visible threads — just the counts the
 * sidebar needs, aggregated at the DB. Returns O(1) rows instead of
 * O(N), so it's safe to call on every navigation.
 *
 * Used in place of {@link getVisibleThreads} for shell chrome:
 * the sidebar's "By Status" + "By Source" subgroups only need
 * counts, not full thread rows. On a workspace with 1k+ threads
 * this is ~50× faster and lets the shell paint instantly.
 */
export interface ThreadCountSummary {
  byState: Record<string, number>
  bySource: Record<string, number>
  total: number
}

export async function getThreadCounts(
  workspaceId: string
): Promise<ThreadCountSummary> {
  const db = getDb()
  // Single indexed aggregation. Drizzle's sql-tag for the COUNT(*)
  // since .select() group-by + count reads cleaner raw.
  const rows = await db.execute<{
    source_app: string
    review_state: string
    n: string
  }>(sql`
    SELECT source_app, review_state, COUNT(*)::text AS n
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
      AND visible_in_studio = 1
    GROUP BY source_app, review_state
  `)
  const raw = (rows as unknown as {
    rows: Array<{ source_app: string; review_state: string; n: string }>
  }).rows

  const byState: Record<string, number> = {}
  const bySource: Record<string, number> = {}
  let total = 0
  for (const r of raw) {
    const n = parseInt(r.n, 10) || 0
    byState[r.review_state] = (byState[r.review_state] ?? 0) + n
    bySource[r.source_app] = (bySource[r.source_app] ?? 0) + n
    total += n
  }
  return { byState, bySource, total }
}

export async function getThreadsByState(
  workspaceId: string,
  state: OperatorReviewState
): Promise<OperatorThread[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.reviewState, state),
        eq(operatorThreads.visibleInStudio, 1)
      )
    )
    .orderBy(desc(operatorThreads.importedAt))
  return rows.map(toThread)
}

export async function getThreadsBySource(
  workspaceId: string,
  source: OperatorSourceApp
): Promise<OperatorThread[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.sourceApp, source)
      )
    )
    .orderBy(desc(operatorThreads.importedAt))
  return rows.map(toThread)
}

export async function findThreadBySourceKey(
  workspaceId: string,
  sourceApp: string,
  sourceThreadKey: string
): Promise<OperatorThread | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.sourceApp, sourceApp),
        eq(operatorThreads.sourceThreadKey, sourceThreadKey)
      )
    )
    .limit(1)
  return rows[0] ? toThread(rows[0]) : null
}

export async function getThreadById(
  workspaceId: string,
  id: string
): Promise<OperatorThread | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.id, id),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
    .limit(1)
  return rows[0] ? toThread(rows[0]) : null
}

export async function getThreadMessages(
  workspaceId: string,
  threadId: string
): Promise<OperatorThreadMessage[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        eq(operatorThreadMessages.threadId, threadId)
      )
    )
    .orderBy(operatorThreadMessages.turnIndex)
  return rows.map(toMessage)
}

export async function getThreadSummaries(
  workspaceId: string,
  threadId: string
): Promise<OperatorThreadSummary[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadSummaries)
    .where(
      and(
        eq(operatorThreadSummaries.workspaceId, workspaceId),
        eq(operatorThreadSummaries.threadId, threadId)
      )
    )
    .orderBy(desc(operatorThreadSummaries.createdAt))
  return rows.map(toSummary)
}

/**
 * Bulk "bookend" preview for a list of threads. For each thread,
 * returns: started/ended timestamps, total message count, and the
 * first user, first assistant, last user, last assistant messages
 * (each with content + createdAt). Used to pre-warm the recent-rail
 * hover popover so first hover is instant.
 *
 * Uses window functions to fetch at most ~4 messages per thread —
 * cheap even for very long threads.
 */
export type OperatorThreadBookend = {
  role: "user" | "assistant"
  content: string
  createdAt: string
}

export type OperatorThreadPreview = {
  threadId: string
  startedAt: string
  endedAt: string
  messageCount: number
  firstUser: OperatorThreadBookend | null
  firstAssistant: OperatorThreadBookend | null
  lastUser: OperatorThreadBookend | null
  lastAssistant: OperatorThreadBookend | null
}

export async function getThreadPreviews(
  workspaceId: string,
  threadIds: string[]
): Promise<Record<string, OperatorThreadPreview>> {
  if (threadIds.length === 0) return {}
  const db = getDb()
  const idList = sql.join(
    threadIds.map((id) => sql`${id}`),
    sql`, `
  )
  const bookendRows = await db.execute<{
    thread_id: string
    role: string
    content: string
    created_at: string
    rn_asc: number
    rn_desc: number
  }>(sql`
    SELECT thread_id, role, content, created_at, rn_asc, rn_desc
    FROM (
      SELECT
        thread_id, role, content, created_at,
        ROW_NUMBER() OVER (PARTITION BY thread_id, role ORDER BY turn_index ASC) AS rn_asc,
        ROW_NUMBER() OVER (PARTITION BY thread_id, role ORDER BY turn_index DESC) AS rn_desc
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND thread_id IN (${idList})
        AND role IN ('user', 'assistant')
    )
    WHERE rn_asc = 1 OR rn_desc = 1
  `)

  const aggRows = await db.execute<{
    thread_id: string
    count: number
    min_at: string
    max_at: string
  }>(sql`
    SELECT thread_id,
           COUNT(*) AS count,
           MIN(created_at) AS min_at,
           MAX(created_at) AS max_at
    FROM operator_thread_messages
    WHERE workspace_id = ${workspaceId}
      AND thread_id IN (${idList})
    GROUP BY thread_id
  `)

  const bookends = (bookendRows as unknown as { rows: Array<Record<string, unknown>> }).rows
  const aggs = (aggRows as unknown as { rows: Array<Record<string, unknown>> }).rows

  const result: Record<string, OperatorThreadPreview> = {}
  for (const id of threadIds) {
    result[id] = {
      threadId: id,
      startedAt: "",
      endedAt: "",
      messageCount: 0,
      firstUser: null,
      firstAssistant: null,
      lastUser: null,
      lastAssistant: null,
    }
  }
  for (const r of aggs) {
    const id = r.thread_id as string
    const target = result[id]
    if (!target) continue
    target.messageCount = Number(r.count) || 0
    target.startedAt = new Date(r.min_at as string).toISOString()
    target.endedAt = new Date(r.max_at as string).toISOString()
  }
  for (const r of bookends) {
    const id = r.thread_id as string
    const target = result[id]
    if (!target) continue
    const role = r.role === "assistant" ? "assistant" : "user"
    const bookend: OperatorThreadBookend = {
      role,
      content: r.content as string,
      createdAt: new Date(r.created_at as string).toISOString(),
    }
    const isFirst = Number(r.rn_asc) === 1
    const isLast = Number(r.rn_desc) === 1
    if (isFirst) {
      if (role === "user") target.firstUser = bookend
      else target.firstAssistant = bookend
    }
    if (isLast) {
      if (role === "user") target.lastUser = bookend
      else target.lastAssistant = bookend
    }
  }
  // If first === last for a role (single message of that role), drop the
  // last so the UI doesn't render the same message twice.
  for (const id of threadIds) {
    const t = result[id]
    if (t.firstUser && t.lastUser && t.firstUser.createdAt === t.lastUser.createdAt) {
      t.lastUser = null
    }
    if (
      t.firstAssistant &&
      t.lastAssistant &&
      t.firstAssistant.createdAt === t.lastAssistant.createdAt
    ) {
      t.lastAssistant = null
    }
  }
  return result
}

// ─── Thread mutations ────────────────────────────────────────────────────────

/**
 * Update a thread's raw_title in place. Used by the importer's dedup
 * branch to auto-heal stale prompt-derived titles once the upstream
 * tool (Claude Code, Codex) has assigned a real AI-generated name.
 *
 * The caller is responsible for guarding on `promoted_title === null`
 * — a user-set custom title should never be overwritten.
 */
export async function updateThreadRawTitle(
  workspaceId: string,
  threadId: string,
  rawTitle: string
) {
  const db = getDb()
  await db
    .update(operatorThreads)
    .set({ rawTitle, updatedAt: new Date() })
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
}

export async function updateThreadReviewState(
  workspaceId: string,
  threadId: string,
  reviewState: OperatorReviewState
) {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorThreads)
    .set({
      reviewState,
      updatedAt: now,
      ...(reviewState === "archived" ? { archivedAt: now } : {}),
      // Stamp promoted_at on the transition to 'promoted'. If the thread is
      // being re-promoted (rare), this overwrites — acceptable for demo.
      ...(reviewState === "promoted" ? { promotedAt: now } : {}),
    })
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
}

export async function softDeleteThread(workspaceId: string, threadId: string) {
  const db = getDb()
  await db
    .update(operatorThreads)
    .set({ visibleInStudio: 0, archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
}

export async function unarchiveThread(workspaceId: string, threadId: string) {
  const db = getDb()
  await db
    .update(operatorThreads)
    .set({
      visibleInStudio: 1,
      archivedAt: null,
      reviewState: "in-review",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
}

export async function promoteThreadMetadata(
  workspaceId: string,
  threadId: string,
  data: {
    promotedTitle: string
    promotedSummary: string
    whyItMatters?: string
    tags?: string[]
    projectSlug?: string
  }
) {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorThreads)
    .set({
      promotedTitle: data.promotedTitle,
      promotedSummary: data.promotedSummary,
      whyItMatters: data.whyItMatters ?? null,
      tags: data.tags ?? [],
      projectSlug: data.projectSlug ?? null,
      reviewState: "promoted",
      privacyState: "team",
      updatedAt: now,
      promotedAt: now,
    })
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )

  await db.insert(operatorThreadSummaries).values({
    id: `sum-${threadId}-promoted-${Date.now()}`,
    workspaceId,
    threadId,
    summaryKind: "promoted",
    content: data.promotedSummary,
    createdBy: "operator",
    createdAt: now,
  })
}

// ─── Fork a thread for continuation ─────────────────────────────────────────

/**
 * Fork a thread into an editable derivative with its own history.
 *
 * The fork carries the parent's messages forward so the new thread isn't
 * an empty shell — it's a proper diverge point the operator can continue
 * from. The parent is linked via `parentThreadId` for provenance.
 *
 * When called with `sourceMessages`, those override the copied parent
 * messages — used by the staleness-banner "fork with updates" flow to
 * pull a fresh re-parse of the upstream file instead of the stale stored
 * copy.
 *
 * `sourceThreadKey` is always null on forks (derived artifact, not a
 * fresh capture of the upstream session).
 */
export async function forkThread(
  workspaceId: string,
  parentThreadId: string,
  forkedBy: string,
  sourceMessages?: Array<{
    role: string
    content: string
    timestamp?: string
  }>,
  opts?: {
    /**
     * Fork-at-point: only copy parent messages with turnIndex <=
     * atTurnIndex. Use case: "I drifted off track at turn 42, let me
     * fork back from turn 30 and try a different direction." Ignored
     * when `sourceMessages` is provided (upstream re-parse doesn't
     * have a native turn model we can slice).
     */
    atTurnIndex?: number
  }
): Promise<OperatorThread> {
  const parent = await getThreadById(workspaceId, parentThreadId)
  if (!parent) throw new Error("Parent thread not found")

  const db = getDb()
  const now = new Date()
  const forkId = `thread-fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Decide which messages populate the fork. Upstream re-parse (if provided)
  // wins; otherwise copy the parent's stored messages as the diverge base.
  // When atTurnIndex is set, slice the copied messages at that point.
  let forkMessages: Array<{ role: string; content: string; createdAt: Date }>
  if (sourceMessages && sourceMessages.length > 0) {
    forkMessages = sourceMessages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.timestamp ? new Date(m.timestamp) : now,
    }))
  } else {
    const parentMessages = await getThreadMessages(workspaceId, parentThreadId)
    const sliced =
      typeof opts?.atTurnIndex === "number"
        ? parentMessages.filter((m) => m.turnIndex <= opts.atTurnIndex!)
        : parentMessages
    forkMessages = sliced.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: new Date(m.createdAt),
    }))
  }

  const row = {
    id: forkId,
    workspaceId,
    sourceApp: parent.sourceApp,
    // Forks are derived artifacts, not fresh captures of the same upstream
    // session. Leaving `sourceThreadKey` null avoids a collision on the
    // (workspace, source, sourceThreadKey) unique index AND prevents the
    // fork from being mistakenly deduped against the parent in future
    // sync polls.
    sourceThreadKey: null,
    sourceLocator: parent.sourceLocator,
    importedBy: forkedBy,
    importedAt: now,
    importRunId: null,
    rawTitle: `${parent.promotedTitle ?? parent.rawTitle ?? "Untitled"} (fork)`,
    rawSummary: null,
    promotedTitle: null,
    promotedSummary: null,
    privacyState: "private" as const,
    reviewState: "in-review" as const,
    tags: [...parent.tags],
    projectSlug: parent.projectSlug,
    ownerName: forkedBy,
    whyItMatters: null,
    captureReason: parent.captureReason,
    sourcePayloadJson: null,
    parentThreadId,
    promotedFromId: null,
    pulledFromId: null,
    visibleInStudio: 1,
    messageCount: forkMessages.length,
    promotedAt: null,
    archivedAt: null,
    markedDoneAt: null,
    markedDoneBy: null,
    markedDoneSource: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(operatorThreads).values(row)

  if (forkMessages.length > 0) {
    const rows = forkMessages.map((m, i) => ({
      id: `msg-${forkId}-${i}`,
      workspaceId,
      threadId: forkId,
      role: m.role,
      content: m.content,
      turnIndex: i,
      metadataJson: null,
      promotedAt: null,
      promotedBy: null,
      promotionNote: null,
      promotionKind: null,
      createdAt: m.createdAt,
    }))
    await insertThreadMessages(rows)
  }

  return toThread(row)
}

export async function getForksOfThread(
  workspaceId: string,
  parentThreadId: string
): Promise<OperatorThread[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.parentThreadId, parentThreadId),
        eq(operatorThreads.visibleInStudio, 1)
      )
    )
    .orderBy(desc(operatorThreads.createdAt))
  return rows.map(toThread)
}

// ─── Chat session queries ────────────────────────────────────────────────────

export async function getChatSessionsByThread(
  workspaceId: string,
  threadId: string
): Promise<OperatorChatSession[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorChatSessions)
    .where(
      and(
        eq(operatorChatSessions.workspaceId, workspaceId),
        eq(operatorChatSessions.threadId, threadId)
      )
    )
    .orderBy(desc(operatorChatSessions.updatedAt))
  return rows.map(toChatSession)
}

export async function getChatSessionById(
  workspaceId: string,
  id: string
): Promise<OperatorChatSession | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorChatSessions)
    .where(
      and(
        eq(operatorChatSessions.id, id),
        eq(operatorChatSessions.workspaceId, workspaceId)
      )
    )
    .limit(1)
  return rows[0] ? toChatSession(rows[0]) : null
}

export async function getChatMessages(
  workspaceId: string,
  sessionId: string
): Promise<OperatorChatMessage[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorChatMessages)
    .where(
      and(
        eq(operatorChatMessages.workspaceId, workspaceId),
        eq(operatorChatMessages.sessionId, sessionId)
      )
    )
    .orderBy(operatorChatMessages.createdAt)
  return rows.map(toChatMessage)
}

export async function createChatSession(data: {
  id: string
  workspaceId: string
  threadId: string | null
  sessionTitle: string | null
  operatorName: string
  contextSnapshotJson?: Record<string, unknown> | null
}): Promise<OperatorChatSession> {
  const db = getDb()
  const now = new Date()
  const row = {
    id: data.id,
    workspaceId: data.workspaceId,
    threadId: data.threadId,
    sessionTitle: data.sessionTitle,
    operatorName: data.operatorName,
    contextSnapshotJson: data.contextSnapshotJson ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(operatorChatSessions).values(row)
  return toChatSession(row)
}

export async function updateChatSessionContextSnapshot(
  workspaceId: string,
  sessionId: string,
  contextSnapshotJson: Record<string, unknown> | null
) {
  const db = getDb()
  await db
    .update(operatorChatSessions)
    .set({
      contextSnapshotJson,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatorChatSessions.id, sessionId),
        eq(operatorChatSessions.workspaceId, workspaceId)
      )
    )
}

export async function appendChatMessage(data: {
  id: string
  workspaceId: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  modelLabel?: string | null
  contextSnapshotJson?: Record<string, unknown> | null
}): Promise<OperatorChatMessage> {
  const db = getDb()
  const now = new Date()
  const row = {
    id: data.id,
    workspaceId: data.workspaceId,
    sessionId: data.sessionId,
    role: data.role,
    content: data.content,
    modelLabel: data.modelLabel ?? null,
    contextSnapshotJson: data.contextSnapshotJson ?? null,
    promotedAt: null as Date | null,
    promotedBy: null as string | null,
    promotionNote: null as string | null,
    promotionKind: null as string | null,
    createdAt: now,
  }
  await db.insert(operatorChatMessages).values(row)
  await db
    .update(operatorChatSessions)
    .set({ updatedAt: now })
    .where(
      and(
        eq(operatorChatSessions.id, data.sessionId),
        eq(operatorChatSessions.workspaceId, data.workspaceId)
      )
    )
  return toChatMessage(row)
}

// ─── Import run queries ──────────────────────────────────────────────────────

export async function getRecentImportRuns(
  workspaceId: string,
  limit = 20
): Promise<OperatorImportRun[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorImportRuns)
    .where(eq(operatorImportRuns.workspaceId, workspaceId))
    .orderBy(desc(operatorImportRuns.createdAt))
    .limit(limit)
  return rows.map(toImportRun)
}

export async function createImportRun(data: {
  id: string
  workspaceId: string
  sourceApp: string
  sourcePath?: string
  importedBy: string
}) {
  const db = getDb()
  await db.insert(operatorImportRuns).values({
    id: data.id,
    workspaceId: data.workspaceId,
    sourceApp: data.sourceApp,
    sourcePath: data.sourcePath ?? null,
    importedBy: data.importedBy,
    threadCount: 0,
    status: "running",
    createdAt: new Date(),
  })
}

export async function completeImportRun(
  workspaceId: string,
  id: string,
  threadCount: number,
  error?: string
) {
  const db = getDb()
  await db
    .update(operatorImportRuns)
    .set({
      status: error ? "failed" : "completed",
      threadCount,
      error: error ?? null,
      completedAt: new Date(),
    })
    .where(
      and(
        eq(operatorImportRuns.id, id),
        eq(operatorImportRuns.workspaceId, workspaceId)
      )
    )
}

// ─── Bulk insert for imports ─────────────────────────────────────────────────

export async function insertThread(
  thread: typeof operatorThreads.$inferInsert
) {
  const db = getDb()
  await db.insert(operatorThreads).values(thread)
}

export async function insertThreadMessages(
  messages: (typeof operatorThreadMessages.$inferInsert)[]
) {
  if (messages.length === 0) return
  const db = getDb()
  for (let i = 0; i < messages.length; i += 500) {
    await db
      .insert(operatorThreadMessages)
      .values(messages.slice(i, i + 500))
  }
}

/**
 * Append newly-arrived messages to an existing thread and bump its
 * `messageCount` + `updatedAt` in the same transaction.
 *
 * Use case: ongoing conversations in Claude Code / Codex append new
 * turns to the JSONL file on disk. ingestSession now calls this when
 * the upstream file is longer than our stored copy, so "deduped" no
 * longer means "drop the new turns on the floor."
 *
 * Returns the number of messages actually inserted. Callers pass in
 * the full message list they want to append; ids and turnIndex are
 * synthesized here so callers don't need to know the thread's current
 * state.
 */
export async function appendThreadMessages(
  workspaceId: string,
  threadId: string,
  startingTurnIndex: number,
  newMessages: Array<{
    role: string
    content: string
    createdAt: Date
    /** Optional source-app metadata (e.g., codex_turn_id) — see
     *  importers/index.ts deriveMessageMetadata. Null is fine. */
    metadataJson?: Record<string, unknown> | null
  }>
): Promise<number> {
  if (newMessages.length === 0) return 0
  const db = getDb()
  const rows = newMessages.map((m, i) => ({
    id: `msg-${threadId}-${startingTurnIndex + i}`,
    workspaceId,
    threadId,
    role: m.role,
    content: m.content,
    turnIndex: startingTurnIndex + i,
    metadataJson: m.metadataJson ?? null,
    createdAt: m.createdAt,
  }))

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx
        .insert(operatorThreadMessages)
        .values(rows.slice(i, i + 500))
    }
    await tx
      .update(operatorThreads)
      .set({
        messageCount: sql`${operatorThreads.messageCount} + ${rows.length}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operatorThreads.workspaceId, workspaceId),
          eq(operatorThreads.id, threadId)
        )
      )
  })
  return rows.length
}

// ─── Message edit / delete ──────────────────────────────────────────────────

export async function updateMessageContent(
  workspaceId: string,
  messageId: string,
  content: string,
  source: "thread" | "chat" = "thread"
) {
  const db = getDb()
  const table =
    source === "chat" ? operatorChatMessages : operatorThreadMessages
  await db
    .update(table)
    .set({ content })
    .where(and(eq(table.id, messageId), eq(table.workspaceId, workspaceId)))
}

/**
 * Delete a single message.
 *
 * For thread messages, this decrements `operator_threads.messageCount`
 * atomically inside a transaction so the denormalized count never drifts
 * from the actual row count. Chat messages don't have a denormalized
 * count on the session row, so they're a straight delete.
 *
 * Returns `{ deleted: boolean, threadId: string | null }` — `deleted`
 * is false if the message wasn't found (or belonged to a different
 * workspace), `threadId` is set for successful thread deletes so
 * callers can invalidate caches.
 */
export async function deleteMessage(
  workspaceId: string,
  messageId: string,
  source: "thread" | "chat" = "thread"
): Promise<{ deleted: boolean; threadId: string | null }> {
  const db = getDb()

  if (source === "chat") {
    const result = await db
      .delete(operatorChatMessages)
      .where(
        and(
          eq(operatorChatMessages.id, messageId),
          eq(operatorChatMessages.workspaceId, workspaceId)
        )
      )
      .returning({ id: operatorChatMessages.id })
    return { deleted: result.length > 0, threadId: null }
  }

  // Thread message: transactional delete + messageCount decrement.
  // Wrapped in a transaction so a crash between the two statements
  // can't leave messageCount stale.
  return db.transaction(async (tx) => {
    const deletedRows = await tx
      .delete(operatorThreadMessages)
      .where(
        and(
          eq(operatorThreadMessages.id, messageId),
          eq(operatorThreadMessages.workspaceId, workspaceId)
        )
      )
      .returning({ threadId: operatorThreadMessages.threadId })

    if (deletedRows.length === 0) {
      return { deleted: false, threadId: null }
    }

    const threadId = deletedRows[0].threadId
    // Use GREATEST to defensively clamp at 0 — if messageCount is
    // already stale-low for some reason, don't go negative.
    await tx
      .update(operatorThreads)
      .set({
        messageCount: sql`GREATEST(${operatorThreads.messageCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operatorThreads.id, threadId),
          eq(operatorThreads.workspaceId, workspaceId)
        )
      )

    return { deleted: true, threadId }
  })
}

// ─── Reconciliation / integrity ─────────────────────────────────────────────

/**
 * Recompute `operator_threads.messageCount` from actual rows in
 * `operator_thread_messages`. Authoritative source of truth.
 *
 * Use cases:
 * 1. Migrations (backfilling denormalized counts after bulk changes).
 * 2. Integrity check script (detect drift before it surfaces in UI).
 * 3. Admin "repair" tool (fix drift after manual DB edits).
 *
 * Returns the new count so callers can log or assert.
 */
export async function recomputeMessageCount(
  workspaceId: string,
  threadId: string
): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.threadId, threadId),
        eq(operatorThreadMessages.workspaceId, workspaceId)
      )
    )
  const actualCount = rows[0]?.count ?? 0
  await db
    .update(operatorThreads)
    .set({ messageCount: actualCount, updatedAt: new Date() })
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
  return actualCount
}

/**
 * Scan every thread in every workspace for messageCount drift. Returns a
 * list of drifted threads with the stored count and the actual count —
 * does NOT mutate. Pair with `recomputeMessageCount` to repair.
 *
 * Intended for the `pnpm integrity:check` script and a future admin
 * dashboard panel. Cheap-ish at OSS scale (one GROUP BY); if this ever
 * gets slow, add a workspace filter.
 */
export async function findMessageCountDrift(): Promise<
  Array<{
    threadId: string
    workspaceId: string
    storedCount: number
    actualCount: number
  }>
> {
  const db = getDb()
  const rows = await db.execute<{
    thread_id: string
    workspace_id: string
    stored_count: number
    actual_count: number
  }>(sql`
    SELECT
      t.id AS thread_id,
      t.workspace_id,
      t.message_count AS stored_count,
      COALESCE(m.actual_count, 0)::int AS actual_count
    FROM operator_threads t
    LEFT JOIN (
      SELECT thread_id, workspace_id, COUNT(*)::int AS actual_count
      FROM operator_thread_messages
      GROUP BY thread_id, workspace_id
    ) m ON m.thread_id = t.id AND m.workspace_id = t.workspace_id
    WHERE t.message_count <> COALESCE(m.actual_count, 0)
  `)
  // Drizzle's .execute returns { rows } on node-postgres; normalize.
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    threadId: r.thread_id as string,
    workspaceId: r.workspace_id as string,
    storedCount: Number(r.stored_count),
    actualCount: Number(r.actual_count),
  }))
}

// ─── Message promotion ──────────────────────────────────────────────────────

export async function promoteMessage(
  workspaceId: string,
  messageId: string,
  data: {
    promotedBy: string
    promotionNote?: string
    promotionKind?: PromotionKind
  },
  source: "thread" | "chat" = "thread"
) {
  const db = getDb()
  const now = new Date()
  const table = source === "chat" ? operatorChatMessages : operatorThreadMessages
  await db
    .update(table)
    .set({
      promotedAt: now,
      promotedBy: data.promotedBy,
      promotionNote: data.promotionNote ?? null,
      promotionKind: data.promotionKind ?? "fire",
    })
    .where(and(eq(table.id, messageId), eq(table.workspaceId, workspaceId)))
}

export async function unpromoteMessage(
  workspaceId: string,
  messageId: string,
  source: "thread" | "chat" = "thread"
) {
  const db = getDb()
  const table = source === "chat" ? operatorChatMessages : operatorThreadMessages
  await db
    .update(table)
    .set({
      promotedAt: null,
      promotedBy: null,
      promotionNote: null,
      promotionKind: null,
    })
    .where(and(eq(table.id, messageId), eq(table.workspaceId, workspaceId)))
}

export async function getPromotedThreadMessages(
  workspaceId: string
): Promise<(OperatorThreadMessage & { threadTitle: string | null })[]> {
  const db = getDb()
  const rows = await db
    .select({
      message: operatorThreadMessages,
      threadTitle: operatorThreads.promotedTitle,
      rawTitle: operatorThreads.rawTitle,
    })
    .from(operatorThreadMessages)
    .innerJoin(
      operatorThreads,
      eq(operatorThreadMessages.threadId, operatorThreads.id)
    )
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        isNotNull(operatorThreadMessages.promotedAt)
      )
    )
    .orderBy(desc(operatorThreadMessages.promotedAt))

  return rows.map((r) => ({
    ...toMessage(r.message),
    threadTitle: r.threadTitle ?? r.rawTitle,
  }))
}

// ─── Dashboard stats ─────────────────────────────────────────────────────────

export async function getDashboardStats(
  workspaceId: string
): Promise<OperatorDashboardStats> {
  const db = getDb()
  // Single aggregate query (hits idx_os_threads_workspace_state) instead
  // of fetching every visible thread row and counting in JS. The recent
  // imports field is a count, not the rows themselves — we only ever
  // used `.length` on it.
  const [statsRow, runsRow] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        promoted: sql<number>`count(*) filter (where ${operatorThreads.reviewState} = 'promoted')::int`,
        inReview: sql<number>`count(*) filter (where ${operatorThreads.reviewState} = 'in-review')::int`,
        imported: sql<number>`count(*) filter (where ${operatorThreads.reviewState} = 'imported')::int`,
      })
      .from(operatorThreads)
      .where(
        and(
          eq(operatorThreads.workspaceId, workspaceId),
          eq(operatorThreads.visibleInStudio, 1)
        )
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorImportRuns)
      .where(eq(operatorImportRuns.workspaceId, workspaceId)),
  ])

  const stats = statsRow[0]
  return {
    totalThreads: stats?.total ?? 0,
    promoted: stats?.promoted ?? 0,
    inReview: stats?.inReview ?? 0,
    imported: stats?.imported ?? 0,
    recentImportRuns: runsRow[0]?.count ?? 0,
  }
}

// ─── Full-text search (tsvector / GIN) ──────────────────────────────────────

export type SearchThreadHit = OperatorThread & {
  rank: number
  snippet: string | null
}

export type SearchMessageHit = OperatorThreadMessage & {
  rank: number
  snippet: string
  threadTitle: string | null
  threadId: string
  threadSourceApp: OperatorSourceApp
  threadProjectSlug: string | null
}

/**
 * Exact-tag filter. Returns visible threads in the workspace whose tags
 * jsonb array contains the given tag. Used by the sidebar "click a tag
 * chip" flow via /api/operator-studio/search?tag=...
 */
export async function findThreadsByTag(
  workspaceId: string,
  tag: string,
  limit = 30
): Promise<OperatorThread[]> {
  const t = tag.trim()
  if (t.length === 0) return []
  const capped = Math.max(1, Math.min(limit, 100))

  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.visibleInStudio, 1),
        sql`${operatorThreads.tags} @> ${JSON.stringify([t])}::jsonb`
      )
    )
    .orderBy(desc(operatorThreads.importedAt))
    .limit(capped)
  return rows.map(toThread)
}

/**
 * Quick thread search — title-and-rank only, no ts_headline snippet.
 * For picker UIs that need sub-100ms response across a large corpus.
 */
export interface QuickThreadHit {
  id: string
  rawTitle: string | null
  promotedTitle: string | null
  sourceApp: string
  rank: number
}
export async function searchThreadsQuick(
  workspaceId: string,
  query: string,
  limit = 8
): Promise<QuickThreadHit[]> {
  const q = query.trim()
  if (q.length === 0) return []
  const cappedLimit = Math.max(1, Math.min(limit, 25))
  const db = getDb()
  const result = await db.execute<{
    id: string
    raw_title: string | null
    promoted_title: string | null
    source_app: string
    rank: number
  }>(sql`
    SELECT
      t.id,
      t.raw_title,
      t.promoted_title,
      t.source_app,
      ts_rank_cd(t.search_tsv, query) AS rank
    FROM operator_threads t, plainto_tsquery('english', ${q}) query
    WHERE t.workspace_id = ${workspaceId}
      AND t.visible_in_studio = 1
      AND t.search_tsv @@ query
    ORDER BY rank DESC, t.imported_at DESC
    LIMIT ${cappedLimit}
  `)
  return result.rows.map((r) => ({
    id: r.id,
    rawTitle: r.raw_title,
    promotedTitle: r.promoted_title,
    sourceApp: r.source_app,
    rank: Number(r.rank) || 0,
  }))
}

/**
 * Quick message search — minimal payload, no ts_headline. Returns the
 * thread title for context but skips the highlighted snippet which is
 * the expensive part of ts_headline.
 */
export interface QuickMessageHit {
  id: string
  threadId: string
  threadTitle: string | null
  role: string
  rank: number
  /** First ~100 chars of content, plain text — cheaper than ts_headline. */
  preview: string
}
export async function searchMessagesQuick(
  workspaceId: string,
  query: string,
  limit = 8
): Promise<QuickMessageHit[]> {
  const q = query.trim()
  if (q.length === 0) return []
  const cappedLimit = Math.max(1, Math.min(limit, 25))
  const db = getDb()
  const result = await db.execute<{
    id: string
    thread_id: string
    role: string
    preview: string
    thread_title: string | null
    raw_title: string | null
    rank: number
  }>(sql`
    SELECT
      m.id,
      m.thread_id,
      m.role,
      LEFT(m.content, 140) AS preview,
      t.promoted_title AS thread_title,
      t.raw_title,
      ts_rank_cd(m.search_tsv, query) AS rank
    FROM operator_thread_messages m
    INNER JOIN operator_threads t ON t.id = m.thread_id
    , plainto_tsquery('english', ${q}) query
    WHERE m.workspace_id = ${workspaceId}
      AND t.visible_in_studio = 1
      AND m.search_tsv @@ query
    ORDER BY rank DESC, m.created_at DESC
    LIMIT ${cappedLimit}
  `)
  return result.rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    threadTitle: r.thread_title ?? r.raw_title,
    role: r.role,
    rank: Number(r.rank) || 0,
    preview: r.preview,
  }))
}

/**
 * Thread full-text search. Uses the `search_tsv` generated column on
 * `operator_threads` (weighted across promoted/raw title, summaries,
 * why-it-matters, project slug). Ranks via `ts_rank_cd`, snippets via
 * `ts_headline` with `<mark>` delimiters.
 */
export async function searchThreads(
  workspaceId: string,
  query: string,
  limit = 30
): Promise<SearchThreadHit[]> {
  const q = query.trim()
  if (q.length === 0) return []
  const cappedLimit = Math.max(1, Math.min(limit, 100))

  const db = getDb()
  const result = await db.execute<{
    id: string
    workspace_id: string
    source_app: string
    source_thread_key: string | null
    source_locator: string | null
    imported_by: string
    imported_at: Date
    import_run_id: string | null
    raw_title: string | null
    raw_summary: string | null
    promoted_title: string | null
    promoted_summary: string | null
    privacy_state: string
    review_state: string
    tags: string[] | null
    project_slug: string | null
    owner_name: string | null
    why_it_matters: string | null
    capture_reason: string | null
    parent_thread_id: string | null
    promoted_from_id: string | null
    pulled_from_id: string | null
    visible_in_studio: number
    message_count: number
    archived_at: Date | null
    marked_done_at: Date | null
    marked_done_by: string | null
    marked_done_source: string | null
    created_at: Date
    updated_at: Date
    rank: number
    snippet: string | null
  }>(sql`
    SELECT
      t.id,
      t.workspace_id,
      t.source_app,
      t.source_thread_key,
      t.source_locator,
      t.imported_by,
      t.imported_at,
      t.import_run_id,
      t.raw_title,
      t.raw_summary,
      t.promoted_title,
      t.promoted_summary,
      t.privacy_state,
      t.review_state,
      t.tags,
      t.project_slug,
      t.owner_name,
      t.why_it_matters,
      t.capture_reason,
      t.parent_thread_id,
      t.promoted_from_id,
      t.pulled_from_id,
      t.visible_in_studio,
      t.message_count,
      t.archived_at,
      t.marked_done_at,
      t.marked_done_by,
      t.marked_done_source,
      t.created_at,
      t.updated_at,
      ts_rank_cd(t.search_tsv, query) AS rank,
      ts_headline(
        'english',
        coalesce(
          t.promoted_summary,
          t.raw_summary,
          t.capture_reason,
          t.why_it_matters,
          t.promoted_title,
          t.raw_title,
          ''
        ),
        query,
        'MaxFragments=2, MaxWords=20, MinWords=5, StartSel=<mark>, StopSel=</mark>'
      ) AS snippet
    FROM operator_threads t, plainto_tsquery('english', ${q}) query
    WHERE t.workspace_id = ${workspaceId}
      AND t.visible_in_studio = 1
      AND t.search_tsv @@ query
    ORDER BY rank DESC, t.imported_at DESC
    LIMIT ${cappedLimit}
  `)

  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    sourceApp: row.source_app as OperatorSourceApp,
    sourceThreadKey: row.source_thread_key,
    sourceLocator: row.source_locator,
    importedBy: row.imported_by,
    importedAt: new Date(row.imported_at).toISOString(),
    importRunId: row.import_run_id,
    rawTitle: row.raw_title,
    rawSummary: row.raw_summary,
    promotedTitle: row.promoted_title,
    promotedSummary: row.promoted_summary,
    privacyState: row.privacy_state as "private" | "team",
    reviewState: row.review_state as OperatorReviewState,
    tags: (row.tags as string[] | null) ?? [],
    projectSlug: row.project_slug,
    ownerName: row.owner_name,
    whyItMatters: row.why_it_matters,
    captureReason: row.capture_reason,
    parentThreadId: row.parent_thread_id,
    promotedFromId: row.promoted_from_id,
    pulledFromId: row.pulled_from_id,
    visibleInStudio: row.visible_in_studio === 1,
    messageCount: row.message_count,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    markedDoneAt: row.marked_done_at
      ? new Date(row.marked_done_at).toISOString()
      : null,
    markedDoneBy: row.marked_done_by ?? null,
    markedDoneSource:
      row.marked_done_source === "phrase" ||
      row.marked_done_source === "manual"
        ? (row.marked_done_source as "phrase" | "manual")
        : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    rank: Number(row.rank) || 0,
    snippet: row.snippet,
  }))
}

/**
 * Thread-message full-text search. Joins back to the parent thread so results
 * can show the thread title they belong to. Highlights the `content` field
 * with `<mark>` delimiters via `ts_headline`.
 */
export async function searchMessages(
  workspaceId: string,
  query: string,
  limit = 30
): Promise<SearchMessageHit[]> {
  const q = query.trim()
  if (q.length === 0) return []
  const cappedLimit = Math.max(1, Math.min(limit, 100))

  const db = getDb()
  const result = await db.execute<{
    id: string
    thread_id: string
    role: string
    content: string
    turn_index: number
    metadata_json: Record<string, unknown> | null
    promoted_at: Date | null
    promoted_by: string | null
    promotion_note: string | null
    promotion_kind: string | null
    created_at: Date
    thread_title: string | null
    raw_title: string | null
    thread_source_app: string
    thread_project_slug: string | null
    rank: number
    snippet: string
  }>(sql`
    SELECT
      m.id,
      m.thread_id,
      m.role,
      m.content,
      m.turn_index,
      m.metadata_json,
      m.promoted_at,
      m.promoted_by,
      m.promotion_note,
      m.promotion_kind,
      m.created_at,
      t.promoted_title AS thread_title,
      t.raw_title AS raw_title,
      t.source_app AS thread_source_app,
      t.project_slug AS thread_project_slug,
      ts_rank_cd(m.search_tsv, query) AS rank,
      ts_headline(
        'english',
        m.content,
        query,
        'MaxFragments=2, MaxWords=20, MinWords=5, StartSel=<mark>, StopSel=</mark>'
      ) AS snippet
    FROM operator_thread_messages m
    INNER JOIN operator_threads t ON t.id = m.thread_id
    , plainto_tsquery('english', ${q}) query
    WHERE m.workspace_id = ${workspaceId}
      AND t.visible_in_studio = 1
      AND m.search_tsv @@ query
    ORDER BY rank DESC, m.created_at DESC
    LIMIT ${cappedLimit}
  `)

  return result.rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    role: row.role as OperatorThreadMessage["role"],
    content: row.content,
    turnIndex: row.turn_index,
    metadataJson: row.metadata_json,
    promotedAt: row.promoted_at ? new Date(row.promoted_at).toISOString() : null,
    promotedBy: row.promoted_by,
    promotionNote: row.promotion_note,
    promotionKind: row.promotion_kind as OperatorThreadMessage["promotionKind"],
    createdAt: new Date(row.created_at).toISOString(),
    threadTitle: row.thread_title ?? row.raw_title,
    threadSourceApp: row.thread_source_app as OperatorSourceApp,
    threadProjectSlug: row.thread_project_slug,
    rank: Number(row.rank) || 0,
    snippet: row.snippet,
  }))
}

// ─── Work Sessions ──────────────────────────────────────────────────────────
//
// See `lib/operator-studio/sessions.ts` for the pure segmentation logic.
// The flow:
// 1. `ensureSessionsForWorkspace` gathers recent thread/message timestamps,
//    runs them through `computeSessions`, and upserts into
//    `operator_sessions`. Idempotent via deterministic ids.
// 2. `getSessionsForWorkspace` reads the materialized rows.
// 3. `getThreadsInSession` returns threads whose activity overlaps the
//    session's time range (soft membership — threads can appear in multiple
//    work sessions).

function toSession(
  row: typeof operatorSessions.$inferSelect
): OperatorSession {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    // Legacy jsonb column — kept for rollback safety, but new code should
    // read durable plan steps from operator_plan_steps via the session's planId.
    planSteps: (row.planSteps as OperatorPlanStep[] | null) ?? [],
    planId: row.planId ?? null,
    threadCount: row.threadCount,
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Materialize session rows for a workspace by scanning activity
 * timestamps and running them through `computeSessions`. Idempotent —
 * same activity → same session ids → upserts update in place.
 *
 * "Activity" here = thread createdAt, thread updatedAt (covers later
 * edits), and messages createdAt. We use all three so that a thread
 * that was imported days ago but edited today shows up in today's
 * session.
 *
 * The `lookbackDays` window caps how far back we scan — default 90
 * days. Sessions older than that stay in the table but aren't
 * re-examined (their time range is frozen).
 */
// In-memory throttle for ensureSessionsForWorkspace. The function does
// a 90-day materialization scan + idempotent UPSERTs; it was running
// on every page load. 30s TTL is a fine staleness budget — sessions
// derived from message timestamps don't shift faster than that during
// normal use, and busts are explicit (see invalidateEnsureSessionsThrottle).
const _lastEnsuredMs = new Map<string, number>()
const _ENSURE_TTL_MS = 30_000

/** Bust the throttle — call after activity that should immediately be
 *  reflected in the session list (e.g. completed import). */
export function invalidateEnsureSessionsThrottle(workspaceId: string): void {
  _lastEnsuredMs.delete(workspaceId)
}

export async function ensureSessionsForWorkspace(
  workspaceId: string,
  opts: { lookbackDays?: number; gapHours?: number } = {}
): Promise<void> {
  const tickMs = Date.now()
  const last = _lastEnsuredMs.get(workspaceId) ?? 0
  if (tickMs - last < _ENSURE_TTL_MS) return
  _lastEnsuredMs.set(workspaceId, tickMs)

  const db = getDb()
  const lookbackDays = opts.lookbackDays ?? 90
  const gapHours = opts.gapHours ?? 3
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)

  // Gather activity: thread createdAt + thread messages createdAt.
  // Chat messages (continuation chat) also count — if you're chatting
  // with a fork, that's active LLM work.
  const threadRows = await db
    .select({
      id: operatorThreads.id,
      createdAt: operatorThreads.createdAt,
      updatedAt: operatorThreads.updatedAt,
    })
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        gte(operatorThreads.createdAt, cutoff)
      )
    )

  const messageRows = await db
    .select({
      id: operatorThreadMessages.id,
      threadId: operatorThreadMessages.threadId,
      createdAt: operatorThreadMessages.createdAt,
    })
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        gte(operatorThreadMessages.createdAt, cutoff)
      )
    )

  const chatRows = await db
    .select({
      id: operatorChatMessages.id,
      createdAt: operatorChatMessages.createdAt,
    })
    .from(operatorChatMessages)
    .where(
      and(
        eq(operatorChatMessages.workspaceId, workspaceId),
        gte(operatorChatMessages.createdAt, cutoff)
      )
    )

  const activity: ActivityPoint[] = [
    ...threadRows.map((r) => ({ id: `t-${r.id}`, timestamp: r.createdAt })),
    ...messageRows.map((r) => ({ id: `m-${r.id}`, timestamp: r.createdAt })),
    ...chatRows.map((r) => ({ id: `c-${r.id}`, timestamp: r.createdAt })),
  ]

  if (activity.length === 0) return

  const segments = computeSessions(activity, { gapHours })
  const now = new Date()

  for (const seg of segments) {
    const id = sessionIdFromStart(workspaceId, seg.startedAt)

    // messageCount + threadCount are derived caches for list-view
    // display. threadCount = distinct threads with ANY message in the
    // window, NOT threads whose createdAt is in the window. Matches
    // the soft-membership rule in getThreadsInSession: threads outlive
    // sessions, so an ongoing conversation that started last week but
    // has new turns today correctly appears in today's session.
    const messagesInWindow = messageRows.filter((m) => {
      const created = new Date(m.createdAt).getTime()
      return (
        created >= seg.startedAt.getTime() &&
        created <= seg.endedAt.getTime()
      )
    })
    const messageCount = messagesInWindow.length
    const threadIdsInWindow = new Set(messagesInWindow.map((m) => m.threadId))
    const threadCount = threadIdsInWindow.size

    // Postgres UPSERT. On conflict we bump endedAt and counts but keep
    // the user-set label if they've edited it.
    await db
      .insert(operatorSessions)
      .values({
        id,
        workspaceId,
        label: null,
        startedAt: seg.startedAt,
        endedAt: seg.endedAt,
        planSteps: [],
        threadCount,
        messageCount,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: operatorSessions.id,
        set: {
          endedAt: seg.endedAt,
          threadCount,
          messageCount,
          updatedAt: now,
        },
      })
  }
}

export async function getSessionsForWorkspace(
  workspaceId: string
): Promise<OperatorSession[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorSessions)
    .where(eq(operatorSessions.workspaceId, workspaceId))
    .orderBy(desc(operatorSessions.startedAt))
  return rows.map(toSession)
}

export async function getSessionById(
  workspaceId: string,
  sessionId: string
): Promise<OperatorSession | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorSessions)
    .where(
      and(
        eq(operatorSessions.workspaceId, workspaceId),
        eq(operatorSessions.id, sessionId)
      )
    )
    .limit(1)
  return rows[0] ? toSession(rows[0]) : null
}

/**
 * Soft membership: threads whose createdAt falls inside the session's
 * time range. A thread can appear in multiple sessions if you picked
 * it back up after a break — that's intentional (see OperatorSession
 * docstring).
 */
/**
 * Threads that had ANY activity within the session's time range.
 *
 * "Activity" = a message whose `createdAt` falls inside [startedAt,
 * endedAt]. This is deliberately NOT filtered by thread.createdAt —
 * a thread that started a week ago but has 50 new turns today should
 * appear in today's session AND its original session. Threads outlive
 * sessions; sessions are windows over activity.
 *
 * Previously this filtered by thread.createdAt, which meant ongoing
 * conversations never showed up in "today's" session once their
 * original session window had closed. That's the bug that made
 * users' current work invisible in Session Spaces.
 */
export async function getThreadsInSession(
  workspaceId: string,
  sessionId: string,
  opts?: {
    /**
     * Override the right edge of the membership window. Pulse extends
     * its time axis to "now" when the active session ended < 30 min
     * ago; without this override the thread join would miss any new
     * thread whose only activity landed after the stored endedAt.
     */
    windowEndOverride?: Date
  }
): Promise<OperatorThread[]> {
  const session = await getSessionById(workspaceId, sessionId)
  if (!session) return []

  const db = getDb()
  const startedAt = new Date(session.startedAt)
  const storedEnd = new Date(session.endedAt)
  const endedAt =
    opts?.windowEndOverride && opts.windowEndOverride > storedEnd
      ? opts.windowEndOverride
      : storedEnd

  // Threads whose id appears in the message table with a createdAt
  // inside the window. DISTINCT so a thread with N messages in the
  // window only shows up once.
  const rows = await db.execute<typeof operatorThreads.$inferSelect>(sql`
    SELECT DISTINCT t.*
    FROM operator_threads t
    INNER JOIN operator_thread_messages m
      ON m.thread_id = t.id
     AND m.workspace_id = t.workspace_id
    WHERE t.workspace_id = ${workspaceId}
      AND t.visible_in_studio = 1
      AND m.created_at >= ${startedAt.toISOString()}
      AND m.created_at <= ${endedAt.toISOString()}
    ORDER BY t.created_at ASC
  `)
  // Drizzle's .execute returns { rows } with raw pg shape.
  const rawRows = (rows as unknown as {
    rows: Array<Record<string, unknown>>
  }).rows

  return rawRows.map((r) =>
    toThread({
      id: r.id as string,
      workspaceId: r.workspace_id as string,
      sourceApp: r.source_app as string,
      sourceThreadKey: r.source_thread_key as string | null,
      sourceLocator: r.source_locator as string | null,
      importedBy: r.imported_by as string,
      importedAt: new Date(r.imported_at as string),
      importRunId: r.import_run_id as string | null,
      rawTitle: r.raw_title as string | null,
      rawSummary: r.raw_summary as string | null,
      promotedTitle: r.promoted_title as string | null,
      promotedSummary: r.promoted_summary as string | null,
      privacyState: r.privacy_state as string,
      reviewState: r.review_state as string,
      tags: r.tags as string[] | null,
      projectSlug: r.project_slug as string | null,
      ownerName: r.owner_name as string | null,
      whyItMatters: r.why_it_matters as string | null,
      captureReason: r.capture_reason as string | null,
      sourcePayloadJson: r.source_payload_json as Record<
        string,
        unknown
      > | null,
      parentThreadId: r.parent_thread_id as string | null,
      promotedFromId: r.promoted_from_id as string | null,
      pulledFromId: r.pulled_from_id as string | null,
      visibleInStudio: r.visible_in_studio as number,
      messageCount: r.message_count as number,
      promotedAt: r.promoted_at ? new Date(r.promoted_at as string) : null,
      archivedAt: r.archived_at ? new Date(r.archived_at as string) : null,
      markedDoneAt: r.marked_done_at
        ? new Date(r.marked_done_at as string)
        : null,
      markedDoneBy: (r.marked_done_by as string | null) ?? null,
      markedDoneSource: (r.marked_done_source as string | null) ?? null,
      createdAt: new Date(r.created_at as string),
      updatedAt: new Date(r.updated_at as string),
    })
  )
}

/**
 * Recent sessions with their soft-membership threads, in one shot.
 * Powers the secondary sidebar's "recent chats grouped by session"
 * rail. Returns the latest `limit` sessions (by startedAt desc) and
 * the threads active inside each session's window.
 *
 * One query: a CTE picks the recent sessions, a lateral join collects
 * the distinct threads with activity inside each session's window
 * via the (workspace_id, created_at) index on operator_thread_messages.
 */
export async function getRecentSessionsWithThreads(
  workspaceId: string,
  limit = 10
): Promise<
  Array<{
    session: OperatorSession
    threads: OperatorThread[]
  }>
> {
  const db = getDb()
  const result = await db.execute<{
    session_row: Record<string, unknown>
    threads: Array<Record<string, unknown>> | null
  }>(sql`
    WITH recent_sessions AS (
      SELECT *
      FROM operator_sessions
      WHERE workspace_id = ${workspaceId}
      ORDER BY started_at DESC
      LIMIT ${limit}
    )
    SELECT
      to_jsonb(s.*) AS session_row,
      COALESCE(j.threads, '[]'::jsonb) AS threads
    FROM recent_sessions s
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.created_at ASC) AS threads
      FROM (
        SELECT DISTINCT t.*
        FROM operator_threads t
        INNER JOIN operator_thread_messages m
          ON m.thread_id = t.id
         AND m.workspace_id = t.workspace_id
        WHERE t.workspace_id = ${workspaceId}
          AND t.visible_in_studio = 1
          AND m.created_at >= s.started_at
          AND m.created_at <= s.ended_at
      ) t
    ) j ON TRUE
    ORDER BY s.started_at DESC
  `)
  const rawRows = (result as unknown as {
    rows: Array<{
      session_row: Record<string, unknown>
      threads: Array<Record<string, unknown>> | null
    }>
  }).rows

  return rawRows.map((row) => {
    const s = row.session_row
    const session = toSession({
      id: s.id as string,
      workspaceId: s.workspace_id as string,
      label: (s.label as string | null) ?? null,
      startedAt: new Date(s.started_at as string),
      endedAt: new Date(s.ended_at as string),
      planSteps: (s.plan_steps as never) ?? [],
      planId: (s.plan_id as string | null) ?? null,
      threadCount: s.thread_count as number,
      messageCount: s.message_count as number,
      createdAt: new Date(s.created_at as string),
      updatedAt: new Date(s.updated_at as string),
    })
    const threads = (row.threads ?? []).map((r) =>
      toThread({
        id: r.id as string,
        workspaceId: r.workspace_id as string,
        sourceApp: r.source_app as string,
        sourceThreadKey: r.source_thread_key as string | null,
        sourceLocator: r.source_locator as string | null,
        importedBy: r.imported_by as string,
        importedAt: new Date(r.imported_at as string),
        importRunId: r.import_run_id as string | null,
        rawTitle: r.raw_title as string | null,
        rawSummary: r.raw_summary as string | null,
        promotedTitle: r.promoted_title as string | null,
        promotedSummary: r.promoted_summary as string | null,
        privacyState: r.privacy_state as string,
        reviewState: r.review_state as string,
        tags: r.tags as string[] | null,
        projectSlug: r.project_slug as string | null,
        ownerName: r.owner_name as string | null,
        whyItMatters: r.why_it_matters as string | null,
        captureReason: r.capture_reason as string | null,
        sourcePayloadJson: r.source_payload_json as Record<
          string,
          unknown
        > | null,
        parentThreadId: r.parent_thread_id as string | null,
        promotedFromId: r.promoted_from_id as string | null,
        pulledFromId: r.pulled_from_id as string | null,
        visibleInStudio: r.visible_in_studio as number,
        messageCount: r.message_count as number,
        promotedAt: r.promoted_at ? new Date(r.promoted_at as string) : null,
        archivedAt: r.archived_at ? new Date(r.archived_at as string) : null,
        markedDoneAt: r.marked_done_at
          ? new Date(r.marked_done_at as string)
          : null,
        markedDoneBy: (r.marked_done_by as string | null) ?? null,
        markedDoneSource: (r.marked_done_source as string | null) ?? null,
        createdAt: new Date(r.created_at as string),
        updatedAt: new Date(r.updated_at as string),
      })
    )
    return { session, threads }
  })
}

export type RecentExchangePart = {
  id: string
  content: string
  createdAt: string
}

export type RecentExchange = {
  id: string
  threadId: string
  threadTitle: string
  threadSourceApp: string
  user: RecentExchangePart | null
  assistant: RecentExchangePart | null
  lastActivityAt: string
}

/**
 * Recent sessions with the latest exchange tuples — a user prompt
 * paired with the immediately following assistant response. Powers
 * the rail's "Messages" tab, where the unit of interest is the
 * back-and-forth, not individual messages.
 *
 * Pairing rule (per thread, walking by turnIndex asc):
 *   - The LAST user message in a contiguous user run pairs with the
 *     FIRST assistant message that follows it.
 *   - Trailing user messages with no reply yet → { user, assistant: null }.
 *   - Leading assistant messages with no preceding user prompt
 *     (rare — system-led conversations) → { user: null, assistant }.
 *   - system/function role messages are dropped.
 *
 * Server-side pairing keeps the rail's render path dumb and the
 * payload small. We fetch enough recent messages per session
 * (`messageWindow`) to form `exchangesPerSession` pairs, sort
 * exchanges by lastActivityAt desc, and trim.
 */
export async function getRecentSessionsWithExchanges(
  workspaceId: string,
  sessionLimit = 8,
  exchangesPerSession = 4,
  messageWindow = 30
): Promise<
  Array<{
    session: OperatorSession
    exchanges: RecentExchange[]
  }>
> {
  const db = getDb()
  const sessionRows = await db
    .select()
    .from(operatorSessions)
    .where(eq(operatorSessions.workspaceId, workspaceId))
    .orderBy(desc(operatorSessions.startedAt))
    .limit(sessionLimit)
  const sessions = sessionRows.map(toSession)

  const results = await Promise.all(
    sessions.map(async (session) => {
      const rows = await db.execute<{
        id: string
        thread_id: string
        thread_title: string | null
        thread_promoted_title: string | null
        thread_source_app: string
        role: string
        content: string
        turn_index: number
        created_at: string
      }>(sql`
        SELECT
          m.id,
          m.thread_id,
          t.raw_title AS thread_title,
          t.promoted_title AS thread_promoted_title,
          t.source_app AS thread_source_app,
          m.role,
          m.content,
          m.turn_index,
          m.created_at
        FROM operator_thread_messages m
        INNER JOIN operator_threads t
          ON t.id = m.thread_id
         AND t.workspace_id = m.workspace_id
        WHERE m.workspace_id = ${workspaceId}
          AND m.created_at >= ${new Date(session.startedAt).toISOString()}
          AND m.created_at <= ${new Date(session.endedAt).toISOString()}
          AND t.visible_in_studio = 1
          AND m.role IN ('user', 'assistant')
        ORDER BY m.created_at DESC
        LIMIT ${messageWindow}
      `)
      const rawRows = (rows as unknown as {
        rows: Array<Record<string, unknown>>
      }).rows

      type Row = {
        id: string
        threadId: string
        threadTitle: string
        threadSourceApp: string
        role: "user" | "assistant"
        content: string
        turnIndex: number
        createdAt: string
      }
      const messages: Row[] = rawRows.map((r) => ({
        id: r.id as string,
        threadId: r.thread_id as string,
        threadTitle:
          (r.thread_promoted_title as string | null) ??
          (r.thread_title as string | null) ??
          "Untitled thread",
        threadSourceApp: r.thread_source_app as string,
        role: r.role as "user" | "assistant",
        content: r.content as string,
        turnIndex: r.turn_index as number,
        createdAt: new Date(r.created_at as string).toISOString(),
      }))

      // Group by thread, pair within each thread by turnIndex asc.
      const byThread = new Map<string, Row[]>()
      for (const m of messages) {
        const arr = byThread.get(m.threadId) ?? []
        arr.push(m)
        byThread.set(m.threadId, arr)
      }

      const exchanges: RecentExchange[] = []
      for (const [, threadMsgs] of byThread) {
        threadMsgs.sort((a, b) => a.turnIndex - b.turnIndex)
        let pendingUser: Row | null = null
        let pendingAssistant: Row | null = null
        const flushOrphanAssistant = () => {
          if (pendingAssistant && !pendingUser) {
            exchanges.push(makeExchange(null, pendingAssistant))
            pendingAssistant = null
          }
        }
        for (const m of threadMsgs) {
          if (m.role === "user") {
            flushOrphanAssistant()
            // Within a user-run, keep the LAST user message — the
            // assistant is replying to the most recent prompt, not
            // an earlier one in the same burst.
            pendingUser = m
          } else {
            if (pendingUser) {
              exchanges.push(makeExchange(pendingUser, m))
              pendingUser = null
              pendingAssistant = null
            } else if (!pendingAssistant) {
              // First assistant message of an orphan run — keep it.
              pendingAssistant = m
            }
          }
        }
        if (pendingUser) {
          exchanges.push(makeExchange(pendingUser, null))
        }
        if (pendingAssistant && !pendingUser) {
          exchanges.push(makeExchange(null, pendingAssistant))
        }
      }

      exchanges.sort(
        (a, b) =>
          new Date(b.lastActivityAt).getTime() -
          new Date(a.lastActivityAt).getTime()
      )
      return { session, exchanges: exchanges.slice(0, exchangesPerSession) }
    })
  )
  return results
}

function makeExchange(
  user: {
    id: string
    threadId: string
    threadTitle: string
    threadSourceApp: string
    content: string
    createdAt: string
  } | null,
  assistant: {
    id: string
    threadId: string
    threadTitle: string
    threadSourceApp: string
    content: string
    createdAt: string
  } | null
): RecentExchange {
  const ctx = user ?? assistant
  if (!ctx) {
    throw new Error("makeExchange requires at least one of user/assistant")
  }
  const lastActivityAt =
    user && assistant
      ? new Date(assistant.createdAt) > new Date(user.createdAt)
        ? assistant.createdAt
        : user.createdAt
      : (user?.createdAt ?? assistant!.createdAt)
  return {
    id: user?.id ?? assistant!.id,
    threadId: ctx.threadId,
    threadTitle: ctx.threadTitle,
    threadSourceApp: ctx.threadSourceApp,
    user: user
      ? { id: user.id, content: user.content, createdAt: user.createdAt }
      : null,
    assistant: assistant
      ? {
          id: assistant.id,
          content: assistant.content,
          createdAt: assistant.createdAt,
        }
      : null,
    lastActivityAt,
  }
}

/**
 * All messages whose createdAt falls within a session's time window,
 * across every thread that touches the window. Used by the session
 * detail page to feed the gold extractor, theme extractor, and
 * activity pulse — running all three off one query avoids three
 * separate round trips.
 *
 * Returns lightweight projections (id, threadId, role, content,
 * turnIndex, createdAt) — content is included because the extractors
 * need it. For typical session sizes (hundreds of messages) this is
 * fine; if sessions grow to thousands of turns we can paginate the
 * gold/theme pass but keep raw counts aggregate.
 */
export async function getMessagesInSessionWindow(
  workspaceId: string,
  startedAt: Date,
  endedAt: Date
): Promise<
  Array<{
    id: string
    threadId: string
    role: string
    content: string
    turnIndex: number
    createdAt: string
  }>
> {
  const db = getDb()
  const rows = await db
    .select({
      id: operatorThreadMessages.id,
      threadId: operatorThreadMessages.threadId,
      role: operatorThreadMessages.role,
      content: operatorThreadMessages.content,
      turnIndex: operatorThreadMessages.turnIndex,
      createdAt: operatorThreadMessages.createdAt,
    })
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        gte(operatorThreadMessages.createdAt, startedAt),
        lte(operatorThreadMessages.createdAt, endedAt)
      )
    )
    .orderBy(asc(operatorThreadMessages.createdAt))
  return rows.map((r) => ({
    id: r.id,
    threadId: r.threadId,
    role: r.role,
    content: r.content,
    turnIndex: r.turnIndex,
    createdAt: r.createdAt.toISOString(),
  }))
}

/**
 * Hour-of-day × day-of-week activity histogram for the last `days`
 * days. Powers the Foundry "circadian heatmap" panel — when does the
 * team actually work? 7 rows (Sun..Sat) × 24 cols (0..23) of message
 * counts.
 *
 * Computed in PG so we don't transfer N messages just to bucket them.
 * Uses local-time interpretation via AT TIME ZONE — falls back to
 * server's TZ which is fine for OSS self-hosted (single-user) but
 * worth revisiting if we ever go multi-tz.
 */
export async function getCircadianActivity(
  workspaceId: string,
  days: number = 14
): Promise<Array<{ dow: number; hour: number; count: number }>> {
  const db = getDb()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db.execute<{
    dow: string
    hour: string
    count: string
  }>(sql`
    SELECT
      EXTRACT(DOW FROM created_at)::int AS dow,
      EXTRACT(HOUR FROM created_at)::int AS hour,
      COUNT(*)::int AS count
    FROM operator_thread_messages
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${cutoff.toISOString()}
    GROUP BY dow, hour
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    dow: Number(r.dow),
    hour: Number(r.hour),
    count: Number(r.count),
  }))
}

/**
 * Top contributors over the last `days` days — actor leaderboard for
 * the Foundry. "Contribution" = threads imported + threads promoted
 * + messages promoted, weighted equally. Pulls from imported_by /
 * owner_name / promoted_by columns.
 */
export async function getTopActors(
  workspaceId: string,
  days: number = 30,
  limit: number = 8
): Promise<
  Array<{
    actor: string
    threadsImported: number
    threadsPromoted: number
    messagesPromoted: number
    score: number
  }>
> {
  const db = getDb()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db.execute<{
    actor: string
    threads_imported: string
    threads_promoted: string
    messages_promoted: string
  }>(sql`
    WITH imported AS (
      SELECT imported_by AS actor, COUNT(*)::int AS n
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND imported_at >= ${cutoff.toISOString()}
        AND imported_by IS NOT NULL
      GROUP BY imported_by
    ),
    promoted_threads AS (
      SELECT COALESCE(owner_name, imported_by) AS actor, COUNT(*)::int AS n
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND promoted_at IS NOT NULL
        AND promoted_at >= ${cutoff.toISOString()}
      GROUP BY actor
    ),
    promoted_msgs AS (
      SELECT promoted_by AS actor, COUNT(*)::int AS n
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND promoted_at IS NOT NULL
        AND promoted_at >= ${cutoff.toISOString()}
        AND promoted_by IS NOT NULL
      GROUP BY promoted_by
    ),
    actors AS (
      SELECT actor FROM imported
      UNION SELECT actor FROM promoted_threads
      UNION SELECT actor FROM promoted_msgs
    )
    SELECT
      a.actor,
      COALESCE(i.n, 0) AS threads_imported,
      COALESCE(pt.n, 0) AS threads_promoted,
      COALESCE(pm.n, 0) AS messages_promoted
    FROM actors a
    LEFT JOIN imported i ON i.actor = a.actor
    LEFT JOIN promoted_threads pt ON pt.actor = a.actor
    LEFT JOIN promoted_msgs pm ON pm.actor = a.actor
    ORDER BY (COALESCE(i.n,0) + COALESCE(pt.n,0) + COALESCE(pm.n,0)) DESC
    LIMIT ${limit}
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => {
    const ti = Number(r.threads_imported) || 0
    const tp = Number(r.threads_promoted) || 0
    const mp = Number(r.messages_promoted) || 0
    return {
      actor: r.actor as string,
      threadsImported: ti,
      threadsPromoted: tp,
      messagesPromoted: mp,
      score: ti + tp + mp,
    }
  })
}

/**
 * Per-turn shape of the top-N largest threads, for the Genome panel.
 * Returns each thread with its messages projected to {role, length,
 * promotedAt} — enough to render a per-turn DNA strip that color-
 * codes role, sizes by length, and highlights promoted cells. Caps
 * at maxTurnsPerThread (downsampled evenly) so a 1000-turn monster
 * doesn't dominate the strip.
 */
export async function getThreadGenomes(
  workspaceId: string,
  topN: number = 6,
  maxTurnsPerThread: number = 80
): Promise<
  Array<{
    threadId: string
    title: string | null
    sourceApp: string
    totalTurns: number
    turns: Array<{
      role: string
      length: number
      promotedAt: string | null
    }>
  }>
> {
  const db = getDb()
  const topThreadRows = await db.execute<{
    id: string
    title: string | null
    source_app: string
    message_count: string
  }>(sql`
    SELECT id, COALESCE(promoted_title, raw_title) AS title,
           source_app, message_count
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
      AND visible_in_studio = 1
    ORDER BY message_count DESC
    LIMIT ${topN}
  `)
  const tops = (topThreadRows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  if (tops.length === 0) return []

  const ids = tops.map((t) => t.id as string)
  const msgRows = await db.execute<{
    thread_id: string
    role: string
    length: string
    promoted_at: string | null
    turn_index: string
  }>(sql`
    SELECT thread_id, role,
           LENGTH(content) AS length,
           promoted_at,
           turn_index
    FROM operator_thread_messages
    WHERE workspace_id = ${workspaceId}
      AND thread_id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    ORDER BY thread_id, turn_index ASC
  `)
  const allRows = (msgRows as unknown as { rows: Array<Record<string, unknown>> })
    .rows

  const byThread = new Map<
    string,
    Array<{ role: string; length: number; promotedAt: string | null }>
  >()
  for (const r of allRows) {
    const tid = r.thread_id as string
    const list = byThread.get(tid) ?? []
    list.push({
      role: r.role as string,
      length: Number(r.length) || 0,
      promotedAt: r.promoted_at
        ? new Date(r.promoted_at as string).toISOString()
        : null,
    })
    byThread.set(tid, list)
  }

  return tops.map((t) => {
    const all = byThread.get(t.id as string) ?? []
    let turns = all
    if (all.length > maxTurnsPerThread) {
      const step = all.length / maxTurnsPerThread
      const sampled: typeof all = []
      for (let i = 0; i < maxTurnsPerThread; i++) {
        sampled.push(all[Math.floor(i * step)])
      }
      turns = sampled
    }
    return {
      threadId: t.id as string,
      title: t.title as string | null,
      sourceApp: t.source_app as string,
      totalTurns: Number(t.message_count) || 0,
      turns,
    }
  })
}

/**
 * Canvas data for the "active threads" visualization — the hero
 * element that sits above the Foundry KPI strip. For each thread the
 * caller asks about, returns the four bookend messages (first user,
 * first assistant, last user, last assistant) plus a lightweight
 * turn-signature so the UI can render a visual DNA strip.
 *
 * Two queries:
 *   1. bookends — ROW_NUMBER window over (thread_id, role) in both
 *      directions, first/last per role picked in one pass.
 *   2. signature — role + length(content) + turn_index for every turn,
 *      capped at 240 per thread so pathological megathreads don't
 *      blow up the page.
 *
 * Intentionally different shape from getThreadGenomes (workspace-wide
 * top-N, no bookends) — this one is session-scoped and includes the
 * full message bodies for the four bookends.
 */
export interface CanvasBookend {
  id: string
  content: string
  turnIndex: number
  createdAt: string
}

export interface CanvasThread {
  threadId: string
  firstUser: CanvasBookend | null
  firstAssistant: CanvasBookend | null
  lastUser: CanvasBookend | null
  lastAssistant: CanvasBookend | null
  signature: Array<{ role: string; length: number; turnIndex: number }>
}

export async function getSessionThreadCanvas(
  workspaceId: string,
  threadIds: string[]
): Promise<CanvasThread[]> {
  if (threadIds.length === 0) return []
  const db = getDb()

  const bookendRows = await db.execute<{
    thread_id: string
    role: string
    position: string
    id: string
    content: string
    turn_index: number
    created_at: string
  }>(sql`
    WITH ranked AS (
      SELECT
        thread_id,
        role,
        id,
        content,
        turn_index,
        created_at,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id, role
          ORDER BY turn_index ASC
        ) AS r_asc,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id, role
          ORDER BY turn_index DESC
        ) AS r_desc
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND thread_id = ANY(${threadIds})
        AND role IN ('user', 'assistant')
    )
    SELECT
      thread_id,
      role,
      CASE WHEN r_asc = 1 THEN 'first' ELSE 'last' END AS position,
      id,
      content,
      turn_index,
      created_at
    FROM ranked
    WHERE r_asc = 1 OR r_desc = 1
  `)

  const signatureRows = await db.execute<{
    thread_id: string
    role: string
    length: string
    turn_index: number
  }>(sql`
    WITH ranked AS (
      SELECT
        thread_id,
        role,
        LENGTH(content) AS length,
        turn_index,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY turn_index ASC
        ) AS r
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND thread_id = ANY(${threadIds})
        AND role IN ('user', 'assistant')
    )
    SELECT thread_id, role, length, turn_index
    FROM ranked
    WHERE r <= 240
    ORDER BY thread_id, turn_index
  `)

  const bookRaw = (
    bookendRows as unknown as { rows: Array<Record<string, unknown>> }
  ).rows
  const sigRaw = (
    signatureRows as unknown as { rows: Array<Record<string, unknown>> }
  ).rows

  const map = new Map<string, CanvasThread>()
  for (const id of threadIds) {
    map.set(id, {
      threadId: id,
      firstUser: null,
      firstAssistant: null,
      lastUser: null,
      lastAssistant: null,
      signature: [],
    })
  }

  for (const r of bookRaw) {
    const tid = r.thread_id as string
    const row = map.get(tid)
    if (!row) continue
    const bookend: CanvasBookend = {
      id: r.id as string,
      content: r.content as string,
      turnIndex: r.turn_index as number,
      createdAt: new Date(r.created_at as string).toISOString(),
    }
    const pos = r.position as "first" | "last"
    const role = r.role as "user" | "assistant"
    if (pos === "first" && role === "user") row.firstUser = bookend
    else if (pos === "first" && role === "assistant")
      row.firstAssistant = bookend
    else if (pos === "last" && role === "user") row.lastUser = bookend
    else if (pos === "last" && role === "assistant")
      row.lastAssistant = bookend
  }

  for (const r of sigRaw) {
    const tid = r.thread_id as string
    const row = map.get(tid)
    if (!row) continue
    row.signature.push({
      role: r.role as string,
      length: Number(r.length) || 0,
      turnIndex: r.turn_index as number,
    })
  }

  return threadIds
    .map((id) => map.get(id))
    .filter((x): x is CanvasThread => !!x)
}

/**
 * "Hot threads" right now — threads that have received any message in
 * the last `recentMinutes`. Sorted by message count over the window.
 * Used by Foundry to show the user "where is the action right now?"
 * without them clicking around.
 */
export async function getHotThreads(
  workspaceId: string,
  recentMinutes: number = 60,
  limit: number = 6
): Promise<
  Array<{
    threadId: string
    title: string | null
    sourceApp: string
    recentMessages: number
    totalMessages: number
    lastMessageAt: string
  }>
> {
  const db = getDb()
  const cutoff = new Date(Date.now() - recentMinutes * 60 * 1000)
  const rows = await db.execute<{
    thread_id: string
    title: string | null
    source_app: string
    recent_messages: string
    total_messages: string
    last_message_at: string
  }>(sql`
    SELECT
      m.thread_id,
      COALESCE(t.promoted_title, t.raw_title) AS title,
      t.source_app,
      COUNT(*)::int AS recent_messages,
      t.message_count AS total_messages,
      MAX(m.created_at) AS last_message_at
    FROM operator_thread_messages m
    INNER JOIN operator_threads t
      ON t.id = m.thread_id AND t.workspace_id = m.workspace_id
    WHERE m.workspace_id = ${workspaceId}
      AND m.created_at >= ${cutoff.toISOString()}
    GROUP BY m.thread_id, t.promoted_title, t.raw_title, t.source_app, t.message_count
    ORDER BY recent_messages DESC
    LIMIT ${limit}
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    threadId: r.thread_id as string,
    title: r.title as string | null,
    sourceApp: r.source_app as string,
    recentMessages: Number(r.recent_messages) || 0,
    totalMessages: Number(r.total_messages) || 0,
    lastMessageAt: new Date(r.last_message_at as string).toISOString(),
  }))
}

/**
 * Recent messages across the entire workspace, capped for the gold
 * extractor's appetite. Used by Foundry — the Skunk Works command-
 * center surface — to surface the workspace-wide gold queue without
 * loading every message ever sent.
 *
 * Default window: 14 days, hard limit 8000 rows. The gold extractor
 * is O(n) over what we hand it; 8000 messages × ~50µs of regex
 * detection = ~400ms one-time at page load. Acceptable for an
 * intelligence-grade surface.
 *
 * Includes thread title (denormalized via JOIN) so the gold cards
 * can attribute each candidate without a second lookup.
 */
export async function getRecentMessagesAcrossWorkspace(
  workspaceId: string,
  opts: { days?: number; limit?: number } = {}
): Promise<
  Array<{
    id: string
    threadId: string
    threadTitle: string | null
    role: string
    content: string
    turnIndex: number
    createdAt: string
    threadTurnCount: number
  }>
> {
  const days = opts.days ?? 14
  const limit = opts.limit ?? 8000
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const db = getDb()
  const rows = await db.execute<{
    id: string
    thread_id: string
    thread_title: string | null
    role: string
    content: string
    turn_index: number
    created_at: string
    thread_turn_count: string
  }>(sql`
    WITH thread_counts AS (
      SELECT thread_id, COUNT(*)::int AS c
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
      GROUP BY thread_id
    )
    SELECT
      m.id,
      m.thread_id,
      COALESCE(t.promoted_title, t.raw_title) AS thread_title,
      m.role,
      m.content,
      m.turn_index,
      m.created_at,
      tc.c AS thread_turn_count
    FROM operator_thread_messages m
    INNER JOIN operator_threads t
      ON t.id = m.thread_id AND t.workspace_id = m.workspace_id
    LEFT JOIN thread_counts tc ON tc.thread_id = m.thread_id
    WHERE m.workspace_id = ${workspaceId}
      AND m.created_at >= ${cutoff.toISOString()}
    ORDER BY m.created_at DESC
    LIMIT ${limit}
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    id: r.id as string,
    threadId: r.thread_id as string,
    threadTitle: (r.thread_title as string | null) ?? null,
    role: r.role as string,
    content: r.content as string,
    turnIndex: r.turn_index as number,
    createdAt: new Date(r.created_at as string).toISOString(),
    threadTurnCount: Number(r.thread_turn_count) || 0,
  }))
}

/**
 * Promotion velocity over the last N days — counts of message
 * promotions and thread state-changes per day. Drives the
 * "promotion velocity" panel in Foundry: the team's actual
 * gold-mining pace.
 *
 * Returns one row per day that had activity; the UI fills zeros.
 * Uses promoted_at on threads (tracks transitions to "promoted" state)
 * and on messages (tracks `Fire`-style message promotions).
 */
export async function getPromotionVelocity(
  workspaceId: string,
  days: number = 30
): Promise<
  Array<{
    date: string // YYYY-MM-DD
    threadPromotions: number
    messagePromotions: number
    forks: number
  }>
> {
  const db = getDb()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db.execute<{
    day: string
    thread_promotions: string
    message_promotions: string
    forks: string
  }>(sql`
    WITH thread_p AS (
      SELECT TO_CHAR(DATE_TRUNC('day', promoted_at), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND promoted_at IS NOT NULL
        AND promoted_at >= ${cutoff.toISOString()}
      GROUP BY day
    ),
    msg_p AS (
      SELECT TO_CHAR(DATE_TRUNC('day', promoted_at), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND promoted_at IS NOT NULL
        AND promoted_at >= ${cutoff.toISOString()}
      GROUP BY day
    ),
    fork_p AS (
      SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS day,
             COUNT(*)::int AS n
      FROM operator_threads
      WHERE workspace_id = ${workspaceId}
        AND parent_thread_id IS NOT NULL
        AND created_at >= ${cutoff.toISOString()}
      GROUP BY day
    ),
    days AS (
      SELECT day FROM thread_p
      UNION SELECT day FROM msg_p
      UNION SELECT day FROM fork_p
    )
    SELECT
      d.day,
      COALESCE(t.n, 0) AS thread_promotions,
      COALESCE(m.n, 0) AS message_promotions,
      COALESCE(f.n, 0) AS forks
    FROM days d
    LEFT JOIN thread_p t ON t.day = d.day
    LEFT JOIN msg_p m ON m.day = d.day
    LEFT JOIN fork_p f ON f.day = d.day
    ORDER BY d.day ASC
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    date: r.day as string,
    threadPromotions: Number(r.thread_promotions) || 0,
    messagePromotions: Number(r.message_promotions) || 0,
    forks: Number(r.forks) || 0,
  }))
}

/**
 * Threads counted by source app for the workspace. Drives the source
 * breakdown bar at the bottom of Foundry — instant read on which
 * agents the team is using.
 */
export async function getSourceBreakdown(
  workspaceId: string
): Promise<Array<{ sourceApp: string; threadCount: number; messageCount: number }>> {
  const db = getDb()
  const rows = await db.execute<{
    source_app: string
    thread_count: string
    message_count: string
  }>(sql`
    SELECT
      t.source_app,
      COUNT(DISTINCT t.id)::int AS thread_count,
      COALESCE(SUM(t.message_count), 0)::int AS message_count
    FROM operator_threads t
    WHERE t.workspace_id = ${workspaceId}
    GROUP BY t.source_app
    ORDER BY message_count DESC
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    sourceApp: r.source_app as string,
    threadCount: Number(r.thread_count) || 0,
    messageCount: Number(r.message_count) || 0,
  }))
}

/**
 * Recent activity events for the Foundry live feed: thread imports,
 * thread promotions, fork creations. Capped at limit, newest first.
 */
export async function getRecentFoundryEvents(
  workspaceId: string,
  limit: number = 30
): Promise<
  Array<{
    kind: "imported" | "promoted" | "forked"
    at: string
    threadId: string
    threadTitle: string | null
    actor: string | null
  }>
> {
  const db = getDb()
  const rows = await db.execute<{
    kind: string
    at: string
    thread_id: string
    thread_title: string | null
    actor: string | null
  }>(sql`
    SELECT 'imported' AS kind,
           imported_at AS at,
           id AS thread_id,
           COALESCE(promoted_title, raw_title) AS thread_title,
           imported_by AS actor
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
      AND parent_thread_id IS NULL
    UNION ALL
    SELECT 'promoted' AS kind,
           promoted_at AS at,
           id AS thread_id,
           COALESCE(promoted_title, raw_title) AS thread_title,
           owner_name AS actor
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
      AND promoted_at IS NOT NULL
    UNION ALL
    SELECT 'forked' AS kind,
           created_at AS at,
           id AS thread_id,
           COALESCE(promoted_title, raw_title) AS thread_title,
           owner_name AS actor
    FROM operator_threads
    WHERE workspace_id = ${workspaceId}
      AND parent_thread_id IS NOT NULL
    ORDER BY at DESC
    LIMIT ${limit}
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    kind: r.kind as "imported" | "promoted" | "forked",
    at: new Date(r.at as string).toISOString(),
    threadId: r.thread_id as string,
    threadTitle: (r.thread_title as string | null) ?? null,
    actor: (r.actor as string | null) ?? null,
  }))
}

/**
 * Per-day message volume over the last N days — powers the activity
 * sparkline at the top of the sessions page. Returns entries only for
 * days that had activity; the UI fills in zeroes for missing days so
 * the sparkline can render a continuous strip.
 */
export async function getDailyMessageActivity(
  workspaceId: string,
  days: number = 30
): Promise<Array<{ date: string; messageCount: number }>> {
  const db = getDb()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db.execute<{ day: string; count: string }>(sql`
    SELECT
      TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') as day,
      COUNT(*) as count
    FROM operator_thread_messages
    WHERE workspace_id = ${workspaceId}
      AND created_at >= ${cutoff.toISOString()}
    GROUP BY day
    ORDER BY day ASC
  `)
  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows
  return rawRows.map((r) => ({
    date: r.day as string,
    messageCount: Number(r.count),
  }))
}

/**
 * Top N threads for each session in the workspace, by message count
 * within the session's time window. Used by the sessions list to
 * show a teaser like "Top: api-redesign · operator-studio · runbooks"
 * beneath each session card — gives the
 * user a "scene" for the session without clicking in.
 *
 * Returns a Map keyed by sessionId, with a list of {threadId, title,
 * messageCount} entries sorted descending by messageCount.
 */
export async function getTopThreadsPerSession(
  workspaceId: string,
  topN: number = 3
): Promise<
  Map<
    string,
    Array<{
      threadId: string
      title: string | null
      messageCount: number
    }>
  >
> {
  const db = getDb()
  const rows = await db.execute<{
    session_id: string
    thread_id: string
    title: string | null
    messages_in_window: string
  }>(sql`
    SELECT
      s.id as session_id,
      t.id as thread_id,
      COALESCE(t.promoted_title, t.raw_title) as title,
      COUNT(m.id) as messages_in_window
    FROM operator_sessions s
    INNER JOIN operator_thread_messages m
      ON m.workspace_id = s.workspace_id
     AND m.created_at >= s.started_at
     AND m.created_at <= s.ended_at
    INNER JOIN operator_threads t
      ON t.id = m.thread_id
     AND t.workspace_id = s.workspace_id
    WHERE s.workspace_id = ${workspaceId}
    GROUP BY s.id, t.id
    ORDER BY s.id, messages_in_window DESC
  `)

  const rawRows = (rows as unknown as { rows: Array<Record<string, unknown>> })
    .rows

  const map = new Map<
    string,
    Array<{ threadId: string; title: string | null; messageCount: number }>
  >()
  for (const r of rawRows) {
    const sessionId = r.session_id as string
    const list = map.get(sessionId) ?? []
    if (list.length < topN) {
      list.push({
        threadId: r.thread_id as string,
        title: r.title as string | null,
        messageCount: Number(r.messages_in_window),
      })
    }
    map.set(sessionId, list)
  }
  return map
}

/**
 * Update the user-editable label on a session. Null → clear (fall back
 * to the default derived label in the UI).
 */
export async function updateSessionLabel(
  workspaceId: string,
  sessionId: string,
  label: string | null
): Promise<void> {
  const db = getDb()
  await db
    .update(operatorSessions)
    .set({ label, updatedAt: new Date() })
    .where(
      and(
        eq(operatorSessions.workspaceId, workspaceId),
        eq(operatorSessions.id, sessionId)
      )
    )
}

/**
 * Replace the plan step list on a session. Atomic — client sends the
 * full new list, server persists as-is. The client is responsible for
 * preserving step ids on edits (so fulfillments keep their link).
 *
 * Also cleans up orphan fulfillments when a step is removed: any
 * fulfillment whose stepId isn't in the new list gets deleted, so
 * "this message fulfills step-deleted" never persists.
 *
 * @deprecated Writes the legacy `operator_sessions.plan_steps` jsonb
 * column. The plan model has moved to durable plans backed by
 * `operator_plans` + `operator_plan_steps` (migration 0007). New
 * plan CRUD lives in `lib/operator-studio/plans.ts` —
 * `setPlanSteps` / `updatePlanStep` / `deletePlanStep`. Only the
 * session-detail page's legacy plan editor still calls this; remove
 * once that surface is migrated.
 */
export async function updatePlanSteps(
  workspaceId: string,
  sessionId: string,
  steps: OperatorPlanStep[]
): Promise<void> {
  const db = getDb()
  const liveStepIds = new Set(steps.map((s) => s.id))
  await db.transaction(async (tx) => {
    await tx
      .update(operatorSessions)
      .set({ planSteps: steps, updatedAt: new Date() })
      .where(
        and(
          eq(operatorSessions.workspaceId, workspaceId),
          eq(operatorSessions.id, sessionId)
        )
      )

    // Fetch existing fulfillments for this session and delete any
    // whose step_id is no longer in the plan. Doing it client-side
    // (pull then filter) because SQL NOT IN with an empty list is
    // a footgun across dialects.
    const existing = await tx
      .select()
      .from(operatorStepFulfillments)
      .where(
        and(
          eq(operatorStepFulfillments.workspaceId, workspaceId),
          eq(operatorStepFulfillments.sessionId, sessionId)
        )
      )
    const toDelete = existing.filter((f) => !liveStepIds.has(f.stepId))
    for (const f of toDelete) {
      await tx
        .delete(operatorStepFulfillments)
        .where(eq(operatorStepFulfillments.id, f.id))
    }
  })
}

// ─── Step evidence / fulfillments ───────────────────────────────────────────

function toFulfillment(
  row: typeof operatorStepFulfillments.$inferSelect
): OperatorStepFulfillment {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sessionId: row.sessionId,
    stepId: row.stepId,
    targetType: row.targetType as OperatorFulfillmentTargetType,
    targetId: row.targetId,
    note: row.note,
    promotedBy: row.promotedBy,
    promotedAt: row.promotedAt.toISOString(),
  }
}

/**
 * Attach a thread or message as accepted evidence for a plan step.
 *
 * The storage/API name is still "fulfillment" for compatibility with the
 * existing table and routes. Idempotent via the
 * unique index (sessionId, stepId, targetType, targetId) — calling
 * twice with the same inputs is a no-op thanks to ON CONFLICT.
 *
 * Returns the fulfillment/evidence row (newly-created or pre-existing).
 */
export async function promoteToStep(
  workspaceId: string,
  sessionId: string,
  stepId: string,
  targetType: OperatorFulfillmentTargetType,
  targetId: string,
  promotedBy: string,
  note?: string
): Promise<OperatorStepFulfillment> {
  const db = getDb()
  const id = `fulfill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date()

  const [row] = await db
    .insert(operatorStepFulfillments)
    .values({
      id,
      workspaceId,
      sessionId,
      stepId,
      targetType,
      targetId,
      note: note ?? null,
      promotedBy,
      promotedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        operatorStepFulfillments.sessionId,
        operatorStepFulfillments.stepId,
        operatorStepFulfillments.targetType,
        operatorStepFulfillments.targetId,
      ],
      // On conflict, just bump promotedAt and return the existing row.
      // We set note to itself to force a returning() to fire.
      set: { promotedAt: now },
    })
    .returning()

  return toFulfillment(row)
}

/**
 * Remove a single accepted evidence row. Toggle-style: the UI calls this when
 * the user un-promotes/unlinks. No-op if the row doesn't exist.
 */
export async function unpromoteFromStep(
  workspaceId: string,
  fulfillmentId: string
): Promise<void> {
  const db = getDb()
  await db
    .delete(operatorStepFulfillments)
    .where(
      and(
        eq(operatorStepFulfillments.workspaceId, workspaceId),
        eq(operatorStepFulfillments.id, fulfillmentId)
      )
    )
}

/**
 * All fulfillments for a session, across all steps. Used by the
 * coverage view to group targets under each step.
 */
export async function getFulfillmentsForSession(
  workspaceId: string,
  sessionId: string
): Promise<OperatorStepFulfillment[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorStepFulfillments)
    .where(
      and(
        eq(operatorStepFulfillments.workspaceId, workspaceId),
        eq(operatorStepFulfillments.sessionId, sessionId)
      )
    )
    .orderBy(asc(operatorStepFulfillments.promotedAt))
  return rows.map(toFulfillment)
}

/**
 * All fulfillments accepted for a single plan step, across every
 * session. Powers the step modal's evidence list — the step is the
 * durable unit, sessions are just provenance for when each piece
 * landed.
 */
export async function getFulfillmentsForStep(
  workspaceId: string,
  stepId: string
): Promise<OperatorStepFulfillment[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorStepFulfillments)
    .where(
      and(
        eq(operatorStepFulfillments.workspaceId, workspaceId),
        eq(operatorStepFulfillments.stepId, stepId)
      )
    )
    .orderBy(desc(operatorStepFulfillments.promotedAt))
  return rows.map(toFulfillment)
}

/**
 * All fulfillments involving a specific target — "what does this
 * thread/message fulfill, across every session?" Powers the thread
 * detail badge.
 */
export async function getFulfillmentsForTarget(
  workspaceId: string,
  targetType: OperatorFulfillmentTargetType,
  targetId: string
): Promise<OperatorStepFulfillment[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorStepFulfillments)
    .where(
      and(
        eq(operatorStepFulfillments.workspaceId, workspaceId),
        eq(operatorStepFulfillments.targetType, targetType),
        eq(operatorStepFulfillments.targetId, targetId)
      )
    )
    .orderBy(desc(operatorStepFulfillments.promotedAt))
  return rows.map(toFulfillment)
}

// ─── Thread passages ────────────────────────────────────────────────────────

function toPassage(
  row: typeof operatorThreadPassages.$inferSelect
): OperatorThreadPassage {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    threadId: row.threadId,
    messageId: row.messageId,
    startOffset: row.startOffset,
    endOffset: row.endOffset,
    textSnapshot: row.textSnapshot,
    textHash: row.textHash,
    note: row.note,
    labelId: row.labelId ?? null,
    promotedBy: row.promotedBy,
    promotedAt: row.promotedAt.toISOString(),
  }
}

/**
 * Persist a freshly-promoted passage. Caller is responsible for
 * resolving messageId → threadId → workspaceId before calling so the
 * row stays internally consistent.
 */
export async function createPassage(input: {
  id: string
  workspaceId: string
  threadId: string
  messageId: string
  startOffset: number
  endOffset: number
  textSnapshot: string
  textHash: string
  note: string | null
  labelId?: string | null
  promotedBy: string
}): Promise<OperatorThreadPassage> {
  const db = getDb()
  const [row] = await db
    .insert(operatorThreadPassages)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      messageId: input.messageId,
      startOffset: input.startOffset,
      endOffset: input.endOffset,
      textSnapshot: input.textSnapshot,
      textHash: input.textHash,
      note: input.note,
      labelId: input.labelId ?? null,
      promotedBy: input.promotedBy,
      promotedAt: new Date(),
    })
    .returning()
  return toPassage(row)
}

/** All passages elevated within a thread, newest first. Powers the
 *  highlight overlay in the thread reader and the "show all elevated
 *  passages" view. */
export async function getPassagesForThread(
  workspaceId: string,
  threadId: string
): Promise<OperatorThreadPassage[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadPassages)
    .where(
      and(
        eq(operatorThreadPassages.workspaceId, workspaceId),
        eq(operatorThreadPassages.threadId, threadId)
      )
    )
    .orderBy(desc(operatorThreadPassages.promotedAt))
  return rows.map(toPassage)
}

/** All passages within a single message — used for inline mark
 *  rendering when a message has multiple promoted spans. */
export async function getPassagesForMessage(
  workspaceId: string,
  messageId: string
): Promise<OperatorThreadPassage[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadPassages)
    .where(
      and(
        eq(operatorThreadPassages.workspaceId, workspaceId),
        eq(operatorThreadPassages.messageId, messageId)
      )
    )
    .orderBy(asc(operatorThreadPassages.startOffset))
  return rows.map(toPassage)
}

export async function deletePassage(
  workspaceId: string,
  passageId: string
): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .delete(operatorThreadPassages)
    .where(
      and(
        eq(operatorThreadPassages.workspaceId, workspaceId),
        eq(operatorThreadPassages.id, passageId)
      )
    )
    .returning({ id: operatorThreadPassages.id })
  return rows.length > 0
}

// ─── Progress recap ────────────────────────────────────────────────────────
//
// "What got done in this window?" Powers the MCP `progress_recap` tool
// and any future Brief-style velocity surface. Returns aggregate counts
// plus the small set of newly-fulfilled step ids so callers can render
// them inline.
//
// Critical design note: there is NO step-status audit log, so we
// cannot answer "which steps flipped to covered this week?" directly.
// Instead we use `operator_step_fulfillments.promoted_at` — a step's
// "first fulfillment in window" is the closest available proxy for
// "this is when work landed against this step." A step might already
// have had its status set to covered before the window; the
// fulfillment timestamp tells us when evidence actually got attached.
//
// Plans / threads / messages all carry their own promotion or shipping
// timestamps; those are reliable single-source-of-truth.

export interface ProgressRecap {
  /** ISO-8601 inclusive window. */
  window: { since: string; until: string }
  sessions: {
    /** Sessions whose [startedAt, endedAt] overlap the window. */
    count: number
    /** Distinct threads with at least one message inside the window. */
    threadsTouched: number
    /** Total messages authored in the window across all threads. */
    messagesAuthored: number
  }
  threads: {
    /** Threads with importedAt inside the window. */
    importedInWindow: number
    /** Threads with promotedAt inside the window. */
    promotedInWindow: number
  }
  messages: {
    /** Messages with promotedAt inside the window. */
    promotedInWindow: number
  }
  plans: {
    /** Plans with shippedAt inside the window. */
    shippedInWindow: number
    /** Plans with archivedAt inside the window. */
    archivedInWindow: number
  }
  fulfillments: {
    /** All fulfillment rows whose promotedAt falls in the window. */
    totalInWindow: number
    /** Steps whose FIRST-EVER fulfillment landed in the window —
     *  effectively newly-evidenced. */
    stepsFirstFulfilledCount: number
    /** Up to 20 of the step ids above, with their plan + title for
     *  rendering. Ordered by first-fulfilled-at ascending so the
     *  earliest wins of the window come first. */
    stepsFirstFulfilled: Array<{
      stepId: string
      stepTitle: string
      planId: string
      planTitle: string
      firstFulfilledAt: string
    }>
  }
}

export async function getProgressRecap(
  workspaceId: string,
  since: Date,
  until: Date
): Promise<ProgressRecap> {
  const db = getDb()
  const sinceIso = since.toISOString()
  const untilIso = until.toISOString()

  // Single round-trip per metric — Postgres is fast and parallelism
  // here is bounded by the connection pool size (typically 10+). All
  // these queries fly under a millisecond against your dev DB.
  const [
    sessionRows,
    threadsTouchedRow,
    messagesAuthoredRow,
    threadsImportedRow,
    threadsPromotedRow,
    messagesPromotedRow,
    plansShippedRow,
    plansArchivedRow,
    fulfillmentsTotalRow,
    firstFulfilledRows,
  ] = await Promise.all([
    // Sessions overlapping the window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorSessions)
      .where(
        and(
          eq(operatorSessions.workspaceId, workspaceId),
          lte(operatorSessions.startedAt, until),
          gte(operatorSessions.endedAt, since)
        )
      ),

    // Distinct threads with activity in window.
    db.execute<{ count: number }>(sql`
      SELECT COUNT(DISTINCT thread_id)::int AS count
      FROM operator_thread_messages
      WHERE workspace_id = ${workspaceId}
        AND created_at >= ${sinceIso}
        AND created_at <= ${untilIso}
    `),

    // Messages authored in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorThreadMessages)
      .where(
        and(
          eq(operatorThreadMessages.workspaceId, workspaceId),
          gte(operatorThreadMessages.createdAt, since),
          lte(operatorThreadMessages.createdAt, until)
        )
      ),

    // Threads imported in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorThreads)
      .where(
        and(
          eq(operatorThreads.workspaceId, workspaceId),
          gte(operatorThreads.importedAt, since),
          lte(operatorThreads.importedAt, until)
        )
      ),

    // Threads promoted in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorThreads)
      .where(
        and(
          eq(operatorThreads.workspaceId, workspaceId),
          isNotNull(operatorThreads.promotedAt),
          gte(operatorThreads.promotedAt, since),
          lte(operatorThreads.promotedAt, until)
        )
      ),

    // Messages promoted in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorThreadMessages)
      .where(
        and(
          eq(operatorThreadMessages.workspaceId, workspaceId),
          isNotNull(operatorThreadMessages.promotedAt),
          gte(operatorThreadMessages.promotedAt, since),
          lte(operatorThreadMessages.promotedAt, until)
        )
      ),

    // Plans shipped in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorPlans)
      .where(
        and(
          eq(operatorPlans.workspaceId, workspaceId),
          isNotNull(operatorPlans.shippedAt),
          gte(operatorPlans.shippedAt, since),
          lte(operatorPlans.shippedAt, until)
        )
      ),

    // Plans archived in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorPlans)
      .where(
        and(
          eq(operatorPlans.workspaceId, workspaceId),
          isNotNull(operatorPlans.archivedAt),
          gte(operatorPlans.archivedAt, since),
          lte(operatorPlans.archivedAt, until)
        )
      ),

    // All fulfillments in window.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(operatorStepFulfillments)
      .where(
        and(
          eq(operatorStepFulfillments.workspaceId, workspaceId),
          gte(operatorStepFulfillments.promotedAt, since),
          lte(operatorStepFulfillments.promotedAt, until)
        )
      ),

    // Steps whose FIRST fulfillment landed in the window. We compute
    // first-fulfilled-at per step as a subquery over the entire
    // fulfillments history (not just the window), then keep only the
    // steps where that minimum falls inside the window. Joins to the
    // step + plan tables for title rendering.
    db.execute<{
      step_id: string
      step_title: string
      plan_id: string
      plan_title: string
      first_at: string
    }>(sql`
      WITH first_fulfilled AS (
        SELECT step_id, MIN(promoted_at) AS first_at
        FROM operator_step_fulfillments
        WHERE workspace_id = ${workspaceId}
        GROUP BY step_id
      )
      SELECT
        s.id        AS step_id,
        s.title     AS step_title,
        p.id        AS plan_id,
        p.title     AS plan_title,
        ff.first_at AS first_at
      FROM first_fulfilled ff
      INNER JOIN operator_plan_steps s ON s.id = ff.step_id
      INNER JOIN operator_plans p ON p.id = s.plan_id
      WHERE p.workspace_id = ${workspaceId}
        AND ff.first_at >= ${sinceIso}
        AND ff.first_at <= ${untilIso}
      ORDER BY ff.first_at ASC
      LIMIT 20
    `),
  ])

  const firstFulfilled = (
    firstFulfilledRows as unknown as {
      rows: Array<{
        step_id: string
        step_title: string
        plan_id: string
        plan_title: string
        first_at: string
      }>
    }
  ).rows

  // Re-query for the COUNT (not just the limited 20) so the recap can
  // honestly say "you newly-evidenced 47 steps this week" even when
  // the surfaced list is capped.
  const firstFulfilledCountRow = await db.execute<{ count: number }>(sql`
    WITH first_fulfilled AS (
      SELECT step_id, MIN(promoted_at) AS first_at
      FROM operator_step_fulfillments
      WHERE workspace_id = ${workspaceId}
      GROUP BY step_id
    )
    SELECT COUNT(*)::int AS count
    FROM first_fulfilled ff
    INNER JOIN operator_plan_steps s ON s.id = ff.step_id
    INNER JOIN operator_plans p ON p.id = s.plan_id
    WHERE p.workspace_id = ${workspaceId}
      AND ff.first_at >= ${sinceIso}
      AND ff.first_at <= ${untilIso}
  `)
  const firstFulfilledCount =
    (firstFulfilledCountRow as unknown as { rows: Array<{ count: number }> })
      .rows[0]?.count ?? 0

  const threadsTouchedCount =
    (threadsTouchedRow as unknown as { rows: Array<{ count: number }> }).rows[0]
      ?.count ?? 0

  return {
    window: { since: sinceIso, until: untilIso },
    sessions: {
      count: sessionRows[0]?.count ?? 0,
      threadsTouched: threadsTouchedCount,
      messagesAuthored: messagesAuthoredRow[0]?.count ?? 0,
    },
    threads: {
      importedInWindow: threadsImportedRow[0]?.count ?? 0,
      promotedInWindow: threadsPromotedRow[0]?.count ?? 0,
    },
    messages: {
      promotedInWindow: messagesPromotedRow[0]?.count ?? 0,
    },
    plans: {
      shippedInWindow: plansShippedRow[0]?.count ?? 0,
      archivedInWindow: plansArchivedRow[0]?.count ?? 0,
    },
    fulfillments: {
      totalInWindow: fulfillmentsTotalRow[0]?.count ?? 0,
      stepsFirstFulfilledCount: firstFulfilledCount,
      stepsFirstFulfilled: firstFulfilled.map((r) => ({
        stepId: r.step_id,
        stepTitle: r.step_title,
        planId: r.plan_id,
        planTitle: r.plan_title,
        firstFulfilledAt: new Date(r.first_at).toISOString(),
      })),
    },
  }
}

/**
 * Active-plan coverage snapshot — point-in-time, no time window.
 * Cheap aggregate over `operator_plan_steps.status`.
 *
 * Used by the recap view as the "where the active plan stands right
 * now" footer alongside the window-scoped metrics. Returns null if
 * the workspace has no plans.
 */
export interface ActivePlanCoverage {
  planId: string
  planTitle: string
  totalSteps: number
  open: number
  inMotion: number
  covered: number
  skipped: number
}

export async function getActivePlanCoverage(
  workspaceId: string,
  planId: string
): Promise<ActivePlanCoverage | null> {
  const db = getDb()
  const planRow = await db
    .select({ id: operatorPlans.id, title: operatorPlans.title })
    .from(operatorPlans)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.id, planId)
      )
    )
    .limit(1)
  if (planRow.length === 0) return null

  const stepRows = await db
    .select({
      status: operatorPlanSteps.status,
      count: sql<number>`count(*)::int`,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, planId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .groupBy(operatorPlanSteps.status)

  const buckets = { open: 0, "in-motion": 0, covered: 0, skipped: 0 }
  let total = 0
  for (const r of stepRows) {
    const key = r.status as keyof typeof buckets
    if (key in buckets) buckets[key] = r.count
    total += r.count
  }

  return {
    planId: planRow[0].id,
    planTitle: planRow[0].title,
    totalSteps: total,
    open: buckets.open,
    inMotion: buckets["in-motion"],
    covered: buckets.covered,
    skipped: buckets.skipped,
  }
}
