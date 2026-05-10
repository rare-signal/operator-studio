/**
 * Durable worker-thread → plan-card bindings.
 *
 * The Operations desk previously relied on two ephemeral signals:
 *   1. tail-sniff over recent JSONL turns (`detectedPlanCardId`),
 *   2. a localStorage map maintained by the Bento UI.
 *
 * This module is the durable third source: when Operator Studio
 * launches (or the operator manually attaches) a Claude/Codex worker
 * against a plan card, the binding is persisted in
 * `operator_thread_card_bindings` so it survives reloads, browsers,
 * and machines, and is readable by server-side derivation.
 *
 * Read precedence on Operations is: durable > manual (localStorage) >
 * tail-sniff. The localStorage path is intentionally preserved as a
 * fallback during the rollout.
 */

import "server-only"

import { and, desc, eq, inArray, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorThreadCardBindings } from "@/lib/server/db/schema"

export type ThreadBindingSource =
  | "launch"
  | "manual"
  | "tail-sniff"
  | "scheduled"

export type SpawnOrigin = "cockpit" | "recommendation" | "manual"

export interface ThreadCardBinding {
  id: string
  workspaceId: string
  agentId: string
  agentKind: string
  planStepId: string
  planId: string | null
  source: ThreadBindingSource
  confidence: number | null
  rationale: string | null
  sourceRecommendationId: string | null
  spawnedByAgentId: string | null
  spawnOrigin: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface UpsertThreadCardBindingInput {
  workspaceId: string
  agentId: string
  agentKind: string
  planStepId: string
  planId?: string | null
  source: ThreadBindingSource
  confidence?: number | null
  rationale?: string | null
  sourceRecommendationId?: string | null
  /** Composite agent id of the executive that originated this spawn
   *  (e.g. cockpit's pinned exec). Persists the parent → child linkage
   *  so the cockpit can show authoritative spawned-by lists. */
  spawnedByAgentId?: string | null
  spawnOrigin?: SpawnOrigin | null
  createdBy?: string | null
}

function rowToBinding(row: typeof operatorThreadCardBindings.$inferSelect): ThreadCardBinding {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    agentKind: row.agentKind,
    planStepId: row.planStepId,
    planId: row.planId ?? null,
    source: row.source as ThreadBindingSource,
    confidence: row.confidence ?? null,
    rationale: row.rationale ?? null,
    sourceRecommendationId: row.sourceRecommendationId ?? null,
    spawnedByAgentId: row.spawnedByAgentId ?? null,
    spawnOrigin: row.spawnOrigin ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Idempotent upsert of the active binding for a (workspace, agent).
 *
 * If an active row exists with the same planStepId, only updatedAt and
 * the optional metadata are refreshed (source is preserved unless the
 * incoming source ranks higher — see SOURCE_RANK).
 *
 * If an active row exists pointing at a different step, it is detached
 * (detached_at = now) and a new active row is inserted. This preserves
 * binding history without requiring a separate audit table.
 */
const SOURCE_RANK: Record<ThreadBindingSource, number> = {
  launch: 0,
  manual: 1,
  scheduled: 2,
  "tail-sniff": 3,
}

export async function upsertThreadCardBinding(
  input: UpsertThreadCardBindingInput
): Promise<ThreadCardBinding> {
  const db = getDb()
  const now = new Date()

  const existing = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, input.workspaceId),
        eq(operatorThreadCardBindings.agentId, input.agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (row.planStepId === input.planStepId) {
      const incomingRank = SOURCE_RANK[input.source] ?? 99
      const currentRank = SOURCE_RANK[row.source as ThreadBindingSource] ?? 99
      const nextSource = incomingRank <= currentRank ? input.source : (row.source as ThreadBindingSource)
      const updated = await db
        .update(operatorThreadCardBindings)
        .set({
          source: nextSource,
          confidence: input.confidence ?? row.confidence ?? null,
          rationale: input.rationale ?? row.rationale ?? null,
          sourceRecommendationId:
            input.sourceRecommendationId ?? row.sourceRecommendationId ?? null,
          spawnedByAgentId:
            input.spawnedByAgentId ?? row.spawnedByAgentId ?? null,
          spawnOrigin: input.spawnOrigin ?? row.spawnOrigin ?? null,
          planId: input.planId ?? row.planId ?? null,
          updatedAt: now,
        })
        .where(eq(operatorThreadCardBindings.id, row.id))
        .returning()
      return rowToBinding(updated[0])
    }
    // Different card — detach the old row, then insert a fresh one.
    await db
      .update(operatorThreadCardBindings)
      .set({ detachedAt: now, updatedAt: now })
      .where(eq(operatorThreadCardBindings.id, row.id))
  }

  const id = `tcb-${input.workspaceId}-${input.agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${now.getTime()}`
  const inserted = await db
    .insert(operatorThreadCardBindings)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      agentKind: input.agentKind,
      planStepId: input.planStepId,
      planId: input.planId ?? null,
      source: input.source,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      sourceRecommendationId: input.sourceRecommendationId ?? null,
      spawnedByAgentId: input.spawnedByAgentId ?? null,
      spawnOrigin: input.spawnOrigin ?? null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return rowToBinding(inserted[0])
}

/**
 * Active bindings spawned by a specific executive agent. Drives the
 * cockpit's "workers spawned by exec" rail. Excludes detached rows.
 */
export async function getActiveBindingsSpawnedBy(
  workspaceId: string,
  spawnedByAgentId: string
): Promise<ThreadCardBinding[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.spawnedByAgentId, spawnedByAgentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .orderBy(desc(operatorThreadCardBindings.createdAt))
  return rows.map(rowToBinding)
}

/** All active (non-detached) bindings for a workspace. */
export async function listActiveThreadCardBindings(
  workspaceId: string
): Promise<ThreadCardBinding[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .orderBy(desc(operatorThreadCardBindings.updatedAt))
  return rows.map(rowToBinding)
}

/** Active bindings for a specific set of agent ids. */
export async function getActiveBindingsForAgents(
  workspaceId: string,
  agentIds: string[]
): Promise<ThreadCardBinding[]> {
  if (agentIds.length === 0) return []
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        isNull(operatorThreadCardBindings.detachedAt),
        inArray(operatorThreadCardBindings.agentId, agentIds)
      )
    )
  return rows.map(rowToBinding)
}

/** Detach an agent from whatever card it currently maps to. */
export async function detachThreadCardBinding(
  workspaceId: string,
  agentId: string
): Promise<boolean> {
  const db = getDb()
  const now = new Date()
  const updated = await db
    .update(operatorThreadCardBindings)
    .set({ detachedAt: now, updatedAt: now })
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.agentId, agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .returning({ id: operatorThreadCardBindings.id })
  return updated.length > 0
}
