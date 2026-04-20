import { and, desc, eq, isNotNull } from "drizzle-orm"

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

export async function forkThread(
  workspaceId: string,
  parentThreadId: string,
  forkedBy: string
): Promise<OperatorThread> {
  const parent = await getThreadById(workspaceId, parentThreadId)
  if (!parent) throw new Error("Parent thread not found")

  const db = getDb()
  const now = new Date()
  const forkId = `thread-fork-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const row = {
    id: forkId,
    workspaceId,
    sourceApp: parent.sourceApp,
    sourceThreadKey: parent.sourceThreadKey,
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
    sourcePayloadJson: null,
    parentThreadId,
    promotedFromId: null,
    pulledFromId: null,
    visibleInStudio: 1,
    messageCount: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(operatorThreads).values(row)
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
