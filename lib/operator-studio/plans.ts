/**
 * Plan queries — CRUD, active-plan resolution, pin/state transitions, and step
 * mutations.
 *
 * Plans are durable units of intent. A plan can span many work sessions. See
 * `drizzle/0007_session_plans.sql` for the storage shape.
 *
 * Active-plan resolution (`getActivePlan`) is the brain of the sidebar
 * and every /2/v2 loader. Three deterministic rules:
 *
 *   1. Most-recently-updated pinned plan in "active" state → that's it.
 *   2. Else, current session's plan_id → that's it.
 *   3. Else, auto-create a blank "drafting" plan, attach the current
 *      session to it, return it.
 *
 * Rule 3 guarantees Today / Plan / Brief / Inbox / Pulse never show
 * "nothing here yet" once a session is in flight — you always have a
 * plan to edit.
 */

import "server-only"

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorPlans,
  operatorPlanSteps,
  operatorSessions,
} from "@/lib/server/db/schema"

import type {
  OperatorPlanStep,
  OperatorPlanState,
  OperatorSessionPlan,
} from "./types"

// ─── Mappers ───────────────────────────────────────────────────────────────

function toStep(
  row: typeof operatorPlanSteps.$inferSelect
): OperatorPlanStep {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    order: row.stepOrder,
    status: (row.status as OperatorPlanStep["status"]) ?? "open",
    parentStepId: row.parentStepId ?? null,
    positionX: row.positionX ?? null,
    positionY: row.positionY ?? null,
    coverImageUrl: row.coverImageUrl ?? null,
  }
}

function toPlan(
  row: typeof operatorPlans.$inferSelect,
  steps: OperatorPlanStep[]
): OperatorSessionPlan {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    goal: row.goal,
    outcome: row.outcome,
    state: (row.state as OperatorPlanState) ?? "drafting",
    pinned: row.pinned === 1,
    ownerName: row.ownerName,
    createdBy: row.createdBy,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    steps,
  }
}

async function loadStepsFor(
  planIds: string[]
): Promise<Map<string, OperatorPlanStep[]>> {
  if (planIds.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorPlanSteps)
    .where(
      and(
        inArray(operatorPlanSteps.planId, planIds),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .orderBy(asc(operatorPlanSteps.stepOrder))
  const out = new Map<string, OperatorPlanStep[]>()
  for (const r of rows) {
    const bucket = out.get(r.planId) ?? []
    bucket.push(toStep(r))
    out.set(r.planId, bucket)
  }
  return out
}

// ─── Reads ─────────────────────────────────────────────────────────────────

export async function getPlanById(
  workspaceId: string,
  planId: string
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorPlans)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.id, planId)
      )
    )
    .limit(1)
  if (rows.length === 0) return null
  const stepMap = await loadStepsFor([rows[0].id])
  return toPlan(rows[0], stepMap.get(rows[0].id) ?? [])
}

export async function listPlans(
  workspaceId: string
): Promise<OperatorSessionPlan[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorPlans)
    .where(eq(operatorPlans.workspaceId, workspaceId))
    .orderBy(
      // Pinned + active first; then most-recently-updated.
      desc(operatorPlans.pinned),
      sql`
        CASE ${operatorPlans.state}
          WHEN 'active'   THEN 0
          WHEN 'drafting' THEN 1
          WHEN 'paused'   THEN 2
          WHEN 'shipped'  THEN 3
          WHEN 'archived' THEN 4
          ELSE 5
        END
      `,
      desc(operatorPlans.updatedAt)
    )
  if (rows.length === 0) return []
  const stepMap = await loadStepsFor(rows.map((r) => r.id))
  return rows.map((r) => toPlan(r, stepMap.get(r.id) ?? []))
}

/**
 * Resolve "which plan should Today / Plan / Brief / Inbox / Pulse scope to?"
 *
 * See module docstring for the three rules. This is idempotent-ish
 * (never mutates except for auto-creation in rule 3) and safe to call
 * from any loader.
 *
 * The `currentSession` argument is optional — if callers don't have a
 * session handy, we'll still find the most-recent session ourselves.
 */
