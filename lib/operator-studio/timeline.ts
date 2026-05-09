import "server-only"

import { and, desc, eq, gte } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorInboxEvents,
  operatorKbEntries,
  operatorOutboxMessages,
  operatorPlanSteps,
  operatorReviewItems,
  operatorThreadCardBindings,
} from "@/lib/server/db/schema"

/**
 * Operations timeline — temporal narrative across the loop.
 *
 * Per `step-operator-studio-timeline-story-surface` from the
 * 2026-05-09 handoff. NOT another dashboard. A single chronological
 * feed of mixed-type events that lets a reader (human or agent)
 * page through the story of what's happening.
 *
 * Sources:
 *   - operator_inbox_events (ado/teams/etc upstream activity)
 *   - operator_outbox_messages (proposed → approved → sent → rejected)
 *   - operator_plan_steps (status changes use updated_at as proxy)
 *   - operator_review_items (raised + decided)
 *   - operator_kb_entries (created + updated)
 *   - operator_thread_card_bindings (created + detached)
 *
 * Each row normalizes onto TimelineEvent so a single sort/merge
 * produces the feed. Per-source caps keep this fast on big
 * workspaces; the merge surfaces newest events overall.
 */

export type TimelineEventKind =
  | "inbox.ado.change"
  | "inbox.ado.comment"
  | "inbox.teams.message"
  | "inbox.other"
  | "outbox.staged"
  | "outbox.approved"
  | "outbox.sent"
  | "outbox.rejected"
  | "plan.touched"
  | "review.raised"
  | "review.decided"
  | "kb.created"
  | "kb.updated"
  | "agent.bound"
  | "agent.detached"

export interface TimelineEvent {
  id: string
  kind: TimelineEventKind
  occurredAt: string
  factoryId: string | null
  actor: string | null
  /** One-line summary, suitable for a list row. */
  summary: string
  /** Optional second line (excerpt, rationale, ...). */
  detail: string | null
  /** Optional clickable target. */
  link: string | null
}

export interface GetTimelineOptions {
  /** Filter to a specific factory. Null = all. */
  factoryId?: string | null
  /** Earliest event to include. Default 14 days ago. */
  since?: Date
  /** Final cap. Default 50. */
  limit?: number
}

const DEFAULT_LOOKBACK_DAYS = 14
const PER_SOURCE_CAP = 30

