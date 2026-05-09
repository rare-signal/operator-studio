import "server-only"

import { and, desc, eq, gt, isNull, lt } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorInboxEvents,
  operatorOutboxMessages,
  operatorPlans,
  operatorPlanSteps,
  softwareFactories,
} from "@/lib/server/db/schema"

/**
 * Recency-first context packet — the tip-of-the-spear brief a fresh
 * agent reads at startup before doing anything. Plain-text by
 * default; JSON projection available for tooling.
 *
 * Per `step-operator-studio-recency-context-front-door` from the
 * 2026-05-08 Codex review. Goal: an agent can run one command and
 * know *what matters right now* without reading a 200-card plan.
 *
 * Sized for budget: each section caps at 5 rows. Reads use indexes
 * already present (workspace + state, factory + occurred_at desc).
 * On the dogfood workspace this currently reads in well under a
 * second.
 */

export interface RecencyContext {
  generatedAt: string
  /** All factories in the workspace, with rough activity hints. */
  factories: Array<{
    id: string
    label: string
    lastInboxEventAt: string | null
    pendingOutboxCount: number
    openInMotionStepCount: number
  }>
  /** Most-recent inbox events across the workspace (5). */
  freshInboxEvents: Array<{
    id: string
    factoryId: string | null
    surface: string
    upstreamKind: string
    actorName: string | null
    occurredAt: string
    excerpt: string | null
    relatedWorkLabel: string | null
  }>
  /** Outbox rows awaiting your approval (5 newest). */
  pendingOutbox: Array<{
    id: string
    factoryId: string | null
    surface: string
    targetLabel: string | null
    proposedAt: string
    excerpt: string
  }>
  /** In-motion plan steps that have not been touched in 24h+. */
  staleInMotion: Array<{
    id: string
    title: string
    factoryId: string | null
    updatedAt: string
    ageHours: number
  }>
  /** Steps moved to `covered` in the last 48h. */
  recentlyCovered: Array<{
    id: string
    title: string
    factoryId: string | null
    updatedAt: string
  }>
  /** Heuristic next-step suggestion. Plain text; agents may ignore. */
  recommendedNext: string
}

const HOUR_MS = 60 * 60 * 1000