export async function getActivePlan(
  workspaceId: string,
  currentSessionId: string | null | undefined,
  reviewer: string
): Promise<OperatorSessionPlan> {
  const db = getDb()

  // Rule 1: most-recently-updated pinned active plan.
  const pinned = await db
    .select()
    .from(operatorPlans)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.state, "active"),
        eq(operatorPlans.pinned, 1)
      )
    )
    .orderBy(desc(operatorPlans.updatedAt))
    .limit(1)
  if (pinned.length > 0) {
    const stepMap = await loadStepsFor([pinned[0].id])
    return toPlan(pinned[0], stepMap.get(pinned[0].id) ?? [])
  }

  // Resolve the current session if caller didn't give us one.
  let sessionId = currentSessionId ?? null
  if (!sessionId) {
    const latest = await db
      .select({ id: operatorSessions.id })
      .from(operatorSessions)
      .where(eq(operatorSessions.workspaceId, workspaceId))
      .orderBy(desc(operatorSessions.startedAt))
      .limit(1)
    sessionId = latest[0]?.id ?? null
  }

  // Rule 2: current session already has a plan.
  if (sessionId) {
    const sessRow = await db
      .select({ planId: operatorSessions.planId })
      .from(operatorSessions)
      .where(eq(operatorSessions.id, sessionId))
      .limit(1)
    const existingPlanId = sessRow[0]?.planId ?? null
    if (existingPlanId) {
      const plan = await getPlanById(workspaceId, existingPlanId)
      if (plan) return plan
    }
  }

  // Rule 2.5: before minting a fresh draft, see if this workspace
  // already has an existing drafting plan we can reuse. Without this
  // check, every page load of /operator-studio/today would create a
  // new blank plan — leaks rows and fragments the resolver.
  const existingDraft = await db
    .select()
    .from(operatorPlans)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.state, "drafting")
      )
    )
    .orderBy(desc(operatorPlans.updatedAt))
    .limit(1)
  if (existingDraft.length > 0) {
    const stepMap = await loadStepsFor([existingDraft[0].id])
    // Attach the current work session to this draft if it's orphaned, so
    // accepted evidence carries useful session provenance.
    if (sessionId) {
      await db
        .update(operatorSessions)
        .set({ planId: existingDraft[0].id, updatedAt: new Date() })
        .where(
          and(
            eq(operatorSessions.id, sessionId),
            // Only attach if the session isn't already pointed somewhere
            // — don't clobber an intentional link.
            sql`${operatorSessions.planId} IS NULL`
          )
        )
    }
    return toPlan(existingDraft[0], stepMap.get(existingDraft[0].id) ?? [])
  }

  // Rule 3: auto-create a blank drafting plan and attach the session.
  const now = new Date()
  const nowIso = now.toISOString()
  const planId = `plan-draft-${workspaceId}-${now.getTime()}`
  await db.insert(operatorPlans).values({
    id: planId,
    workspaceId,
    title: "Untitled plan",
    goal: null,
    outcome: null,
    state: "drafting",
    pinned: 0,
    ownerName: null,
    createdBy: reviewer,
    shippedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  if (sessionId) {
    await db
      .update(operatorSessions)
      .set({ planId, updatedAt: now })
      .where(eq(operatorSessions.id, sessionId))
  }
  return {
    id: planId,
    workspaceId,
    title: "Untitled plan",
    goal: null,
    outcome: null,
    state: "drafting",
    pinned: false,
    ownerName: null,
    createdBy: reviewer,
    shippedAt: null,
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    steps: [],
  }
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export interface CreatePlanInput {
  workspaceId: string
  title: string
  goal?: string | null
  outcome?: string | null
  pinned?: boolean
  ownerName?: string | null
  createdBy: string
  /** Optional initial steps. Ids are generated if omitted. */
  steps?: Array<{ id?: string; title: string; description?: string }>
  /** If set, attach this session to the newly-created plan. */
  attachToSessionId?: string
  /** Initial state — defaults to "active" for user-initiated creates. */
  state?: OperatorPlanState
}

export async function createPlan(
  input: CreatePlanInput
): Promise<OperatorSessionPlan> {
  const db = getDb()
  const now = new Date()
  const planId = `plan-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`

  await db.insert(operatorPlans).values({
    id: planId,
    workspaceId: input.workspaceId,
    title: input.title.trim() || "Untitled plan",
    goal: input.goal ?? null,
    outcome: input.outcome ?? null,
    state: input.state ?? "active",
    pinned: input.pinned ? 1 : 0,
    ownerName: input.ownerName ?? null,
    createdBy: input.createdBy,
    shippedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  if (input.steps && input.steps.length > 0) {
    await db.insert(operatorPlanSteps).values(
      input.steps.map((s, i) => ({
        id: s.id ?? `step-${planId}-${i}`,
        planId,
        workspaceId: input.workspaceId,
        title: s.title.trim() || "Untitled step",
        description: s.description ?? null,
        stepOrder: i,
        status: "open",
        createdAt: now,
        updatedAt: now,
      }))
    )
  }

  if (input.attachToSessionId) {
    await db
      .update(operatorSessions)
      .set({ planId, updatedAt: now })
      .where(eq(operatorSessions.id, input.attachToSessionId))
  }

  const plan = await getPlanById(input.workspaceId, planId)
  if (!plan) throw new Error("Plan creation failed")
  return plan
}

export interface UpdatePlanInput {
  title?: string
  goal?: string | null
  outcome?: string | null
  ownerName?: string | null
}

export async function updatePlan(
  workspaceId: string,
  planId: string,
  updates: UpdatePlanInput
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const now = new Date()
  const values: Partial<typeof operatorPlans.$inferInsert> = { updatedAt: now }
  if (updates.title !== undefined)
    values.title = updates.title.trim() || "Untitled plan"
  if (updates.goal !== undefined) values.goal = updates.goal
  if (updates.outcome !== undefined) values.outcome = updates.outcome
  if (updates.ownerName !== undefined) values.ownerName = updates.ownerName

  await db
    .update(operatorPlans)
    .set(values)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.id, planId)
      )
    )
  return getPlanById(workspaceId, planId)
}

export async function setPlanState(
  workspaceId: string,
  planId: string,
  state: OperatorPlanState
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const now = new Date()
  const values: Partial<typeof operatorPlans.$inferInsert> = {
    state,
    updatedAt: now,
  }
  if (state === "shipped") values.shippedAt = now
  if (state === "archived") values.archivedAt = now
  await db
    .update(operatorPlans)
    .set(values)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.id, planId)
      )
    )
  return getPlanById(workspaceId, planId)
}

