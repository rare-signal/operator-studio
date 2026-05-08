import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorOutboxMessages } from "@/lib/server/db/schema"
import {
  approveOutbound,
  type OutboundSurface,
} from "@/lib/server/agent-bridge/outbound-mode"
import {
  hashOutboundPayload,
  type OutboundIntent,
} from "@/lib/operator-studio/outbound-gate"
import { addWorkItemComment } from "@/lib/operator-studio/clients/ado-writer"

export type OutboxState =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "sent"
  | "rejected"
  | "expired"

export interface OutboxRow {
  id: string
  workspaceId: string
  factoryId: string | null
  surface: OutboundSurface
  action: string
  targetId: string
  targetLabel: string | null
  audience: string[]
  payload: Record<string, unknown>
  renderedText: string
  renderedTextEditedBy: string | null
  rationale: string | null
  state: OutboxState
  llmRunId: string | null
  sourceInboxEventIds: string[]
  relatedPlanStepId: string | null
  proposedAt: string
  decidedAt: string | null
  sentAt: string | null
  payloadHash: string | null
  sendResult: Record<string, unknown> | null
  sendError: string | null
  createdAt: string
  updatedAt: string
}

function rowToOutbox(row: typeof operatorOutboxMessages.$inferSelect): OutboxRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    factoryId: row.factoryId ?? null,
    surface: row.surface as OutboundSurface,
    action: row.action,
    targetId: row.targetId,
    targetLabel: row.targetLabel ?? null,
    audience: row.audience ?? [],
    payload: row.payloadJson ?? {},
    renderedText: row.renderedText,
    renderedTextEditedBy: row.renderedTextEditedBy ?? null,
    rationale: row.rationale ?? null,
    state: row.state as OutboxState,
    llmRunId: row.llmRunId ?? null,
    sourceInboxEventIds: row.sourceInboxEventIds ?? [],
    relatedPlanStepId: row.relatedPlanStepId ?? null,
    proposedAt: row.proposedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    payloadHash: row.payloadHash ?? null,
    sendResult: row.sendResult ?? null,
    sendError: row.sendError ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export interface CreateOutboxInput {
  workspaceId: string
  surface: OutboundSurface
  action: string
  targetId: string
  targetLabel?: string
  audience?: string[]
  payload: Record<string, unknown>
  renderedText: string
  rationale?: string
  llmRunId?: string
  sourceInboxEventIds?: string[]
  relatedPlanStepId?: string
  factoryId?: string
}

