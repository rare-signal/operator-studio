import { and, desc, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorInboxEvents,
  operatorPlanSteps,
} from "@/lib/server/db/schema"

/**
 * ADO triage report — turns recent ADO inbox events into three
 * buckets so David can see, at a glance, what is a quick lift
 * (comment-and-go), what needs investigation (carve a card), and
 * what is already in motion (don't double-assign).
 *
 * Per `step-telegento-ado-triage-action-loop`. The classifier is
 * deliberately a small heuristic — the goal is to compress a noisy
 * inbox into a decisive call sheet, not to predict every nuance.
 */

export type AdoTriageBucket = "quick_lift" | "investigation" | "in_motion"

export interface AdoTriageItem {
  workItemId: string
  /** "ADO #39" — derived from related_work_label or work-item id. */
  label: string
  title: string | null
  state: string | null
  priority: number | null
  type: string | null
  assignedTo: string | null
  /** Most recent change/comment timestamp seen in the inbox (ISO). */
  latestActivityAt: string
  latestActor: string | null
  /** Latest comment body excerpt, if any. Comment > change for triage. */
  latestCommentExcerpt: string | null
  /** Counts derived from inbox events for this work item id. */
  changeEventCount: number
  commentEventCount: number
  /** Plan-step ids in any non-terminal status that mention this ADO id. */
  boundPlanStepIds: string[]
  bucket: AdoTriageBucket
  /** Plain-English reason the heuristic chose this bucket. */
  reason: string
  /** One short suggested next move for David. */
  suggestedAction: string
}

export interface AdoTriageReport {
  generatedAt: string
  workspaceId: string
  itemCount: number
  buckets: {
    quick_lift: AdoTriageItem[]
    investigation: AdoTriageItem[]
    in_motion: AdoTriageItem[]
  }
}

const HOUR_MS = 60 * 60 * 1000

interface CollectedEvent {
  surface: string
  upstreamKind: string
  occurredAt: Date
  actorName: string | null
  textExcerpt: string | null
  payload: Record<string, unknown>
  relatedWorkLabel: string | null
}