export async function setPlanPinned(
  workspaceId: string,
  planId: string,
  pinned: boolean
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorPlans)
    .set({ pinned: pinned ? 1 : 0, updatedAt: now })
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        eq(operatorPlans.id, planId)
      )
    )
  return getPlanById(workspaceId, planId)
}

/**
 * Replace the plan's step list wholesale. Preserves existing step ids
 * when the caller passes them in (so accepted step evidence keeps working);
 * assigns new ids to steps without one. Any step id currently in the
 * DB that isn't in the input list is deleted.
 */
export async function setPlanSteps(
  workspaceId: string,
  planId: string,
  steps: Array<{ id?: string; title: string; description?: string }>
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const now = new Date()

  // Load current step ids for this plan so we can compute deletions.
  // Skip trashed rows so they don't get treated as "missing from the diff"
  // and silently revived.
  const existing = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.planId, planId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
  const existingIds = new Set(existing.map((r) => r.id))
  const keepIds = new Set<string>()
  const toInsert: (typeof operatorPlanSteps.$inferInsert)[] = []
  const toUpdate: Array<{
    id: string
    values: Partial<typeof operatorPlanSteps.$inferInsert>
  }> = []

  steps.forEach((s, i) => {
    const id = s.id ?? `step-${planId}-${now.getTime()}-${i}`
    keepIds.add(id)
    if (existingIds.has(id)) {
      toUpdate.push({
        id,
        values: {
          title: s.title.trim() || "Untitled step",
          description: s.description ?? null,
          stepOrder: i,
          updatedAt: now,
        },
      })
    } else {
      toInsert.push({
        id,
        planId,
        workspaceId,
        title: s.title.trim() || "Untitled step",
        description: s.description ?? null,
        stepOrder: i,
        status: "open",
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  const toDelete = [...existingIds].filter((id) => !keepIds.has(id))

  if (toDelete.length > 0) {
    // Soft delete — stamp `deleted_at` so the row is recoverable from
    // trash. Active reads filter `deleted_at IS NULL`, so the cards
    // disappear from the canvas immediately.
    await db
      .update(operatorPlanSteps)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(operatorPlanSteps.id, toDelete))
  }
  if (toInsert.length > 0) {
    await db.insert(operatorPlanSteps).values(toInsert)
  }
  for (const u of toUpdate) {
    await db
      .update(operatorPlanSteps)
      .set(u.values)
      .where(eq(operatorPlanSteps.id, u.id))
  }

  // Bump plan.updatedAt so pinned-plan ordering reflects the edit.
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, planId))

  return getPlanById(workspaceId, planId)
}

export async function attachSessionToPlan(
  sessionId: string,
  planId: string
): Promise<void> {
  const db = getDb()
  await db
    .update(operatorSessions)
    .set({ planId, updatedAt: new Date() })
    .where(eq(operatorSessions.id, sessionId))
}

/**
 * Surgical update of a single plan step. Title / description / status —
 * any subset. Returns the refreshed plan or null if not found.
 *
 * Preferred over setPlanSteps for in-place edits because it doesn't
 * touch the other rows (preserves their status, accepted evidence, and
 * ordering metadata).
 */
export interface UpdatePlanStepInput {
  title?: string
  description?: string | null
  status?: "open" | "in-motion" | "covered" | "skipped"
  /** Set to a step id to make this step a child of that step. Pass
   *  null to detach (make top-level). undefined leaves it untouched. */
  parentStepId?: string | null
  positionX?: number | null
  positionY?: number | null
  /** Pass a URL to set, null to clear, undefined to leave untouched. */
  coverImageUrl?: string | null
}

export async function updatePlanStep(
  workspaceId: string,
  planId: string,
  stepId: string,
  updates: UpdatePlanStepInput
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const now = new Date()
  const values: Partial<typeof operatorPlanSteps.$inferInsert> = {
    updatedAt: now,
  }
  if (typeof updates.title === "string") {
    values.title = updates.title.trim() || "Untitled step"
  }
  if (updates.description === null) {
    values.description = null
  } else if (typeof updates.description === "string") {
    values.description = updates.description
  }
  if (updates.status) {
    values.status = updates.status
  }
  if (updates.parentStepId !== undefined) {
    // Reject obvious self-cycles defensively. The UI prevents this
    // too, but the server is the trustworthy boundary.
    if (updates.parentStepId === stepId) {
      values.parentStepId = null
    } else {
      values.parentStepId = updates.parentStepId
    }
  }
  if (updates.positionX !== undefined) {
    values.positionX = updates.positionX
  }
  if (updates.positionY !== undefined) {
    values.positionY = updates.positionY
  }
  if (updates.coverImageUrl !== undefined) {
    values.coverImageUrl = updates.coverImageUrl
  }

  await db
    .update(operatorPlanSteps)
    .set(values)
    .where(
      and(
        eq(operatorPlanSteps.id, stepId),
        eq(operatorPlanSteps.planId, planId),
        eq(operatorPlanSteps.workspaceId, workspaceId)
      )
    )

  // Touch plan.updatedAt so the rest of the studio sees the change.
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, planId))

  return getPlanById(workspaceId, planId)
}

