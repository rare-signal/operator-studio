import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorPlanSteps, operatorReviewItems } from "@/lib/server/db/schema"

/**
 * David-only review bucket.
 *
 * Interstitial layer between agent inference (or any upstream signal)
 * and anything team-visible. Raw conclusions are advisory until David
 * promotes, edits, rejects, snoozes, or imports them.
 *
 * Generic over lanes — TeleGento, Valikharlia, ADO, Teams, agent runs
 * all funnel through `sourceType`. Do not specialize this module per
 * lane.
 */

export type ReviewItemSourceType =
  | "ado"
  | "teams"
  | "agent"
  | "known_issue"
  | "product_narrative"
  | "deployment"
  | "signal_intake"
  | (string & {})

export type ReviewItemVisibility = "david_only" | "promoted"

export type ReviewItemState =
  | "raw"
  | "summarized"
  | "candidate"
  | "imported"
  | "promoted"
  | "rejected"
  | "snoozed"

export interface ReviewItem {
  id: string
  workspaceId: string
  sourceType: ReviewItemSourceType
  sourceLabel: string | null
  sourceId: string | null
  sourceUrl: string | null
  title: string
  summary: string
  rawText: string | null
  rawPayload: Record<string, unknown> | null
  proposedAction: string | null
  relatedPlanStepId: string | null
  visibility: ReviewItemVisibility
  state: ReviewItemState
  confidence: number | null
  rationale: string | null
  agentRunId: string | null
  tags: string[]
  snoozedUntil: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

function toItem(row: typeof operatorReviewItems.$inferSelect): ReviewItem {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceType: row.sourceType,
    sourceLabel: row.sourceLabel,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    summary: row.summary ?? "",
    rawText: row.rawText,
    rawPayload: (row.rawPayload as Record<string, unknown> | null) ?? null,
    proposedAction: row.proposedAction,
    relatedPlanStepId: row.relatedPlanStepId,
    visibility: (row.visibility as ReviewItemVisibility) ?? "david_only",
    state: (row.state as ReviewItemState) ?? "raw",
    confidence:
      typeof row.confidence === "number" ? row.confidence : null,
    rationale: row.rationale,
    agentRunId: row.agentRunId,
    tags: (row.tags as string[]) ?? [],
    snoozedUntil: row.snoozedUntil ? row.snoozedUntil.toISOString() : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function genId(): string {
  return `rev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(
    36
  )}`
}

const OPEN_STATES: ReviewItemState[] = ["raw", "summarized", "candidate"]

export interface ListReviewItemsOptions {
  /** When set, only items in these states. Defaults to the open set. */
  states?: ReviewItemState[]
  sourceType?: ReviewItemSourceType
  /** When true, include rejected/imported/promoted/snoozed items too. */
  includeClosed?: boolean
  limit?: number
}

export async function listReviewItems(
  workspaceId: string,
  opts: ListReviewItemsOptions = {}
): Promise<ReviewItem[]> {
  const db = getDb()
  const states = opts.states
    ? opts.states
    : opts.includeClosed
      ? null
      : OPEN_STATES

  const conditions = [eq(operatorReviewItems.workspaceId, workspaceId)]
  if (states) {
    conditions.push(
      sql`${operatorReviewItems.state} = ANY(${sql.raw(
        `ARRAY[${states.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}]::text[]`
      )})`
    )
  }
  if (opts.sourceType) {
    conditions.push(eq(operatorReviewItems.sourceType, opts.sourceType))
  }

  const rows = await db
    .select()
    .from(operatorReviewItems)
    .where(and(...conditions))
    .orderBy(desc(operatorReviewItems.createdAt))
    .limit(opts.limit ?? 200)

  return rows.map(toItem)
}

export async function getReviewItemById(
  workspaceId: string,
  id: string
): Promise<ReviewItem | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorReviewItems)
    .where(
      and(
        eq(operatorReviewItems.workspaceId, workspaceId),
        eq(operatorReviewItems.id, id)
      )
    )
    .limit(1)
  return rows[0] ? toItem(rows[0]) : null
}

export interface CreateReviewItemInput {
  sourceType: ReviewItemSourceType
  sourceLabel?: string | null
  sourceId?: string | null
  sourceUrl?: string | null
  title: string
  summary?: string
  rawText?: string | null
  rawPayload?: Record<string, unknown> | null
  proposedAction?: string | null
  relatedPlanStepId?: string | null
  visibility?: ReviewItemVisibility
  state?: ReviewItemState
  confidence?: number | null
  rationale?: string | null
  agentRunId?: string | null
  tags?: string[]
}

/**
 * Create or upsert a review item. Re-imports of the same upstream
 * (sourceType + sourceId) update the existing row in place rather than
 * creating duplicates, so polling sources like ADO can call this on
 * every refresh without flooding the bucket.
 */