export async function getTimeline(
  workspaceId: string,
  opts: GetTimelineOptions = {}
): Promise<TimelineEvent[]> {
  const db = getDb()
  const since =
    opts.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000)
  const limit = opts.limit ?? 50
  const factoryId = opts.factoryId ?? null

  const events: TimelineEvent[] = []

  // ─── Inbox events ───────────────────────────────────────────────
  {
    const conds = [
      eq(operatorInboxEvents.workspaceId, workspaceId),
      gte(operatorInboxEvents.occurredAt, since),
    ]
    if (factoryId) conds.push(eq(operatorInboxEvents.factoryId, factoryId))
    const rows = await db
      .select()
      .from(operatorInboxEvents)
      .where(and(...conds))
      .orderBy(desc(operatorInboxEvents.occurredAt))
      .limit(PER_SOURCE_CAP)
    for (const r of rows) {
      const kind: TimelineEventKind =
        r.surface === "ado"
          ? r.upstreamKind === "comment"
            ? "inbox.ado.comment"
            : "inbox.ado.change"
          : r.surface === "teams"
            ? "inbox.teams.message"
            : "inbox.other"
      events.push({
        id: `inbox:${r.id}`,
        kind,
        occurredAt: r.occurredAt.toISOString(),
        factoryId: r.factoryId ?? null,
        actor: r.actorName ?? null,
        summary: `${r.relatedWorkLabel ?? r.surface} — ${r.upstreamKind}`,
        detail: r.textExcerpt ? r.textExcerpt.slice(0, 240) : null,
        link: r.relatedWorkId
          ? `/operator-studio/factory/${r.factoryId ?? ""}`
          : null,
      })
    }
  }

  // ─── Outbox state transitions ────────────────────────────────────
  // Each row produces 1-3 events depending on which timestamps are set.
  {
    const conds = [
      eq(operatorOutboxMessages.workspaceId, workspaceId),
      gte(operatorOutboxMessages.proposedAt, since),
    ]
    if (factoryId) conds.push(eq(operatorOutboxMessages.factoryId, factoryId))
    const rows = await db
      .select()
      .from(operatorOutboxMessages)
      .where(and(...conds))
      .orderBy(desc(operatorOutboxMessages.proposedAt))
      .limit(PER_SOURCE_CAP)
    for (const r of rows) {
      const target = r.targetLabel ?? r.targetId
      events.push({
        id: `outbox-staged:${r.id}`,
        kind: "outbox.staged",
        occurredAt: r.proposedAt.toISOString(),
        factoryId: r.factoryId ?? null,
        actor: r.llmRunId ?? null,
        summary: `${r.surface} → ${target} staged`,
        detail: r.renderedText.split("\n")[0]?.slice(0, 200) ?? null,
        link: `/operator-studio/outbox/${r.id}`,
      })
      if (r.decidedAt && r.state !== "expired") {
        const transitionKind: TimelineEventKind =
          r.state === "rejected"
            ? "outbox.rejected"
            : "outbox.approved"
        events.push({
          id: `outbox-decided:${r.id}`,
          kind: transitionKind,
          occurredAt: r.decidedAt.toISOString(),
          factoryId: r.factoryId ?? null,
          actor: "operator",
          summary: `${r.surface} → ${target} ${r.state}`,
          detail:
            r.state === "rejected" && r.sendError
              ? r.sendError.slice(0, 200)
              : null,
          link: `/operator-studio/outbox/${r.id}`,
        })
      }
      if (r.sentAt) {
        events.push({
          id: `outbox-sent:${r.id}`,
          kind: "outbox.sent",
          occurredAt: r.sentAt.toISOString(),
          factoryId: r.factoryId ?? null,
          actor: "operator",
          summary: `${r.surface} → ${target} sent`,
          detail: null,
          link: `/operator-studio/outbox/${r.id}`,
        })
      }
    }
  }

  // ─── Plan step touches ───────────────────────────────────────────
  // updated_at is the closest we have to a status-change timestamp
  // until a step_history table lands.
  {
    const conds = [
      eq(operatorPlanSteps.workspaceId, workspaceId),
      gte(operatorPlanSteps.updatedAt, since),
    ]
    if (factoryId) conds.push(eq(operatorPlanSteps.factoryId, factoryId))
    const rows = await db
      .select({
        id: operatorPlanSteps.id,
        title: operatorPlanSteps.title,
        status: operatorPlanSteps.status,
        factoryId: operatorPlanSteps.factoryId,
        updatedAt: operatorPlanSteps.updatedAt,
      })
      .from(operatorPlanSteps)
      .where(and(...conds))
      .orderBy(desc(operatorPlanSteps.updatedAt))
      .limit(PER_SOURCE_CAP)
    for (const r of rows) {
      events.push({
        id: `plan:${r.id}:${r.updatedAt.getTime()}`,
        kind: "plan.touched",
        occurredAt: r.updatedAt.toISOString(),
        factoryId: r.factoryId ?? null,
        actor: null,
        summary: `[${r.status}] ${r.title}`,
        detail: null,
        link: `/operator-studio/plan?step=${encodeURIComponent(r.id)}`,
      })
    }
  }

  // ─── Review items raised + decided ───────────────────────────────
  {
    const rows = await db
      .select()
      .from(operatorReviewItems)
      .where(
        and(
          eq(operatorReviewItems.workspaceId, workspaceId),
          gte(operatorReviewItems.createdAt, since)
        )
      )
      .orderBy(desc(operatorReviewItems.createdAt))
      .limit(PER_SOURCE_CAP)
    for (const r of rows) {
      events.push({
        id: `review-raised:${r.id}`,
        kind: "review.raised",
        occurredAt: r.createdAt.toISOString(),
        factoryId: null,
        actor: r.sourceType,
        summary: `[${r.sourceType}] ${r.title}`,
        detail: r.summary || null,
        link: `/operator-studio/executive`,
      })
      if (r.decidedAt) {
        events.push({
          id: `review-decided:${r.id}`,
          kind: "review.decided",
          occurredAt: r.decidedAt.toISOString(),
          factoryId: null,
          actor: "operator",
          summary: `[${r.sourceType}] ${r.title} → ${r.state}`,
          detail: null,
          link: `/operator-studio/executive`,
        })
      }
    }
  }

  // ─── KB entries created + updated ────────────────────────────────
  {
    const rows = await db
      .select({
        id: operatorKbEntries.id,
        title: operatorKbEntries.title,
        entryType: operatorKbEntries.entryType,
        createdAt: operatorKbEntries.createdAt,
        updatedAt: operatorKbEntries.updatedAt,
      })
      .from(operatorKbEntries)
      .where(
        and(
          eq(operatorKbEntries.workspaceId, workspaceId),
          gte(operatorKbEntries.updatedAt, since)
        )
      )
      .orderBy(desc(operatorKbEntries.updatedAt))
      .limit(PER_SOURCE_CAP)
    for (const r of rows) {
      const wasCreated =
        r.createdAt.getTime() === r.updatedAt.getTime() ||
        r.updatedAt.getTime() - r.createdAt.getTime() < 1000
      events.push({
        id: `kb:${r.id}:${r.updatedAt.getTime()}`,
        kind: wasCreated ? "kb.created" : "kb.updated",
        occurredAt: r.updatedAt.toISOString(),
        factoryId: null,
        actor: "operator-studio",
        summary: `[${r.entryType}] ${r.title}`,
        detail: null,
        link: `/operator-studio/knowledge`,
      })
    }
  }

  // ─── Thread-card bindings ────────────────────────────────────────
  {
    const rows = await db
      .select()
      .from(operatorThreadCardBindings)
      .where(
        and(
          eq(operatorThreadCardBindings.workspaceId, workspaceId),
          gte(operatorThreadCardBindings.createdAt, since)
        )
      )
      .orderBy(desc(operatorThreadCardBindings.createdAt))
      .limit(PER_SOURCE_CAP)
    for (const r of rows) {
      events.push({
        id: `bind-created:${r.id}`,
        kind: "agent.bound",
        occurredAt: r.createdAt.toISOString(),
        factoryId: null,
        actor: r.agentId,
        summary: `${r.agentKind} ${r.agentId} → ${r.planStepId}`,
        detail: r.rationale ?? null,
        link: `/operator-studio/plan?step=${encodeURIComponent(r.planStepId)}`,
      })
      if (r.detachedAt) {
        events.push({
          id: `bind-detached:${r.id}`,
          kind: "agent.detached",
          occurredAt: r.detachedAt.toISOString(),
          factoryId: null,
          actor: r.agentId,
          summary: `${r.agentKind} ${r.agentId} detached from ${r.planStepId}`,
          detail: null,
          link: `/operator-studio/plan?step=${encodeURIComponent(r.planStepId)}`,
        })
      }
    }
  }

  // Sort + cap.
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
  return events.slice(0, limit)
}

/** Plain-text projection — the agent / CLI view. */
export function renderTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) return "(no events in window)"
  const lines: string[] = []
  for (const e of events) {
    const ago = humanAgo(e.occurredAt)
    lines.push(
      `${ago.padStart(8)}  ${e.kind.padEnd(22)}  ${e.summary}`
    )
    if (e.detail) lines.push(`          ${e.detail.slice(0, 180)}`)
  }
  return lines.join("\n")
}

function humanAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