export async function deletePlanStep(
  workspaceId: string,
  planId: string,
  stepId: string
): Promise<OperatorSessionPlan | null> {
  const db = getDb()
  const now = new Date()
  // Soft delete — stamp `deleted_at` instead of removing the row, so the
  // step is recoverable from trash. The previous hard-delete cascaded
  // through children via FK, which made an accidental click on a parent
  // unrecoverable; soft-delete preserves the subtree intact.
  await db
    .update(operatorPlanSteps)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(operatorPlanSteps.id, stepId),
        eq(operatorPlanSteps.planId, planId),
        eq(operatorPlanSteps.workspaceId, workspaceId)
      )
    )
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, planId))
  return getPlanById(workspaceId, planId)
}

// ─── Step writes for MCP / agent use ───────────────────────────────────────
//
// These helpers exist so that AI agents can edit plans through the MCP
// server without falling back to ad-hoc seed scripts. Keep them small,
// id-stable, and tolerant of "id not yet known" callers.

export interface UpsertPlanStepInput {
  /** Optional. If omitted, a new id is generated. If provided and
   *  matches an existing row, that row is updated. */
  id?: string
  title: string
  description?: string | null
  status?: "open" | "in-motion" | "covered" | "skipped"
  parentStepId?: string | null
  /** When omitted on insert, the new step is appended (max(stepOrder) + 1
   *  within the plan). Ignored on update. */
  stepOrder?: number
}

