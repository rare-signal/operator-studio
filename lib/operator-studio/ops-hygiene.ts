import "server-only"

import { and, desc, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorPlanSteps,
  operatorThreadCardBindings,
} from "@/lib/server/db/schema"

import { createReviewItem } from "./review-items"

/**
 * Operational hygiene scan.
 *
 * Looks at every in-motion plan step and emits an advisory
 * recommendation per stale / agent-less card. Recommendations land
 * in the David Review Queue (operator_review_items, source_type =
 * 'ops_hygiene') so David approves before any mutation. Per
 * step-ops-dream-paradise-hygiene-pass: "Do not blindly close
 * cards. Decide rebind/continue/park/mark-covered."
 *
 * Heuristic (conservative; explainable in the review row):
 *
 *   - Has an active thread-card binding (detached_at IS NULL):
 *       → "continue" — agent is bound, leave the card alone but
 *         flag for review if updatedAt is >48h.
 *   - No binding + age <24h:
 *       → no row emitted (still fresh; let it cook).
 *   - No binding + 24h–96h:
 *       → "rebind" — propose attaching a worker.
 *   - No binding + >96h:
 *       → "park" — propose reverting to status=open or marking
 *         covered if a sibling shipped against it. The reviewer
 *         decides.
 *
 * Idempotent on (workspace_id, sourceType='ops_hygiene', sourceId=stepId)
 * — re-running the scan updates the existing recommendation row in
 * place rather than fan-outing duplicates.
 */

const HOUR_MS = 60 * 60 * 1000

export type HygieneRecommendation =
  | "continue"
  | "rebind"
  | "park"
  | "mark-covered"

export interface HygieneRow {
  stepId: string
  title: string
  ageHours: number
  hasActiveBinding: boolean
  recommendation: HygieneRecommendation
  reason: string
  reviewItemId?: string
}

export interface HygieneScanResult {
  scannedInMotion: number
  emittedRecommendations: number
  rows: HygieneRow[]
}

export async function scanOpsHygiene(
  workspaceId: string
): Promise<HygieneScanResult> {
  const db = getDb()
  const now = Date.now()

  const inMotion = await db
    .select({
      id: operatorPlanSteps.id,
      title: operatorPlanSteps.title,
      description: operatorPlanSteps.description,
      updatedAt: operatorPlanSteps.updatedAt,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.status, "in-motion"),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .orderBy(desc(operatorPlanSteps.updatedAt))

  // Active bindings keyed by stepId.
  const bindings = await db
    .select({
      stepId: operatorThreadCardBindings.planStepId,
      agentId: operatorThreadCardBindings.agentId,
    })
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
  const byStep = new Map<string, string[]>()
  for (const b of bindings) {
    const a = byStep.get(b.stepId) ?? []
    a.push(b.agentId)
    byStep.set(b.stepId, a)
  }

  const rows: HygieneRow[] = []
  let emitted = 0

  for (const step of inMotion) {
    const ageHours = Math.round(
      (now - step.updatedAt.getTime()) / HOUR_MS
    )
    const boundAgents = byStep.get(step.id) ?? []
    const hasBinding = boundAgents.length > 0

    let recommendation: HygieneRecommendation | null = null
    let reason = ""

    if (hasBinding) {
      if (ageHours >= 48) {
        recommendation = "continue"
        reason = `Bound to ${boundAgents.length} agent(s) but step.updated_at is ${ageHours}h old. Either nudge the agent or detach the binding if the worker has stalled.`
      }
      // Bound + recent → quiet. No row emitted.
    } else if (ageHours >= 96) {
      recommendation = "park"
      reason = `No active agent bound and step.updated_at is ${ageHours}h old (>96h). Likely either covered by sibling work or lost momentum — propose reverting to status=open (park) or marking covered if a sibling shipped against it. Reviewer decides.`
    } else if (ageHours >= 24) {
      recommendation = "rebind"
      reason = `No active agent bound and step.updated_at is ${ageHours}h old. Either dispatch a worker (rebind) or accept that this is fallow and revert to status=open.`
    }
    // Otherwise (no binding, <24h) → still fresh; quiet.

    if (!recommendation) continue

    const proposedActionText = ({
      continue: "Continue (nudge bound agent or detach stalled binding)",
      rebind: "Rebind (dispatch a worker against this card)",
      park: "Park (revert to status=open) or Mark covered if sibling shipped",
      "mark-covered": "Mark covered (work is done)",
    } as const)[recommendation]

    const row: HygieneRow = {
      stepId: step.id,
      title: step.title,
      ageHours,
      hasActiveBinding: hasBinding,
      recommendation,
      reason,
    }

    const reviewItem = await createReviewItem(workspaceId, {
      sourceType: "ops_hygiene",
      sourceLabel: "Ops hygiene scan",
      sourceId: step.id,
      title: `Stale in-motion · ${step.title}`,
      summary: `${ageHours}h since last update · ${hasBinding ? `${boundAgents.length} bound agent(s)` : "no bound agent"}`,
      rawText: reason,
      rawPayload: {
        stepId: step.id,
        recommendation,
        ageHours,
        hasActiveBinding: hasBinding,
        boundAgents,
        scanGeneratedAt: new Date().toISOString(),
      },
      proposedAction: proposedActionText,
      relatedPlanStepId: step.id,
      tags: ["ops_hygiene", recommendation],
    })
    row.reviewItemId = reviewItem.id

    rows.push(row)
    emitted += 1
  }

  return {
    scannedInMotion: inMotion.length,
    emittedRecommendations: emitted,
    rows,
  }
}