export async function createReviewItem(
  workspaceId: string,
  input: CreateReviewItemInput
): Promise<ReviewItem> {
  const db = getDb()
  const now = new Date()

  if (input.sourceId) {
    const existing = await db
      .select()
      .from(operatorReviewItems)
      .where(
        and(
          eq(operatorReviewItems.workspaceId, workspaceId),
          eq(operatorReviewItems.sourceType, input.sourceType),
          eq(operatorReviewItems.sourceId, input.sourceId)
        )
      )
      .limit(1)
    if (existing[0]) {
      await db
        .update(operatorReviewItems)
        .set({
          title: input.title,
          summary: input.summary ?? existing[0].summary,
          rawText: input.rawText ?? existing[0].rawText,
          rawPayload:
            input.rawPayload === undefined
              ? existing[0].rawPayload
              : input.rawPayload,
          sourceLabel: input.sourceLabel ?? existing[0].sourceLabel,
          sourceUrl: input.sourceUrl ?? existing[0].sourceUrl,
          proposedAction:
            input.proposedAction ?? existing[0].proposedAction,
          tags: input.tags ?? (existing[0].tags as string[]),
          updatedAt: now,
        })
        .where(eq(operatorReviewItems.id, existing[0].id))
      const refreshed = await getReviewItemById(workspaceId, existing[0].id)
      if (refreshed) return refreshed
    }
  }

  const row = {
    id: genId(),
    workspaceId,
    sourceType: input.sourceType,
    sourceLabel: input.sourceLabel ?? null,
    sourceId: input.sourceId ?? null,
    sourceUrl: input.sourceUrl ?? null,
    title: input.title,
    summary: input.summary ?? "",
    rawText: input.rawText ?? null,
    rawPayload: input.rawPayload ?? null,
    proposedAction: input.proposedAction ?? null,
    relatedPlanStepId: input.relatedPlanStepId ?? null,
    visibility: input.visibility ?? "david_only",
    state: input.state ?? "raw",
    confidence:
      typeof input.confidence === "number" ? input.confidence : null,
    rationale: input.rationale ?? null,
    agentRunId: input.agentRunId ?? null,
    tags: input.tags ?? [],
    snoozedUntil: null,
    decidedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(operatorReviewItems).values(row)
  return toItem(row as typeof operatorReviewItems.$inferSelect)
}

export interface UpdateReviewItemInput {
  title?: string
  summary?: string
  rawText?: string | null
  proposedAction?: string | null
  rationale?: string | null
  tags?: string[]
}

export async function updateReviewItem(
  workspaceId: string,
  id: string,
  patch: UpdateReviewItemInput
): Promise<ReviewItem | null> {
  const db = getDb()
  const now = new Date()
  const set: Record<string, unknown> = { updatedAt: now }
  if (patch.title !== undefined) set.title = patch.title
  if (patch.summary !== undefined) set.summary = patch.summary
  if (patch.rawText !== undefined) set.rawText = patch.rawText
  if (patch.proposedAction !== undefined)
    set.proposedAction = patch.proposedAction
  if (patch.rationale !== undefined) set.rationale = patch.rationale
  if (patch.tags !== undefined) set.tags = patch.tags
  // If the operator edits the body, bump state from raw → summarized
  // so the bucket can show "human-touched" rows distinctly from fresh
  // agent dumps. Only auto-bump when the row was raw.
  if (
    patch.summary !== undefined ||
    patch.title !== undefined ||
    patch.proposedAction !== undefined
  ) {
    set.state = sql`CASE WHEN ${operatorReviewItems.state} = 'raw' THEN 'summarized' ELSE ${operatorReviewItems.state} END`
  }
  await db
    .update(operatorReviewItems)
    .set(set)
    .where(
      and(
        eq(operatorReviewItems.workspaceId, workspaceId),
        eq(operatorReviewItems.id, id)
      )
    )
  return getReviewItemById(workspaceId, id)
}

export type DecisionAction = "promote" | "reject" | "snooze"

export async function decideReviewItem(
  workspaceId: string,
  id: string,
  action: DecisionAction,
  opts: { snoozeUntil?: string } = {}
): Promise<ReviewItem | null> {
  const db = getDb()
  const now = new Date()
  const set: Record<string, unknown> = { updatedAt: now, decidedAt: now }
  if (action === "promote") {
    set.state = "promoted"
    set.visibility = "promoted"
  } else if (action === "reject") {
    set.state = "rejected"
  } else if (action === "snooze") {
    set.state = "snoozed"
    set.snoozedUntil = opts.snoozeUntil ? new Date(opts.snoozeUntil) : null
  }
  await db
    .update(operatorReviewItems)
    .set(set)
    .where(
      and(
        eq(operatorReviewItems.workspaceId, workspaceId),
        eq(operatorReviewItems.id, id)
      )
    )
  return getReviewItemById(workspaceId, id)
}

/**
 * Materialize the review item as a child plan step under `planId`.
 * The review item itself flips to state=imported and links back to
 * the new step via relatedPlanStepId. We don't delete the review row
 * — the bucket keeps a permanent audit trail of what came in and how
 * it was disposed.
 */
export async function importReviewItemAsPlanStep(
  workspaceId: string,
  id: string,
  opts: { planId: string; parentStepId?: string | null }
): Promise<{ item: ReviewItem; stepId: string } | null> {
  const db = getDb()
  const item = await getReviewItemById(workspaceId, id)
  if (!item) return null

  const maxOrderRow = await db
    .select({
      max: sql<number>`COALESCE(MAX(${operatorPlanSteps.stepOrder}), -1)`,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, opts.planId)
      )
    )
  const stepOrder = (maxOrderRow[0]?.max ?? -1) + 1

  const stepId = `step-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
  const description = [item.summary, item.rationale, item.sourceUrl]
    .filter((s) => s && s.length > 0)
    .join("\n\n")
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(operatorPlanSteps).values({
      id: stepId,
      planId: opts.planId,
      workspaceId,
      title: item.title || "(untitled)",
      description: description || null,
      stepOrder,
      status: "open",
      parentStepId: opts.parentStepId ?? null,
      positionX: null,
      positionY: null,
      createdAt: now,
      updatedAt: now,
    })
    await tx
      .update(operatorReviewItems)
      .set({
        state: "imported",
        relatedPlanStepId: stepId,
        decidedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(operatorReviewItems.workspaceId, workspaceId),
          eq(operatorReviewItems.id, id)
        )
      )
  })
  const refreshed = await getReviewItemById(workspaceId, id)
  return refreshed ? { item: refreshed, stepId } : null
}