export interface UpsertPlanStepResult {
  id: string
  action: "inserted" | "updated"
}

/**
 * Insert a new plan step or update an existing one (matched by id).
 *
 * If `id` is omitted, a fresh `step-<random>` id is generated and the
 * step is appended to the plan with status "open".
 *
 * If `id` is provided and matches an active row, that row is updated
 * (title / description / status / parentStepId only — stepOrder is
 * preserved).
 *
 * If `id` is provided but no active row matches, it's treated as an
 * insert with the provided id. Trashed rows with the same id are
 * untouched (call restorePlanStep + upsert if you want to revive them).
 */
export async function upsertPlanStep(
  workspaceId: string,
  planId: string,
  input: UpsertPlanStepInput
): Promise<UpsertPlanStepResult> {
  const db = getDb()
  const now = new Date()

  if (input.id) {
    const existing = await db
      .select({ id: operatorPlanSteps.id })
      .from(operatorPlanSteps)
      .where(
        and(
          eq(operatorPlanSteps.id, input.id),
          eq(operatorPlanSteps.planId, planId),
          eq(operatorPlanSteps.workspaceId, workspaceId),
          isNull(operatorPlanSteps.deletedAt)
        )
      )
      .limit(1)

    if (existing.length > 0) {
      await updatePlanStep(workspaceId, planId, input.id, {
        title: input.title,
        description: input.description ?? undefined,
        status: input.status,
        parentStepId: input.parentStepId,
      })
      return { id: input.id, action: "updated" }
    }
  }

  const id =
    input.id ??
    `step-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`

  let stepOrder = input.stepOrder
  if (stepOrder === undefined) {
    const maxRow = await db
      .select({
        max: sql<number>`COALESCE(MAX(${operatorPlanSteps.stepOrder}), -1)`,
      })
      .from(operatorPlanSteps)
      .where(
        and(
          eq(operatorPlanSteps.planId, planId),
          isNull(operatorPlanSteps.deletedAt)
        )
      )
    stepOrder = (maxRow[0]?.max ?? -1) + 1
  }

  await db.insert(operatorPlanSteps).values({
    id,
    planId,
    workspaceId,
    title: input.title.trim() || "Untitled step",
    description: input.description ?? null,
    stepOrder,
    status: input.status ?? "open",
    parentStepId: input.parentStepId ?? null,
    createdAt: now,
    updatedAt: now,
  })

  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, planId))

  return { id, action: "inserted" }
}

/** Narrow update of a single step's status. Cheaper-to-call sibling of
 *  updatePlanStep for the most common edit. */
