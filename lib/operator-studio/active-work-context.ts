/**
 * Active Work Context — the deterministic answer to "what plan, lane,
 * thread, and KB are we working in *right now*?"
 *
 * Designed as a single composed read so Codex/Claude can ask once and
 * route every subsequent write (cards, KB, review items, agent
 * bindings) within scope. Strong scope is the prerequisite for safe
 * external-system intake (Azure DevOps, Teams) — without it, agents
 * drift across plans on every turn.
 *
 * This module composes existing primitives (no schema changes):
 *   - `getActivePlan` — workspace's pinned/active plan resolver
 *   - `listActiveThreadCardBindings` — bound worker agents
 *   - `listReviewItems` — David's review queue (open items)
 *   - `listEntries` (KB) — entries whose tags overlap the plan
 *
 * Cross-plan references are *visible*, never silent: if a review item
 * or KB entry is bound to a step outside the active plan, it shows up
 * in `crossPlanBridges` so callers can decide whether to switch
 * context or follow the bridge.
 */

import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorPlanSteps,
  operatorPlans,
  operatorSessions,
} from "@/lib/server/db/schema"

import { isKbEnabled, listEntries, type KbEntry } from "./knowledge"
import { getActivePlan } from "./plans"
import { listReviewItems, type ReviewItem } from "./review-items"
import {
  listActiveThreadCardBindings,
  type ThreadCardBinding,
} from "./thread-card-bindings"
import type { OperatorPlanStep, OperatorSessionPlan } from "./types"

export interface ActiveWorkPlanSummary {
  id: string
  title: string
  goal: string | null
  outcome: string | null
  state: OperatorSessionPlan["state"]
  pinned: boolean
  updatedAt: string
  totalSteps: number
  stepCounts: Record<OperatorPlanStep["status"], number>
  /** First in-motion step (lowest stepOrder). Routing default for
   *  follow-on writes. */
  activeStepId: string | null
  activeStepTitle: string | null
}

export interface ActiveWorkAgent {
  agentId: string
  agentKind: string
  planStepId: string
  planStepTitle: string | null
  bindingSource: ThreadCardBinding["source"]
  updatedAt: string
}

export interface ActiveWorkSession {
  id: string
  startedAt: string
  endedAt: string | null
  planId: string | null
}

export interface CrossPlanBridge {
  /** Where the bridge points to. */
  planId: string
  planTitle: string | null
  /** Why we're surfacing it: a review item or KB entry that references
   *  a step in the named plan. */
  via: "review_item" | "kb_entry"
  refId: string
  refTitle: string
  hint: string
}

export interface ActiveWorkRouting {
  /** Workspace + plan callers should target by default. */
  workspaceId: string
  planId: string
  /** Step to attach to when no step id is provided. Falls back to the
   *  active plan's first in-motion step, then first open step. */
  defaultStepId: string | null
  /** When true, callers MUST require an explicit `planId` to write
   *  outside the active plan. Default true — silent cross-plan
   *  mixing is the failure mode this whole primitive exists to
   *  prevent. */
  requireExplicitPlanId: boolean
}

export interface ActiveWorkContext {
  workspaceId: string
  resolvedAt: string
  plan: ActiveWorkPlanSummary
  session: ActiveWorkSession | null
  agents: ActiveWorkAgent[]
  pendingReviewCount: number
  /** Up to N most-recent open review items, lightweight projection. */
  recentReviews: Array<
    Pick<
      ReviewItem,
      "id" | "title" | "sourceType" | "state" | "createdAt"
    >
  >
  /** KB entries whose tags overlap the plan title/goal — best-effort
   *  hint, not exhaustive. Empty when KB is disabled. */
  relatedKb: Array<Pick<KbEntry, "id" | "title" | "entryType" | "tags">>
  crossPlanBridges: CrossPlanBridge[]
  routing: ActiveWorkRouting
}

const KB_RECENT_LIMIT = 12
const REVIEW_PREVIEW_LIMIT = 8

