/**
 * Plan inventory + sprawl signals.
 *
 * Read-only catalogue of every plan in a workspace, decorated with the
 * signals an agent (or David) needs before creating yet another plan
 * or moving cards around:
 *
 *   - step counts by status
 *   - days since last update
 *   - bound-agent count and most recent thread bindings
 *   - heuristic flags: empty / stale / abandoned / shipped-but-pinned
 *   - duplicate candidates (token-set Jaccard ≥ 0.5 on titles)
 *
 * Does NOT mutate. Does NOT merge or prune. The companion helper
 * `proposeMergePruneReview()` writes a david-only review item into
 * `operator_review_items` so a human can confirm any consolidation;
 * that's the only side-effecting hook.
 */

import "server-only"

import { and, eq, isNull, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorPlanSteps,
  operatorPlans,
  operatorSessions,
  operatorThreadCardBindings,
} from "@/lib/server/db/schema"

import { createReviewItem } from "./review-items"

export type PlanInventoryFlag =
  | "empty"
  | "stale"
  | "abandoned"
  | "shipped-pinned"
  | "draft-orphan"
  | "all-covered"
  /** More than one plan is active+pinned in this workspace. The active-
   *  plan resolver only picks one (most-recently-updated wins), so the
   *  others are silently second-class — a real-world sprawl mode. */
  | "multi-pinned-active"

export interface PlanInventoryEntry {
  id: string
  title: string
  state: "drafting" | "active" | "paused" | "shipped" | "archived" | string
  pinned: boolean
  goal: string | null
  outcome: string | null
  updatedAt: string
  createdAt: string
  daysSinceUpdate: number
  stepCounts: {
    open: number
    "in-motion": number
    covered: number
    skipped: number
    total: number
  }
  boundAgentCount: number
  sessionCount: number
  flags: PlanInventoryFlag[]
  /** Plan ids whose titles overlap (Jaccard ≥ threshold). Symmetric. */
  duplicateCandidateIds: string[]
}

export interface PlanInventory {
  workspaceId: string
  generatedAt: string
  totalPlans: number
  plans: PlanInventoryEntry[]
  /** Quick rollup so callers can decide "do I need to do anything?" */
  sprawlSummary: {
    empty: number
    stale: number
    abandoned: number
    duplicates: number
    shippedPinned: number
    multiPinnedActive: number
  }
  /** Symmetric pairs of duplicate candidates with computed similarity. */
  duplicatePairs: Array<{
    aPlanId: string
    bPlanId: string
    similarity: number
    sharedTokens: string[]
  }>
}

const STALE_DAYS_DEFAULT = 14
const DUPLICATE_THRESHOLD_DEFAULT = 0.5

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "with",
  "is",
  "are",
  "be",
  "by",
  "from",
  "this",
  "that",
  "plan",
  "draft",
  "untitled",
])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3 && !STOP.has(w))
  )
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; shared: string[] } {
  if (a.size === 0 || b.size === 0) return { score: 0, shared: [] }
  const shared: string[] = []
  for (const t of a) if (b.has(t)) shared.push(t)
  const union = new Set([...a, ...b]).size
  return { score: shared.length / union, shared }
}