export async function setPlanStepStatus(
  workspaceId: string,
  planId: string,
  stepId: string,
  status: "open" | "in-motion" | "covered" | "skipped"
): Promise<{ updated: boolean }> {
  const db = getDb()
  const now = new Date()
  const result = await db
    .update(operatorPlanSteps)
    .set({ status, updatedAt: now })
    .where(
      and(
        eq(operatorPlanSteps.id, stepId),
        eq(operatorPlanSteps.planId, planId),
        eq(operatorPlanSteps.workspaceId, workspaceId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .returning({ id: operatorPlanSteps.id })
  if (result.length === 0) return { updated: false }
  await db
    .update(operatorPlans)
    .set({ updatedAt: now })
    .where(eq(operatorPlans.id, planId))
  return { updated: true }
}

/**
 * Soft-delete a plan step. With `cascade: true` (default), every active
 * descendant in the same plan is also stamped `deleted_at`, so the
 * subtree disappears from the canvas as a unit. Pass `cascade: false`
 * to delete just the target row (children become orphans pointing at a
 * trashed parent — usually only useful when re-parenting first).
 */
export async function softDeletePlanStep(
  workspaceId: string,
  planId: string,
  stepId: string,
  opts: { cascade?: boolean } = {}
): Promise<{ deletedIds: string[] }> {
  const cascade = opts.cascade ?? true
  const db = getDb()
  const now = new Date()

  const targetIds = new Set<string>([stepId])

  if (cascade) {
    // Single SELECT, walk the tree locally — same shape as
    // demoteStepToNotes. Only consider active rows; already-trashed
    // descendants are already trashed.
    const allActive = await db
      .select({ id: operatorPlanSteps.id, parentStepId: operatorPlanSteps.parentStepId })
      .from(operatorPlanSteps)
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          eq(operatorPlanSteps.planId, planId),
          isNull(operatorPlanSteps.deletedAt)
        )
      )
    const childrenByParent = new Map<string, string[]>()
    for (const r of allActive) {
      if (!r.parentStepId) continue
      const arr = childrenByParent.get(r.parentStepId) ?? []
      arr.push(r.id)
      childrenByParent.set(r.parentStepId, arr)
    }
    const queue = [stepId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const child of childrenByParent.get(cur) ?? []) {
        if (!targetIds.has(child)) {
          targetIds.add(child)
          queue.push(child)
        }
      }
    }
  }

  const ids = [...targetIds]
  const result = await db
    .update(operatorPlanSteps)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, planId),
        inArray(operatorPlanSteps.id, ids),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .returning({ id: operatorPlanSteps.id })

  if (result.length > 0) {
    await db
      .update(operatorPlans)
      .set({ updatedAt: now })
      .where(eq(operatorPlans.id, planId))
  }

  return { deletedIds: result.map((r) => r.id) }
}

/** Reverse of softDeletePlanStep — clears `deleted_at` so the row is
 *  visible again. Single-row by default; pass `cascade: true` to also
 *  restore every trashed descendant in the same plan. */
export async function restorePlanStep(
  workspaceId: string,
  planId: string,
  stepId: string,
  opts: { cascade?: boolean } = {}
): Promise<{ restoredIds: string[] }> {
  const cascade = opts.cascade ?? false
  const db = getDb()
  const now = new Date()

  const targetIds = new Set<string>([stepId])

  if (cascade) {
    // Walk trashed descendants — these are rows where deleted_at IS NOT
    // NULL but parent links still resolve. Single SELECT over all rows
    // (active + trashed), walk locally.
    const allRows = await db
      .select({
        id: operatorPlanSteps.id,
        parentStepId: operatorPlanSteps.parentStepId,
        deletedAt: operatorPlanSteps.deletedAt,
      })
      .from(operatorPlanSteps)
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          eq(operatorPlanSteps.planId, planId)
        )
      )
    const childrenByParent = new Map<string, string[]>()
    for (const r of allRows) {
      if (!r.parentStepId || r.deletedAt === null) continue
      const arr = childrenByParent.get(r.parentStepId) ?? []
      arr.push(r.id)
      childrenByParent.set(r.parentStepId, arr)
    }
    const queue = [stepId]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const child of childrenByParent.get(cur) ?? []) {
        if (!targetIds.has(child)) {
          targetIds.add(child)
          queue.push(child)
        }
      }
    }
  }

  const ids = [...targetIds]
  const result = await db
    .update(operatorPlanSteps)
    .set({ deletedAt: null, updatedAt: now })
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, planId),
        inArray(operatorPlanSteps.id, ids)
      )
    )
    .returning({ id: operatorPlanSteps.id })

  if (result.length > 0) {
    await db
      .update(operatorPlans)
      .set({ updatedAt: now })
      .where(eq(operatorPlans.id, planId))
  }

  return { restoredIds: result.map((r) => r.id) }
}