function planStatusCounts(
  steps: OperatorPlanStep[]
): Record<OperatorPlanStep["status"], number> {
  const out: Record<OperatorPlanStep["status"], number> = {
    open: 0,
    "in-motion": 0,
    covered: 0,
    skipped: 0,
  }
  for (const s of steps) out[s.status] = (out[s.status] ?? 0) + 1
  return out
}

function pickActiveStep(steps: OperatorPlanStep[]): OperatorPlanStep | null {
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  return (
    ordered.find((s) => s.status === "in-motion") ??
    ordered.find((s) => s.status === "open") ??
    null
  )
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
  )
}

function summarizePlan(plan: OperatorSessionPlan): ActiveWorkPlanSummary {
  const counts = planStatusCounts(plan.steps)
  const active = pickActiveStep(plan.steps)
  return {
    id: plan.id,
    title: plan.title,
    goal: plan.goal,
    outcome: plan.outcome,
    state: plan.state,
    pinned: plan.pinned,
    updatedAt: plan.updatedAt,
    totalSteps: plan.steps.length,
    stepCounts: counts,
    activeStepId: active?.id ?? null,
    activeStepTitle: active?.title ?? null,
  }
}

async function loadCurrentSession(
  workspaceId: string
): Promise<ActiveWorkSession | null> {
  const db = getDb()
  const rows = await db
    .select({
      id: operatorSessions.id,
      startedAt: operatorSessions.startedAt,
      endedAt: operatorSessions.endedAt,
      planId: operatorSessions.planId,
    })
    .from(operatorSessions)
    .where(eq(operatorSessions.workspaceId, workspaceId))
    .orderBy(desc(operatorSessions.startedAt))
    .limit(1)
  if (rows.length === 0) return null
  const r = rows[0]
  return {
    id: r.id,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt ? r.endedAt.toISOString() : null,
    planId: r.planId ?? null,
  }
}