function dayDiff(updatedAt: Date, now: Date): number {
  const ms = now.getTime() - updatedAt.getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export interface GetPlanInventoryOptions {
  staleDays?: number
  duplicateThreshold?: number
  now?: Date
}

export async function getPlanInventory(
  workspaceId: string,
  opts: GetPlanInventoryOptions = {}
): Promise<PlanInventory> {
  const db = getDb()
  const now = opts.now ?? new Date()
  const staleDays = opts.staleDays ?? STALE_DAYS_DEFAULT
  const dupeThreshold = opts.duplicateThreshold ?? DUPLICATE_THRESHOLD_DEFAULT

  const planRows = await db
    .select()
    .from(operatorPlans)
    .where(eq(operatorPlans.workspaceId, workspaceId))

  if (planRows.length === 0) {
    return {
      workspaceId,
      generatedAt: now.toISOString(),
      totalPlans: 0,
      plans: [],
      sprawlSummary: {
        empty: 0,
        stale: 0,
        abandoned: 0,
        duplicates: 0,
        shippedPinned: 0,
        multiPinnedActive: 0,
      },
      duplicatePairs: [],
    }
  }

  // Step counts grouped by (planId, status), active rows only.
  const stepCountRows = await db
    .select({
      planId: operatorPlanSteps.planId,
      status: operatorPlanSteps.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .groupBy(operatorPlanSteps.planId, operatorPlanSteps.status)

  const stepCountByPlan = new Map<
    string,
    { open: number; "in-motion": number; covered: number; skipped: number; total: number }
  >()
  for (const r of stepCountRows) {
    const bucket = stepCountByPlan.get(r.planId) ?? {
      open: 0,
      "in-motion": 0,
      covered: 0,
      skipped: 0,
      total: 0,
    }
    if (r.status === "open" || r.status === "in-motion" || r.status === "covered" || r.status === "skipped") {
      bucket[r.status as keyof typeof bucket] = r.count
    }
    bucket.total += r.count
    stepCountByPlan.set(r.planId, bucket)
  }

  // Active bindings grouped by planId. Bindings carry a denormalized
  // planId column, but it's optional and historically NULL on older
  // rows. Join through plan_step_id → operator_plan_steps.plan_id so
  // the count is accurate regardless of the denorm field.
  const bindingRows = await db
    .select({
      planId: operatorPlanSteps.planId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(operatorThreadCardBindings)
    .innerJoin(
      operatorPlanSteps,
      eq(operatorThreadCardBindings.planStepId, operatorPlanSteps.id)
    )
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .groupBy(operatorPlanSteps.planId)
  const boundCountByPlan = new Map<string, number>()
  for (const r of bindingRows) boundCountByPlan.set(r.planId, r.count)

  // Sessions per plan.
  const sessionRows = await db
    .select({
      planId: operatorSessions.planId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(operatorSessions)
    .where(eq(operatorSessions.workspaceId, workspaceId))
    .groupBy(operatorSessions.planId)
  const sessionCountByPlan = new Map<string, number>()
  for (const r of sessionRows) {
    if (r.planId) sessionCountByPlan.set(r.planId, r.count)
  }

  // Pre-tokenize titles for duplicate detection.
  const tokensByPlan = new Map<string, Set<string>>()
  for (const p of planRows) tokensByPlan.set(p.id, tokenize(p.title))

  // Pairwise duplicate scan. O(N²) — fine: workspaces top out at low
  // hundreds of plans.
  const duplicatePairs: PlanInventory["duplicatePairs"] = []
  const dupeIdsByPlan = new Map<string, Set<string>>()
  for (let i = 0; i < planRows.length; i++) {
    for (let j = i + 1; j < planRows.length; j++) {
      const a = planRows[i]
      const b = planRows[j]
      const { score, shared } = jaccard(
        tokensByPlan.get(a.id)!,
        tokensByPlan.get(b.id)!
      )
      if (score >= dupeThreshold) {
        duplicatePairs.push({
          aPlanId: a.id,
          bPlanId: b.id,
          similarity: Number(score.toFixed(3)),
          sharedTokens: shared,
        })
        const aSet = dupeIdsByPlan.get(a.id) ?? new Set<string>()
        aSet.add(b.id)
        dupeIdsByPlan.set(a.id, aSet)
        const bSet = dupeIdsByPlan.get(b.id) ?? new Set<string>()
        bSet.add(a.id)
        dupeIdsByPlan.set(b.id, bSet)
      }
    }
  }

  const entries: PlanInventoryEntry[] = []
  let summaryEmpty = 0
  let summaryStale = 0
  let summaryAbandoned = 0
  let summaryShippedPinned = 0
  let summaryMultiPinned = 0

  // Count workspace-wide pinned-active so we can flag plans that are
  // co-pinned with rivals. The resolver only chooses one.
  const activePinnedCount = planRows.filter(
    (p) => p.state === "active" && p.pinned === 1
  ).length
  for (const p of planRows) {
    const counts = stepCountByPlan.get(p.id) ?? {
      open: 0,
      "in-motion": 0,
      covered: 0,
      skipped: 0,
      total: 0,
    }
    const days = dayDiff(p.updatedAt, now)
    const flags: PlanInventoryFlag[] = []
    if (counts.total === 0) flags.push("empty")
    if (
      (p.state === "drafting" || p.state === "active") &&
      days >= staleDays &&
      counts["in-motion"] === 0
    ) {
      flags.push("stale")
    }
    if (
      counts.total > 0 &&
      counts.open === 0 &&
      counts["in-motion"] === 0 &&
      (counts.covered > 0 || counts.skipped > 0) &&
      p.state !== "shipped" &&
      p.state !== "archived"
    ) {
      flags.push("all-covered")
    }
    if (
      p.state === "drafting" &&
      days >= staleDays * 2 &&
      counts.total === 0
    ) {
      flags.push("draft-orphan")
    }
    if (
      flags.includes("stale") &&
      counts.open > 0 &&
      counts["in-motion"] === 0 &&
      days >= staleDays * 2
    ) {
      flags.push("abandoned")
    }
    if (p.state === "shipped" && p.pinned === 1) flags.push("shipped-pinned")
    if (
      p.state === "active" &&
      p.pinned === 1 &&
      activePinnedCount > 1
    ) {
      flags.push("multi-pinned-active")
    }

    if (flags.includes("empty")) summaryEmpty++
    if (flags.includes("stale")) summaryStale++
    if (flags.includes("abandoned")) summaryAbandoned++
    if (flags.includes("shipped-pinned")) summaryShippedPinned++
    if (flags.includes("multi-pinned-active")) summaryMultiPinned++

    entries.push({
      id: p.id,
      title: p.title,
      state: p.state,
      pinned: p.pinned === 1,
      goal: p.goal ?? null,
      outcome: p.outcome ?? null,
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
      daysSinceUpdate: days,
      stepCounts: counts,
      boundAgentCount: boundCountByPlan.get(p.id) ?? 0,
      sessionCount: sessionCountByPlan.get(p.id) ?? 0,
      flags,
      duplicateCandidateIds: [...(dupeIdsByPlan.get(p.id) ?? [])],
    })
  }

  // Sort: pinned + active first, then most-recently-updated.
  entries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    if (a.state !== b.state) {
      const stateRank = (s: string) =>
        ({ active: 0, drafting: 1, paused: 2, shipped: 3, archived: 4 })[s] ??
        5
      return stateRank(a.state) - stateRank(b.state)
    }
    return b.updatedAt.localeCompare(a.updatedAt)
  })

  return {
    workspaceId,
    generatedAt: now.toISOString(),
    totalPlans: entries.length,
    plans: entries,
    sprawlSummary: {
      empty: summaryEmpty,
      stale: summaryStale,
      abandoned: summaryAbandoned,
      duplicates: duplicatePairs.length,
      shippedPinned: summaryShippedPinned,
      multiPinnedActive: summaryMultiPinned,
    },
    duplicatePairs,
  }
}

/**
 * Source type used for plan-sprawl review items so the David queue
 * can bucket them into the "sprawl" category.
 */
export const PLAN_SPRAWL_SOURCE_TYPE = "plan_sprawl" as const

/**
 * Non-destructive: turn a duplicate pair into a david-only review
 * item. Idempotent via deterministic `sourceId` (sorted plan id pair),
 * so re-running the inventory doesn't flood the bucket.
 */
export async function proposeMergePruneReview(
  workspaceId: string,
  pair: PlanInventory["duplicatePairs"][number],
  context: { aTitle: string; bTitle: string }
) {
  const [lo, hi] = [pair.aPlanId, pair.bPlanId].sort()
  const sourceId = `merge:${lo}:${hi}`
  return createReviewItem(workspaceId, {
    sourceType: PLAN_SPRAWL_SOURCE_TYPE,
    sourceId,
    sourceLabel: "plan-inventory",
    title: `Possible duplicate plans: "${context.aTitle}" / "${context.bTitle}"`,
    summary: `Title token overlap = ${pair.similarity}. Shared: ${pair.sharedTokens.join(", ") || "(none)"}. Review whether to merge, mark one archived, or accept both.`,
    proposedAction:
      "Pick one plan as canonical; archive the other or merge steps. No automatic merge — David decides.",
    visibility: "david_only",
    state: "candidate",
    confidence: pair.similarity,
    rationale: `Detected by plan-inventory token Jaccard ≥ ${pair.similarity}.`,
    tags: ["plan-sprawl", "duplicate-candidate"],
    rawPayload: {
      aPlanId: pair.aPlanId,
      bPlanId: pair.bPlanId,
      similarity: pair.similarity,
      sharedTokens: pair.sharedTokens,
    },
  })
}