export async function getAdoTriageReport(
  workspaceId: string,
  opts?: { lookbackHours?: number; limit?: number }
): Promise<AdoTriageReport> {
  const db = getDb()
  const now = new Date()
  const lookbackMs = (opts?.lookbackHours ?? 24 * 14) * HOUR_MS // 2 weeks default
  const since = new Date(now.getTime() - lookbackMs)

  // Pull ADO inbox events in the lookback window. The poller writes
  // one row per (work-item-id, rev) for changes and one per
  // (work-item-id, comment-id) for comments — grouping by
  // related_work_id collapses both back into a per-item view.
  const rows = await db
    .select({
      surface: operatorInboxEvents.surface,
      upstreamKind: operatorInboxEvents.upstreamKind,
      occurredAt: operatorInboxEvents.occurredAt,
      actorName: operatorInboxEvents.actorName,
      textExcerpt: operatorInboxEvents.textExcerpt,
      payloadJson: operatorInboxEvents.payloadJson,
      relatedWorkId: operatorInboxEvents.relatedWorkId,
      relatedWorkLabel: operatorInboxEvents.relatedWorkLabel,
    })
    .from(operatorInboxEvents)
    .where(
      and(
        eq(operatorInboxEvents.workspaceId, workspaceId),
        eq(operatorInboxEvents.surface, "ado")
      )
    )
    .orderBy(desc(operatorInboxEvents.occurredAt))
    .limit(opts?.limit ?? 500)

  const byWorkItem = new Map<string, CollectedEvent[]>()
  for (const r of rows) {
    if (!r.relatedWorkId) continue
    if (r.occurredAt.getTime() < since.getTime()) continue
    const existing = byWorkItem.get(r.relatedWorkId) ?? []
    existing.push({
      surface: r.surface,
      upstreamKind: r.upstreamKind,
      occurredAt: r.occurredAt,
      actorName: r.actorName ?? null,
      textExcerpt: r.textExcerpt ?? null,
      payload: (r.payloadJson ?? {}) as Record<string, unknown>,
      relatedWorkLabel: r.relatedWorkLabel ?? null,
    })
    byWorkItem.set(r.relatedWorkId, existing)
  }

  // Pull all open + in-motion plan steps once; we'll match by ADO id
  // mentioned in title or description. Cheap on a workspace this
  // size; the in-motion step count is typically <50.
  const planRows = await db
    .select({
      id: operatorPlanSteps.id,
      title: operatorPlanSteps.title,
      description: operatorPlanSteps.description,
      status: operatorPlanSteps.status,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )

  const items: AdoTriageItem[] = []
  for (const [workItemId, events] of byWorkItem.entries()) {
    events.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    const latest = events[0]
    if (!latest) continue
    const latestComment =
      events.find((e) => e.upstreamKind === "comment") ?? null
    const latestChangePayload =
      (events.find((e) => e.upstreamKind === "change")?.payload ?? {}) as Record<
        string,
        unknown
      >

    const title =
      stringOrNull(latestChangePayload.title) ??
      stringOrNull(latest.payload.title)
    const state =
      stringOrNull(latestChangePayload.state) ??
      stringOrNull(latest.payload.state)
    const priorityRaw =
      latestChangePayload.priority ?? latest.payload.priority ?? null
    const priority =
      typeof priorityRaw === "number"
        ? priorityRaw
        : typeof priorityRaw === "string" && priorityRaw.trim().length > 0
          ? Number(priorityRaw)
          : null
    const type =
      stringOrNull(latestChangePayload.type) ??
      stringOrNull(latest.payload.type)
    const assignedTo =
      stringOrNull(latestChangePayload.assignedTo) ??
      stringOrNull(latest.payload.assignedTo)

    const label = latest.relatedWorkLabel ?? `ADO #${workItemId}`

    const idToken = `#${workItemId}`
    const boundPlanStepIds = planRows
      .filter((p) => {
        if (p.status === "covered" || p.status === "skipped") return false
        const haystack = `${p.title}\n${p.description ?? ""}`
        return (
          haystack.includes(idToken) ||
          haystack.includes(label) ||
          haystack.includes(`ADO ${workItemId}`)
        )
      })
      .map((p) => p.id)

    const changeEventCount = events.filter(
      (e) => e.upstreamKind === "change"
    ).length
    const commentEventCount = events.filter(
      (e) => e.upstreamKind === "comment"
    ).length

    const classification = classify({
      state,
      priority: Number.isFinite(priority) ? (priority as number) : null,
      title,
      latestCommentExcerpt: latestComment?.textExcerpt ?? null,
      bound: boundPlanStepIds.length > 0,
    })

    items.push({
      workItemId,
      label,
      title,
      state,
      priority: Number.isFinite(priority) ? (priority as number) : null,
      type,
      assignedTo,
      latestActivityAt: latest.occurredAt.toISOString(),
      latestActor: latest.actorName,
      latestCommentExcerpt: latestComment?.textExcerpt
        ? latestComment.textExcerpt.slice(0, 240)
        : null,
      changeEventCount,
      commentEventCount,
      boundPlanStepIds,
      bucket: classification.bucket,
      reason: classification.reason,
      suggestedAction: classification.suggestedAction,
    })
  }

  // Sort within each bucket: most-recent first, but a closed/Done
  // state sinks below active states.
  const sortItems = (a: AdoTriageItem, b: AdoTriageItem) => {
    const closedA = isClosedState(a.state) ? 1 : 0
    const closedB = isClosedState(b.state) ? 1 : 0
    if (closedA !== closedB) return closedA - closedB
    return b.latestActivityAt.localeCompare(a.latestActivityAt)
  }

  const buckets: AdoTriageReport["buckets"] = {
    quick_lift: items.filter((i) => i.bucket === "quick_lift").sort(sortItems),
    investigation: items
      .filter((i) => i.bucket === "investigation")
      .sort(sortItems),
    in_motion: items.filter((i) => i.bucket === "in_motion").sort(sortItems),
  }

  return {
    generatedAt: now.toISOString(),
    workspaceId,
    itemCount: items.length,
    buckets,
  }
}

interface ClassifyInput {
  state: string | null
  priority: number | null
  title: string | null
  latestCommentExcerpt: string | null
  bound: boolean
}

interface ClassifyResult {
  bucket: AdoTriageBucket
  reason: string
  suggestedAction: string
}

/**
 * Pure classifier — exposed for unit testing without a DB.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const stateLower = (input.state ?? "").toLowerCase()
  const closed = isClosedState(input.state)

  if (closed) {
    return {
      bucket: "quick_lift",
      reason: `state=${input.state ?? "?"} — already closed; verify and clear.`,
      suggestedAction:
        "Skim and confirm — if no follow-up, leave as-is; otherwise reopen.",
    }
  }

  if (input.bound) {
    return {
      bucket: "in_motion",
      reason: "Has at least one open/in-motion plan card referencing this ADO id.",
      suggestedAction:
        "Don't double-assign. Check the bound card for status; nudge the worker if stale.",
    }
  }

  const investigationSignals = scanInvestigationSignals(
    input.title,
    input.latestCommentExcerpt
  )

  const isHighPriority =
    input.priority !== null && input.priority > 0 && input.priority <= 2
  const isLowPriority = input.priority !== null && input.priority >= 3

  if (investigationSignals.length > 0) {
    return {
      bucket: "investigation",
      reason: `Stakeholder language suggests scope unclear: ${investigationSignals.slice(0, 2).join(", ")}.`,
      suggestedAction:
        "Carve a plan card and stage an outbox comment asking for the missing detail before committing engineering time.",
    }
  }

  if (isHighPriority && stateLower === "active") {
    return {
      bucket: "investigation",
      reason: `P${input.priority} active with no bound card — needs an owner before drift.`,
      suggestedAction:
        "Either bind a plan card (and a worker) or stage a stakeholder comment with an ETA.",
    }
  }

  if (isLowPriority || stateLower === "new") {
    return {
      bucket: "quick_lift",
      reason: `${stateLower === "new" ? "Fresh" : "Lower-priority"} item, scope reads narrow — likely a same-cycle response.`,
      suggestedAction:
        "Quick read of the latest comment, then either stage an acknowledgement comment or carve a thin plan card.",
    }
  }

  return {
    bucket: "quick_lift",
    reason: "No urgent signals — default to quick triage.",
    suggestedAction: "Skim the latest activity; close, comment, or carve.",
  }
}

const INVESTIGATION_PHRASES = [
  "need to",
  "needs to",
  "investigate",
  "design",
  "track",
  "research",
  "decide",
  "clarify",
  "unclear",
  "tbd",
  "?",
  "rebuild",
  "rework",
  "long term",
  "long-term",
  "architecture",
]

function scanInvestigationSignals(
  title: string | null,
  comment: string | null
): string[] {
  const text = `${title ?? ""}\n${comment ?? ""}`.toLowerCase()
  const hits: string[] = []
  for (const phrase of INVESTIGATION_PHRASES) {
    if (text.includes(phrase)) hits.push(phrase)
  }
  return hits
}

function isClosedState(state: string | null): boolean {
  if (!state) return false
  const s = state.toLowerCase()
  return s === "closed" || s === "done" || s === "resolved" || s === "removed"
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.length > 0) return v
  if (typeof v === "number") return String(v)
  return null
}

export function renderAdoTriageReport(report: AdoTriageReport): string {
  const lines: string[] = []
  lines.push(`# ADO triage — generated ${report.generatedAt}`)
  lines.push(
    `workspace=${report.workspaceId}  items=${report.itemCount}  quick_lift=${report.buckets.quick_lift.length}  investigation=${report.buckets.investigation.length}  in_motion=${report.buckets.in_motion.length}`
  )
  lines.push("")
  lines.push("## Quick lift — comment, close, or carve a thin card")
  if (report.buckets.quick_lift.length === 0) lines.push("  (none)")
  for (const it of report.buckets.quick_lift) renderItem(it, lines)
  lines.push("")
  lines.push("## Investigation — scope unclear; do not start cold")
  if (report.buckets.investigation.length === 0) lines.push("  (none)")
  for (const it of report.buckets.investigation) renderItem(it, lines)
  lines.push("")
  lines.push("## In motion — already has a plan card")
  if (report.buckets.in_motion.length === 0) lines.push("  (none)")
  for (const it of report.buckets.in_motion) renderItem(it, lines)
  lines.push("")
  lines.push(
    "Tools: stage a comment via MCP outbox_stage_ado_comment; carve a card via pnpm plan:card upsert."
  )
  return lines.join("\n")
}

function renderItem(it: AdoTriageItem, lines: string[]): void {
  const meta = [
    it.state ? `state=${it.state}` : null,
    it.priority !== null ? `P${it.priority}` : null,
    it.type ?? null,
    it.assignedTo ? `assigned=${it.assignedTo}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  lines.push(`  ${it.label}  ${it.title ?? "(no title)"}`)
  if (meta) lines.push(`    ${meta}`)
  lines.push(
    `    last ${it.latestActivityAt} by ${it.latestActor ?? "?"} · changes=${it.changeEventCount} comments=${it.commentEventCount}`
  )
  if (it.latestCommentExcerpt) {
    lines.push(`    comment: ${it.latestCommentExcerpt}`)
  }
  if (it.boundPlanStepIds.length > 0) {
    lines.push(`    bound: ${it.boundPlanStepIds.join(", ")}`)
  }
  lines.push(`    why: ${it.reason}`)
  lines.push(`    do:  ${it.suggestedAction}`)
}