async function loadStepTitles(
  workspaceId: string,
  stepIds: string[]
): Promise<Map<string, { title: string; planId: string }>> {
  if (stepIds.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({
      id: operatorPlanSteps.id,
      title: operatorPlanSteps.title,
      planId: operatorPlanSteps.planId,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        inArray(operatorPlanSteps.id, stepIds),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
  const out = new Map<string, { title: string; planId: string }>()
  for (const r of rows) out.set(r.id, { title: r.title, planId: r.planId })
  return out
}

async function loadPlanTitles(
  workspaceId: string,
  planIds: string[]
): Promise<Map<string, string>> {
  if (planIds.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({ id: operatorPlans.id, title: operatorPlans.title })
    .from(operatorPlans)
    .where(
      and(
        eq(operatorPlans.workspaceId, workspaceId),
        inArray(operatorPlans.id, planIds)
      )
    )
  return new Map(rows.map((r) => [r.id, r.title]))
}

export interface GetActiveWorkContextOptions {
  /** Defaults to "system" for callers that don't have an identity
   *  (MCP tools, internal jobs). Used only if Rule 3 of getActivePlan
   *  fires and we need to mint a draft plan. */
  reviewer?: string
  /** Cap for related KB / recent reviews. */
  kbLimit?: number
  reviewLimit?: number
}

export async function getActiveWorkContext(
  workspaceId: string,
  opts: GetActiveWorkContextOptions = {}
): Promise<ActiveWorkContext> {
  const reviewer = opts.reviewer ?? "system"
  const session = await loadCurrentSession(workspaceId)

  // Active plan — auto-creates a drafting plan if none exists.
  const plan = await getActivePlan(workspaceId, session?.id ?? null, reviewer)
  const planSummary = summarizePlan(plan)

  // Bound agents — surface only those bound to a step in the active plan.
  const allBindings = await listActiveThreadCardBindings(workspaceId)
  const stepIds = new Set(plan.steps.map((s) => s.id))
  const inScopeBindings = allBindings.filter((b) => stepIds.has(b.planStepId))
  const stepTitleByStepId = new Map(plan.steps.map((s) => [s.id, s.title]))
  const agents: ActiveWorkAgent[] = inScopeBindings.map((b) => ({
    agentId: b.agentId,
    agentKind: b.agentKind,
    planStepId: b.planStepId,
    planStepTitle: stepTitleByStepId.get(b.planStepId) ?? null,
    bindingSource: b.source,
    updatedAt: b.updatedAt,
  }))

  // Open review items — count + recent projection. Bridges: any review
  // item that links to a step outside the active plan.
  const openReviews = await listReviewItems(workspaceId, { limit: 200 })
  const recentReviews = openReviews
    .slice(0, opts.reviewLimit ?? REVIEW_PREVIEW_LIMIT)
    .map((r) => ({
      id: r.id,
      title: r.title,
      sourceType: r.sourceType,
      state: r.state,
      createdAt: r.createdAt,
    }))
  const reviewBridgeStepIds = new Set<string>()
  for (const r of openReviews) {
    if (r.relatedPlanStepId && !stepIds.has(r.relatedPlanStepId)) {
      reviewBridgeStepIds.add(r.relatedPlanStepId)
    }
  }

  // KB — best-effort tag overlap with the plan title/goal.
  const kbEnabled = await isKbEnabled(workspaceId)
  const relatedKb: ActiveWorkContext["relatedKb"] = []
  const kbBridgeRefs: Array<{ entry: KbEntry; bridgePlanId: string }> = []
  if (kbEnabled) {
    const planTokens = tokenize(`${plan.title} ${plan.goal ?? ""}`)
    const allEntries = await listEntries(workspaceId)
    const overlaps: Array<{ entry: KbEntry; score: number }> = []
    for (const e of allEntries) {
      const tagTokens = new Set(e.tags.flatMap((t) => [...tokenize(t)]))
      let score = 0
      for (const t of tagTokens) if (planTokens.has(t)) score += 1
      const titleHit = [...tokenize(e.title)].some((t) => planTokens.has(t))
      if (titleHit) score += 1
      if (score > 0) overlaps.push({ entry: e, score })
    }
    overlaps.sort((a, b) => b.score - a.score)
    const limit = opts.kbLimit ?? KB_RECENT_LIMIT
    for (const { entry } of overlaps.slice(0, limit)) {
      relatedKb.push({
        id: entry.id,
        title: entry.title,
        entryType: entry.entryType,
        tags: entry.tags,
      })
    }
  }

  // Resolve cross-plan bridges (review items only — KB has no
  // step-id link in the current schema, so we don't infer bridges
  // from it).
  const stepLookup = await loadStepTitles(workspaceId, [
    ...reviewBridgeStepIds,
  ])
  const bridgePlanIds = new Set<string>()
  for (const v of stepLookup.values()) bridgePlanIds.add(v.planId)
  const planTitles = await loadPlanTitles(workspaceId, [...bridgePlanIds])
  const crossPlanBridges: CrossPlanBridge[] = []
  for (const r of openReviews) {
    if (!r.relatedPlanStepId) continue
    if (stepIds.has(r.relatedPlanStepId)) continue
    const stepInfo = stepLookup.get(r.relatedPlanStepId)
    if (!stepInfo) continue
    crossPlanBridges.push({
      planId: stepInfo.planId,
      planTitle: planTitles.get(stepInfo.planId) ?? null,
      via: "review_item",
      refId: r.id,
      refTitle: r.title,
      hint: `review item "${r.title}" references step "${stepInfo.title}" in another plan`,
    })
  }
  // Suppress dups + acknowledge KB-bridge surface gap.
  void kbBridgeRefs

  return {
    workspaceId,
    resolvedAt: new Date().toISOString(),
    plan: planSummary,
    session,
    agents,
    pendingReviewCount: openReviews.length,
    recentReviews,
    relatedKb,
    crossPlanBridges,
    routing: {
      workspaceId,
      planId: plan.id,
      defaultStepId: planSummary.activeStepId,
      requireExplicitPlanId: true,
    },
  }
}
