import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorInboxEvents } from "@/lib/server/db/schema"

export interface InboxEvent {
  id: string
  workspaceId: string
  factoryId: string | null
  surface: string
  upstreamId: string | null
  upstreamKind: string
  actorName: string | null
  occurredAt: string
  payload: Record<string, unknown>
  textExcerpt: string | null
  relatedWorkId: string | null
  relatedWorkLabel: string | null
  ingestedAt: string
  llmInitialLog: string | null
  llmInitialLogAt: string | null
  createdAt: string
  updatedAt: string
}

function rowToEvent(row: typeof operatorInboxEvents.$inferSelect): InboxEvent {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    factoryId: row.factoryId ?? null,
    surface: row.surface,
    upstreamId: row.upstreamId ?? null,
    upstreamKind: row.upstreamKind,
    actorName: row.actorName ?? null,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payloadJson ?? {},
    textExcerpt: row.textExcerpt ?? null,
    relatedWorkId: row.relatedWorkId ?? null,
    relatedWorkLabel: row.relatedWorkLabel ?? null,
    ingestedAt: row.ingestedAt.toISOString(),
    llmInitialLog: row.llmInitialLog ?? null,
    llmInitialLogAt: row.llmInitialLogAt
      ? row.llmInitialLogAt.toISOString()
      : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export interface IngestInboxEventInput {
  workspaceId: string
  factoryId?: string
  surface: string
  upstreamId?: string
  upstreamKind: string
  actorName?: string
  occurredAt: Date
  payload?: Record<string, unknown>
  textExcerpt?: string
  relatedWorkId?: string
  relatedWorkLabel?: string
}

function newId(): string {
  return `inbox-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

/**
 * Idempotent on (workspaceId, surface, upstreamId) when upstreamId is
 * provided — re-ingesting the same upstream id updates payload/excerpt
 * but preserves any LLM initial log already attached.
 */
export async function ingestInboxEvent(
  input: IngestInboxEventInput
): Promise<InboxEvent> {
  const db = getDb()
  const now = new Date()

  if (input.upstreamId) {
    const existing = await db
      .select()
      .from(operatorInboxEvents)
      .where(
        and(
          eq(operatorInboxEvents.workspaceId, input.workspaceId),
          eq(operatorInboxEvents.surface, input.surface),
          eq(operatorInboxEvents.upstreamId, input.upstreamId)
        )
      )
      .limit(1)
    if (existing[0]) {
      await db
        .update(operatorInboxEvents)
        .set({
          factoryId: input.factoryId ?? existing[0].factoryId ?? null,
          actorName: input.actorName ?? existing[0].actorName ?? null,
          occurredAt: input.occurredAt,
          payloadJson: input.payload ?? existing[0].payloadJson ?? {},
          textExcerpt: input.textExcerpt ?? existing[0].textExcerpt ?? null,
          relatedWorkId:
            input.relatedWorkId ?? existing[0].relatedWorkId ?? null,
          relatedWorkLabel:
            input.relatedWorkLabel ??
            existing[0].relatedWorkLabel ??
            null,
          updatedAt: now,
        })
        .where(eq(operatorInboxEvents.id, existing[0].id))
      const fresh = await getInboxEvent(input.workspaceId, existing[0].id)
      if (!fresh) throw new Error("ingestInboxEvent: did not read back")
      return fresh
    }
  }

  const id = newId()
  await db.insert(operatorInboxEvents).values({
    id,
    workspaceId: input.workspaceId,
    factoryId: input.factoryId ?? null,
    surface: input.surface,
    upstreamId: input.upstreamId ?? null,
    upstreamKind: input.upstreamKind,
    actorName: input.actorName ?? null,
    occurredAt: input.occurredAt,
    payloadJson: input.payload ?? {},
    textExcerpt: input.textExcerpt ?? null,
    relatedWorkId: input.relatedWorkId ?? null,
    relatedWorkLabel: input.relatedWorkLabel ?? null,
    ingestedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  const fresh = await getInboxEvent(input.workspaceId, id)
  if (!fresh) throw new Error("ingestInboxEvent: did not read back")
  return fresh
}

export async function getInboxEvent(
  workspaceId: string,
  id: string
): Promise<InboxEvent | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorInboxEvents)
    .where(
      and(
        eq(operatorInboxEvents.workspaceId, workspaceId),
        eq(operatorInboxEvents.id, id)
      )
    )
    .limit(1)
  return rows[0] ? rowToEvent(rows[0]) : null
}

export async function listInboxEvents(
  workspaceId: string,
  opts?: { factoryId?: string; surface?: string; limit?: number }
): Promise<InboxEvent[]> {
  const db = getDb()
  const conditions = [eq(operatorInboxEvents.workspaceId, workspaceId)]
  if (opts?.factoryId) {
    conditions.push(eq(operatorInboxEvents.factoryId, opts.factoryId))
  }
  if (opts?.surface) {
    conditions.push(eq(operatorInboxEvents.surface, opts.surface))
  }
  const rows = await db
    .select()
    .from(operatorInboxEvents)
    .where(and(...conditions))
    .orderBy(desc(operatorInboxEvents.occurredAt))
    .limit(opts?.limit ?? 100)
  return rows.map(rowToEvent)
}

/**
 * Set the LLM's first-pass read of this event. One-shot from the LLM
 * side: only writes when llm_initial_log is currently null.
 */
export async function setInitialLogIfEmpty(
  workspaceId: string,
  id: string,
  log: string
): Promise<InboxEvent | null> {
  const db = getDb()
  const now = new Date()
  const existing = await getInboxEvent(workspaceId, id)
  if (!existing) return null
  if (existing.llmInitialLog) return existing
  await db
    .update(operatorInboxEvents)
    .set({
      llmInitialLog: log.slice(0, 4096),
      llmInitialLogAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(operatorInboxEvents.workspaceId, workspaceId),
        eq(operatorInboxEvents.id, id)
      )
    )
  return getInboxEvent(workspaceId, id)
}
