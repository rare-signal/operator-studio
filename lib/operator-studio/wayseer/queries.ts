import "server-only"

import { and, desc, eq, inArray, like } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorThreadEnrichments } from "@/lib/server/db/schema"

import type { ThreadAnalysis } from "./contracts/thread-analysis"
import type { ThreadRollup } from "./contracts/thread-rollup"

export type EnrichmentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"

/** The enrichments table backs every Wayseer contract. The shape of
 *  `resultPayload` is governed by `contractVersion`. Callers that
 *  know which contract they want (e.g. the rollup endpoint) should
 *  filter by version and assert the payload type. */
export type EnrichmentPayload = ThreadAnalysis | ThreadRollup

export interface ThreadEnrichmentRow<
  T extends EnrichmentPayload = EnrichmentPayload,
> {
  id: string
  workspaceId: string
  threadId: string
  status: EnrichmentStatus
  contractVersion: string
  resultPayload: T | null
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

type Row = typeof operatorThreadEnrichments.$inferSelect

function rowToEnrichment<T extends EnrichmentPayload>(
  row: Row
): ThreadEnrichmentRow<T> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    threadId: row.threadId,
    status: row.status as EnrichmentStatus,
    contractVersion: row.contractVersion,
    resultPayload: (row.resultPayload as T | null) ?? null,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    latencyMs: row.latencyMs,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  }
}

/**
 * Latest enrichment for a thread, regardless of status. We surface the
 * most-recent row so the UI shows running/failed states too — not just
 * completed ones. Callers that want a successful payload only should
 * filter on `status === "completed"`.
 */
export async function getLatestEnrichmentForThread(
  workspaceId: string,
  threadId: string
): Promise<ThreadEnrichmentRow | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadEnrichments)
    .where(
      and(
        eq(operatorThreadEnrichments.workspaceId, workspaceId),
        eq(operatorThreadEnrichments.threadId, threadId)
      )
    )
    .orderBy(desc(operatorThreadEnrichments.createdAt))
    .limit(1)

  return rows.length > 0 ? rowToEnrichment(rows[0]) : null
}

/**
 * Latest *completed* enrichment for a thread. Used by sidebar
 * enrichment readers that don't care about in-flight runs.
 */
export async function getLatestCompletedEnrichmentForThread(
  workspaceId: string,
  threadId: string
): Promise<ThreadEnrichmentRow | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadEnrichments)
    .where(
      and(
        eq(operatorThreadEnrichments.workspaceId, workspaceId),
        eq(operatorThreadEnrichments.threadId, threadId),
        eq(operatorThreadEnrichments.status, "completed")
      )
    )
    .orderBy(desc(operatorThreadEnrichments.completedAt))
    .limit(1)

  return rows.length > 0 ? rowToEnrichment(rows[0]) : null
}

interface CreateEnrichmentInput {
  id: string
  workspaceId: string
  threadId: string
  contractVersion: string
}

export async function createEnrichmentRunning(
  input: CreateEnrichmentInput
): Promise<ThreadEnrichmentRow> {
  const db = getDb()
  const now = new Date()
  const [row] = await db
    .insert(operatorThreadEnrichments)
    .values({
      id: input.id,
      workspaceId: input.workspaceId,
      threadId: input.threadId,
      status: "running",
      contractVersion: input.contractVersion,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return rowToEnrichment(row)
}

interface CompleteEnrichmentInput {
  id: string
  resultPayload: EnrichmentPayload
  promptTokens: number | null
  completionTokens: number | null
  latencyMs: number
}

export async function completeEnrichment(
  input: CompleteEnrichmentInput
): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorThreadEnrichments)
    .set({
      status: "completed",
      resultPayload: input.resultPayload,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      latencyMs: input.latencyMs,
      completedAt: now,
      updatedAt: now,
      errorMessage: null,
    })
    .where(eq(operatorThreadEnrichments.id, input.id))
}

/**
 * Batch read of the latest *completed* enrichment for each of the
 * given threadIds. Used by the sidebar enrichment one-liner — the
 * rail loads N thread rows and asks Wayseer for any completed
 * analyses to surface a one-line "what got done" hint per row.
 *
 * Returns a map keyed by threadId. Threads without a completed
 * enrichment are simply absent from the map. The current
 * implementation does one window-function query per call; if the
 * thread list grows past ~50 we'll want a more efficient grouped
 * query, but the rail currently caps at 25.
 */
export async function getLatestCompletedEnrichmentsForThreads(
  workspaceId: string,
  threadIds: string[]
): Promise<Map<string, ThreadEnrichmentRow>> {
  const result = new Map<string, ThreadEnrichmentRow>()
  if (threadIds.length === 0) return result

  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadEnrichments)
    .where(
      and(
        eq(operatorThreadEnrichments.workspaceId, workspaceId),
        eq(operatorThreadEnrichments.status, "completed"),
        inArray(operatorThreadEnrichments.threadId, threadIds)
      )
    )
    .orderBy(desc(operatorThreadEnrichments.completedAt))

  // Take the first (most-recent-completed) row we see per threadId.
  for (const row of rows) {
    if (!result.has(row.threadId)) {
      result.set(row.threadId, rowToEnrichment(row))
    }
  }
  return result
}

/**
 * Latest enrichment row whose contract version matches the given
 * prefix. Used by per-contract endpoints (e.g. the rollup endpoint
 * filters with `thread-rollup@`) to avoid returning rows produced by
 * a sibling contract that shares the same enrichments table.
 */
export async function getLatestEnrichmentForThreadByContractPrefix<
  T extends EnrichmentPayload,
>(
  workspaceId: string,
  threadId: string,
  contractPrefix: string
): Promise<ThreadEnrichmentRow<T> | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadEnrichments)
    .where(
      and(
        eq(operatorThreadEnrichments.workspaceId, workspaceId),
        eq(operatorThreadEnrichments.threadId, threadId),
        like(operatorThreadEnrichments.contractVersion, `${contractPrefix}%`)
      )
    )
    .orderBy(desc(operatorThreadEnrichments.createdAt))
    .limit(1)
  return rows.length > 0 ? rowToEnrichment<T>(rows[0]) : null
}

export async function failEnrichment(
  id: string,
  errorMessage: string
): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorThreadEnrichments)
    .set({
      status: "failed",
      errorMessage: errorMessage.slice(0, 2000),
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(operatorThreadEnrichments.id, id))
}