function newId(): string {
  return `outbox-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

export async function createOutbox(
  input: CreateOutboxInput
): Promise<OutboxRow> {
  const db = getDb()
  const now = new Date()
  const id = newId()
  await db.insert(operatorOutboxMessages).values({
    id,
    workspaceId: input.workspaceId,
    factoryId: input.factoryId ?? null,
    surface: input.surface,
    action: input.action,
    targetId: input.targetId,
    targetLabel: input.targetLabel ?? null,
    audience: input.audience ?? [],
    payloadJson: input.payload,
    renderedText: input.renderedText,
    renderedTextEditedBy: null,
    rationale: input.rationale ?? null,
    state: "awaiting_approval",
    llmRunId: input.llmRunId ?? null,
    sourceInboxEventIds: input.sourceInboxEventIds ?? [],
    relatedPlanStepId: input.relatedPlanStepId ?? null,
    proposedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  const row = await getOutbox(input.workspaceId, id)
  if (!row) throw new Error(`createOutbox: ${id} did not read back`)
  return row
}

export async function getOutbox(
  workspaceId: string,
  id: string
): Promise<OutboxRow | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorOutboxMessages)
    .where(
      and(
        eq(operatorOutboxMessages.workspaceId, workspaceId),
        eq(operatorOutboxMessages.id, id)
      )
    )
    .limit(1)
  return rows[0] ? rowToOutbox(rows[0]) : null
}

export async function listOutbox(
  workspaceId: string,
  opts?: { state?: OutboxState; limit?: number }
): Promise<OutboxRow[]> {
  const db = getDb()
  const conditions = [eq(operatorOutboxMessages.workspaceId, workspaceId)]
  if (opts?.state) {
    conditions.push(eq(operatorOutboxMessages.state, opts.state))
  }
  const rows = await db
    .select()
    .from(operatorOutboxMessages)
    .where(and(...conditions))
    .orderBy(desc(operatorOutboxMessages.proposedAt))
    .limit(opts?.limit ?? 100)
  return rows.map(rowToOutbox)
}

export interface EditOutboxInput {
  workspaceId: string
  id: string
  renderedText?: string
  payload?: Record<string, unknown>
  editedBy: string
}

export async function editOutbox(
  input: EditOutboxInput
): Promise<OutboxRow | null> {
  const db = getDb()
  const now = new Date()
  const updates: Partial<typeof operatorOutboxMessages.$inferInsert> = {
    updatedAt: now,
    renderedTextEditedBy: input.editedBy,
  }
  if (input.renderedText !== undefined) {
    updates.renderedText = input.renderedText
  }
  if (input.payload !== undefined) {
    updates.payloadJson = input.payload
  }
  await db
    .update(operatorOutboxMessages)
    .set(updates)
    .where(
      and(
        eq(operatorOutboxMessages.workspaceId, input.workspaceId),
        eq(operatorOutboxMessages.id, input.id)
      )
    )
  return getOutbox(input.workspaceId, input.id)
}

export async function rejectOutbox(
  workspaceId: string,
  id: string,
  rejectedBy: string,
  reason?: string
): Promise<OutboxRow | null> {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorOutboxMessages)
    .set({
      state: "rejected",
      decidedAt: now,
      updatedAt: now,
      sendError: reason ?? `Rejected by ${rejectedBy}`,
    })
    .where(
      and(
        eq(operatorOutboxMessages.workspaceId, workspaceId),
        eq(operatorOutboxMessages.id, id)
      )
    )
  return getOutbox(workspaceId, id)
}

export interface ApproveAndSendInput {
  workspaceId: string
  id: string
  pin: string
  durationMs?: number
}

export interface ApproveAndSendResult {
  ok: boolean
  state: OutboxState
  error?: string
  sendResult?: Record<string, unknown>
}

/**
 * Single user-action: arm a per-row approval with the current
 * payload's hash AND immediately invoke the writer.
 *
 * The gate (`assertOutboundArmed` inside the writer) consumes the
 * approval at the writer's first line — so even though we just
 * armed it, the writer still does the real check on the bytes
 * about to leave the machine.
 */
export async function approveAndSendOutbox(
  input: ApproveAndSendInput
): Promise<ApproveAndSendResult> {
  const db = getDb()
  const row = await getOutbox(input.workspaceId, input.id)
  if (!row) return { ok: false, state: "draft", error: "outbox row not found" }
  if (row.state === "sent") {
    return { ok: false, state: row.state, error: "already sent" }
  }
  if (row.state === "rejected") {
    return { ok: false, state: row.state, error: "rejected" }
  }

  const payloadHash = hashOutboundPayload(row.payload)

  const approval = approveOutbound({
    pin: input.pin,
    outboxRowId: row.id,
    payloadHash,
    surface: row.surface,
    action: row.action,
    targetId: row.targetId,
    durationMs: input.durationMs,
  })
  if (!approval.ok) {
    return {
      ok: false,
      state: row.state,
      error:
        approval.reason === "bad-pin"
          ? "Incorrect PIN."
          : "Requested duration exceeds the server cap.",
    }
  }

  // Persist the hash + state transition before invoking the writer.
  const now = new Date()
  await db
    .update(operatorOutboxMessages)
    .set({
      state: "approved",
      decidedAt: now,
      updatedAt: now,
      payloadHash,
    })
    .where(
      and(
        eq(operatorOutboxMessages.workspaceId, input.workspaceId),
        eq(operatorOutboxMessages.id, input.id)
      )
    )

  // Dispatch to the right writer based on (surface, action).
  const intent = buildIntent(row, payloadHash)
  try {
    const sendResult = await dispatch(intent, row)
    await db
      .update(operatorOutboxMessages)
      .set({
        state: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
        sendResult,
        sendError: null,
      })
      .where(
        and(
          eq(operatorOutboxMessages.workspaceId, input.workspaceId),
          eq(operatorOutboxMessages.id, input.id)
        )
      )
    return { ok: true, state: "sent", sendResult }
  } catch (err) {
    const errorText = err instanceof Error ? err.message : String(err)
    await db
      .update(operatorOutboxMessages)
      .set({
        state: "awaiting_approval",
        sendError: errorText,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operatorOutboxMessages.workspaceId, input.workspaceId),
          eq(operatorOutboxMessages.id, input.id)
        )
      )
    return { ok: false, state: "awaiting_approval", error: errorText }
  }
}

function buildIntent(row: OutboxRow, payloadHash: string): OutboundIntent {
  return {
    surface: row.surface,
    action: row.action,
    targetId: row.targetId,
    payload: row.payload,
    outboxRowId: row.id,
    rationale: row.rationale ?? "",
    // payloadHash is recomputed inside the gate from `payload` — we
    // don't pass it through, but we use this same value to verify
    // approval-time and send-time match.
    ...{ _payloadHash: payloadHash } /* documentation only */,
  } as OutboundIntent
}

async function dispatch(
  intent: OutboundIntent,
  row: OutboxRow
): Promise<Record<string, unknown>> {
  if (intent.surface === "ado" && intent.action === "ado.addComment") {
    const text = (row.payload.text as string) ?? ""
    const workItemId = Number(intent.targetId)
    if (!Number.isFinite(workItemId) || workItemId <= 0) {
      throw new Error(`Invalid ADO work-item id: ${intent.targetId}`)
    }
    const result = await addWorkItemComment({
      workItemId,
      text,
      outboxRowId: row.id,
      rationale: row.rationale ?? "",
    })
    return result as unknown as Record<string, unknown>
  }
  throw new Error(
    `No writer registered for surface=${intent.surface} action=${intent.action}.`
  )
}

export async function getOutboxCounts(
  workspaceId: string
): Promise<Record<OutboxState, number>> {
  const db = getDb()
  const rows = await db
    .select({
      state: operatorOutboxMessages.state,
      count: sql<number>`COUNT(*)`,
    })
    .from(operatorOutboxMessages)
    .where(eq(operatorOutboxMessages.workspaceId, workspaceId))
    .groupBy(operatorOutboxMessages.state)
  const counts: Record<OutboxState, number> = {
    draft: 0,
    awaiting_approval: 0,
    approved: 0,
    sent: 0,
    rejected: 0,
    expired: 0,
  }
  for (const r of rows) {
    counts[r.state as OutboxState] = Number(r.count)
  }
  return counts
}