export async function getRecencyContext(
  workspaceId: string
): Promise<RecencyContext> {
  const db = getDb()
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * HOUR_MS)
  const twoDaysAgo = new Date(now.getTime() - 48 * HOUR_MS)

  const [
    factories,
    freshInbox,
    pendingOutbox,
    staleInMotion,
    recentlyCovered,
  ] = await Promise.all([
    db
      .select({
        id: softwareFactories.id,
        label: softwareFactories.label,
      })
      .from(softwareFactories)
      .where(eq(softwareFactories.workspaceId, workspaceId)),
    db
      .select({
        id: operatorInboxEvents.id,
        factoryId: operatorInboxEvents.factoryId,
        surface: operatorInboxEvents.surface,
        upstreamKind: operatorInboxEvents.upstreamKind,
        actorName: operatorInboxEvents.actorName,
        occurredAt: operatorInboxEvents.occurredAt,
        textExcerpt: operatorInboxEvents.textExcerpt,
        relatedWorkLabel: operatorInboxEvents.relatedWorkLabel,
      })
      .from(operatorInboxEvents)
      .where(eq(operatorInboxEvents.workspaceId, workspaceId))
      .orderBy(desc(operatorInboxEvents.occurredAt))
      .limit(5),
    db
      .select({
        id: operatorOutboxMessages.id,
        factoryId: operatorOutboxMessages.factoryId,
        surface: operatorOutboxMessages.surface,
        targetLabel: operatorOutboxMessages.targetLabel,
        proposedAt: operatorOutboxMessages.proposedAt,
        renderedText: operatorOutboxMessages.renderedText,
      })
      .from(operatorOutboxMessages)
      .where(
        and(
          eq(operatorOutboxMessages.workspaceId, workspaceId),
          eq(operatorOutboxMessages.state, "awaiting_approval")
        )
      )
      .orderBy(desc(operatorOutboxMessages.proposedAt))
      .limit(5),
    db
      .select({
        id: operatorPlanSteps.id,
        title: operatorPlanSteps.title,
        factoryId: operatorPlanSteps.factoryId,
        updatedAt: operatorPlanSteps.updatedAt,
      })
      .from(operatorPlanSteps)
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          eq(operatorPlanSteps.status, "in-motion"),
          isNull(operatorPlanSteps.deletedAt),
          lt(operatorPlanSteps.updatedAt, dayAgo)
        )
      )
      .orderBy(desc(operatorPlanSteps.updatedAt))
      .limit(5),
    db
      .select({
        id: operatorPlanSteps.id,
        title: operatorPlanSteps.title,
        factoryId: operatorPlanSteps.factoryId,
        updatedAt: operatorPlanSteps.updatedAt,
      })
      .from(operatorPlanSteps)
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          eq(operatorPlanSteps.status, "covered"),
          isNull(operatorPlanSteps.deletedAt),
          gt(operatorPlanSteps.updatedAt, twoDaysAgo)
        )
      )
      .orderBy(desc(operatorPlanSteps.updatedAt))
      .limit(5),
  ])

  // Per-factory hints — tight queries, one round-trip each. With ≤5
  // factories this stays cheap; a future scale-up could batch.
  const factoryHints = await Promise.all(
    factories.map(async (f) => {
      const [latestInbox, openOutbox, inMotionSteps] = await Promise.all([
        db
          .select({ occurredAt: operatorInboxEvents.occurredAt })
          .from(operatorInboxEvents)
          .where(
            and(
              eq(operatorInboxEvents.workspaceId, workspaceId),
              eq(operatorInboxEvents.factoryId, f.id)
            )
          )
          .orderBy(desc(operatorInboxEvents.occurredAt))
          .limit(1),
        db
          .select({ id: operatorOutboxMessages.id })
          .from(operatorOutboxMessages)
          .where(
            and(
              eq(operatorOutboxMessages.workspaceId, workspaceId),
              eq(operatorOutboxMessages.factoryId, f.id),
              eq(operatorOutboxMessages.state, "awaiting_approval")
            )
          ),
        // In-motion step count via the same fallback the factory page
        // uses (step.factory_id ?? plan.factory_id).
        db
          .select({ id: operatorPlanSteps.id })
          .from(operatorPlanSteps)
          .leftJoin(
            operatorPlans,
            eq(operatorPlans.id, operatorPlanSteps.planId)
          )
          .where(
            and(
              eq(operatorPlanSteps.workspaceId, workspaceId),
              eq(operatorPlanSteps.status, "in-motion"),
              isNull(operatorPlanSteps.deletedAt)
            )
          ),
      ])
      // The in-motion count needs the OR-fallback applied client-side
      // because drizzle's `or()` here would re-spread into the
      // factory-id check. Cheap enough on count-only result sets.
      const inMotionForFactory = inMotionSteps.length // unused-direct
      void inMotionForFactory
      return {
        id: f.id,
        label: f.label,
        lastInboxEventAt: latestInbox[0]
          ? latestInbox[0].occurredAt.toISOString()
          : null,
        pendingOutboxCount: openOutbox.length,
        openInMotionStepCount: 0, // populated below from fallback-aware query
      }
    })
  )

  // Re-query in-motion counts with the proper fallback per factory.
  for (const hint of factoryHints) {
    const rows = await db
      .select({ id: operatorPlanSteps.id })
      .from(operatorPlanSteps)
      .leftJoin(operatorPlans, eq(operatorPlans.id, operatorPlanSteps.planId))
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          eq(operatorPlanSteps.status, "in-motion"),
          isNull(operatorPlanSteps.deletedAt)
        )
      )
    // Apply factory predicate client-side (small in-motion sets) so we
    // don't have to repeat the OR clause across two count queries.
    hint.openInMotionStepCount = rows.length // upper bound; refined below
  }
  // Replace each hint's openInMotionStepCount with the precise
  // factory-scoped fallback count via another query per factory.
  // Counts here are small (typically <100) so the second pass is fine.
  for (const hint of factoryHints) {
    const stepRows = await db
      .select({
        id: operatorPlanSteps.id,
        stepFactory: operatorPlanSteps.factoryId,
        planFactory: operatorPlans.factoryId,
      })
      .from(operatorPlanSteps)
      .leftJoin(operatorPlans, eq(operatorPlans.id, operatorPlanSteps.planId))
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          eq(operatorPlanSteps.status, "in-motion"),
          isNull(operatorPlanSteps.deletedAt)
        )
      )
    hint.openInMotionStepCount = stepRows.filter(
      (r) =>
        r.stepFactory === hint.id ||
        (r.stepFactory == null && r.planFactory === hint.id)
    ).length
  }

  const ctx: RecencyContext = {
    generatedAt: now.toISOString(),
    factories: factoryHints,
    freshInboxEvents: freshInbox.map((r) => ({
      id: r.id,
      factoryId: r.factoryId ?? null,
      surface: r.surface,
      upstreamKind: r.upstreamKind,
      actorName: r.actorName ?? null,
      occurredAt: r.occurredAt.toISOString(),
      excerpt: r.textExcerpt ?? null,
      relatedWorkLabel: r.relatedWorkLabel ?? null,
    })),
    pendingOutbox: pendingOutbox.map((r) => ({
      id: r.id,
      factoryId: r.factoryId ?? null,
      surface: r.surface,
      targetLabel: r.targetLabel ?? null,
      proposedAt: r.proposedAt.toISOString(),
      excerpt: r.renderedText.split("\n")[0]?.slice(0, 160) ?? "",
    })),
    staleInMotion: staleInMotion.map((r) => ({
      id: r.id,
      title: r.title,
      factoryId: r.factoryId ?? null,
      updatedAt: r.updatedAt.toISOString(),
      ageHours: Math.round((now.getTime() - r.updatedAt.getTime()) / HOUR_MS),
    })),
    recentlyCovered: recentlyCovered.map((r) => ({
      id: r.id,
      title: r.title,
      factoryId: r.factoryId ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
    recommendedNext: recommendNext({
      pendingOutbox: pendingOutbox.length,
      freshInbox: freshInbox.length,
      staleInMotion: staleInMotion.length,
    }),
  }
  return ctx
}

function recommendNext({
  pendingOutbox,
  freshInbox,
  staleInMotion,
}: {
  pendingOutbox: number
  freshInbox: number
  staleInMotion: number
}): string {
  if (pendingOutbox > 0) {
    return `Open /operator-studio/outbox — ${pendingOutbox} row(s) awaiting your PIN-armed approval before they reach an external surface.`
  }
  if (freshInbox >= 3) {
    return `Open /operator-studio/factory/factory-clarifying-telegento — recent upstream activity is denser than usual; scan the Inbox panel.`
  }
  if (staleInMotion > 0) {
    return `Run pnpm executive-recommendation:scan or open /operator-studio/executive — ${staleInMotion} in-motion card(s) are >24h cold.`
  }
  return `Loop is quiet. Quick read: pnpm os:state for live agent surface, or open /operator-studio/factory to pick the next bite.`
}

/**
 * Plain-text projection. Designed for an LLM startup-prompt block —
 * stable headers, key=value pairs, ≤200 lines on a typical workspace.
 */
export function renderRecencyContext(ctx: RecencyContext): string {
  const lines: string[] = []
  lines.push(`# Right now — generated ${ctx.generatedAt}`)
  lines.push(``)
  lines.push(`## Factories (${ctx.factories.length})`)
  for (const f of ctx.factories) {
    const lastInbox = f.lastInboxEventAt
      ? humanAgo(f.lastInboxEventAt)
      : "no inbox events yet"
    lines.push(
      `  ${f.id}  inbox last=${lastInbox}  outbox_pending=${f.pendingOutboxCount}  in_motion=${f.openInMotionStepCount}`
    )
  }
  lines.push(``)
  lines.push(`## Pending outbox awaiting your approval (${ctx.pendingOutbox.length})`)
  if (ctx.pendingOutbox.length === 0) {
    lines.push(`  (none — David has not been pinged for an outbound send.)`)
  } else {
    for (const o of ctx.pendingOutbox) {
      lines.push(
        `  ${o.id}  ${o.surface} → ${o.targetLabel ?? "?"}  proposed ${humanAgo(o.proposedAt)}`
      )
      lines.push(`    ${o.excerpt}`)
    }
  }
  lines.push(``)
  lines.push(`## Fresh inbox events (${ctx.freshInboxEvents.length})`)
  if (ctx.freshInboxEvents.length === 0) {
    lines.push(`  (none — try pnpm tsx scripts/ado-poll.ts to fetch upstream.)`)
  } else {
    for (const e of ctx.freshInboxEvents) {
      lines.push(
        `  [${e.surface}/${e.upstreamKind}] ${e.relatedWorkLabel ?? ""}  ${e.actorName ?? "(unknown)"}  ${humanAgo(e.occurredAt)}`
      )
      if (e.excerpt) lines.push(`    ${e.excerpt.slice(0, 160)}`)
    }
  }
  lines.push(``)
  lines.push(`## Stale in-motion cards >24h (${ctx.staleInMotion.length})`)
  for (const s of ctx.staleInMotion) {
    lines.push(`  ${s.id}  age=${s.ageHours}h  ${s.title}`)
  }
  if (ctx.staleInMotion.length === 0) lines.push(`  (none cold.)`)
  lines.push(``)
  lines.push(`## Recently covered <48h (${ctx.recentlyCovered.length})`)
  for (const c of ctx.recentlyCovered) {
    lines.push(`  ${c.id}  ${humanAgo(c.updatedAt)}  ${c.title}`)
  }
  if (ctx.recentlyCovered.length === 0)
    lines.push(`  (no fresh wins this cycle.)`)
  lines.push(``)
  lines.push(`## Recommended next`)
  lines.push(`  ${ctx.recommendedNext}`)
  lines.push(``)
  lines.push(`## Tools first — never write product-native records to disk`)
  lines.push(`  KB / claims    → MCP knowledge_*  /  /operator-studio/knowledge`)
  lines.push(`  Plans          → MCP plan_*       /  pnpm plan:card`)
  lines.push(`  Outbox stage   → MCP outbox_stage_ado_comment   (NEVER az boards directly)`)
  lines.push(`  Inbox poll     → POST /api/operator-studio/ingest/ado  /  pnpm tsx scripts/ado-poll.ts`)
  lines.push(`  Factory page   → /operator-studio/factory/<factory-id>`)
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
