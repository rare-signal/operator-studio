import { and, desc, eq, isNotNull, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorChatMessages,
  operatorChatSessions,
  operatorImportRuns,
  operatorThreadMessages,
  operatorThreadSummaries,
  operatorThreads,
} from "@/lib/server/db/schema"
import type {
  OperatorChatMessage,
  OperatorChatSession,
  OperatorDashboardStats,
  OperatorImportRun,
  OperatorReviewState,
  OperatorSourceApp,
  OperatorThread,
  OperatorThreadMessage,
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
  workspaceId: string
): Promise<OperatorThread[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.visibleInStudio, 1)
      )
    )
    .orderBy(desc(operatorThreads.importedAt))
  return rows.map(toThread)
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

// ─── Thread mutations ────────────────────────────────────────────────────────

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
  }>
): Promise<OperatorThread> {
  const parent = await getThreadById(workspaceId, parentThreadId)
  if (!parent) throw new Error("Parent thread not found")

  const db = getDb()
  const now = new Date()
  const forkId = `thread-fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // Decide which messages populate the fork. Upstream re-parse (if provided)
  // wins; otherwise copy the parent's stored messages as the diverge base.
  let forkMessages: Array<{ role: string; content: string; createdAt: Date }>
  if (sourceMessages && sourceMessages.length > 0) {
    forkMessages = sourceMessages.map((m) => ({
      role: m.role,
      content: m.content,
      createdAt: m.timestamp ? new Date(m.timestamp) : now,
    }))
  } else {
    const parentMessages = await getThreadMessages(workspaceId, parentThreadId)
    forkMessages = parentMessages.map((m) => ({
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

export async function deleteMessage(
  workspaceId: string,
  messageId: string,
  source: "thread" | "chat" = "thread"
) {
  const db = getDb()
  const table =
    source === "chat" ? operatorChatMessages : operatorThreadMessages
  await db
    .delete(table)
    .where(and(eq(table.id, messageId), eq(table.workspaceId, workspaceId)))
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
  const [threads, runs] = await Promise.all([
    db
      .select()
      .from(operatorThreads)
      .where(
        and(
          eq(operatorThreads.workspaceId, workspaceId),
          eq(operatorThreads.visibleInStudio, 1)
        )
      ),
    db
      .select()
      .from(operatorImportRuns)
      .where(eq(operatorImportRuns.workspaceId, workspaceId))
      .orderBy(desc(operatorImportRuns.createdAt))
      .limit(50),
  ])

  const promoted = threads.filter((t) => t.reviewState === "promoted").length
  const inReview = threads.filter((t) => t.reviewState === "in-review").length
  const imported = threads.filter((t) => t.reviewState === "imported").length

  return {
    totalThreads: threads.length,
    promoted,
    inReview,
    imported,
    recentImportRuns: runs.length,
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
    rank: Number(row.rank) || 0,
    snippet: row.snippet,
  }))
}
