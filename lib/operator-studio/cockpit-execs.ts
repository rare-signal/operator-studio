import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorCockpitExecs,
  operatorThreadCardBindings,
} from "@/lib/server/db/schema"

export type ThreadRoleStatus = "exec" | "worker" | "available"

export interface CockpitExec {
  workspaceId: string
  agentId: string
  agentKind: string
  updatedAt: string
}

function rowToExec(
  row: typeof operatorCockpitExecs.$inferSelect
): CockpitExec {
  return {
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    agentKind: row.agentKind,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function getCockpitExec(
  workspaceId: string
): Promise<CockpitExec | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorCockpitExecs)
    .where(eq(operatorCockpitExecs.workspaceId, workspaceId))
    .limit(1)
  return rows.length > 0 ? rowToExec(rows[0]) : null
}

export async function listAllCockpitExecs(): Promise<CockpitExec[]> {
  const db = getDb()
  const rows = await db.select().from(operatorCockpitExecs)
  return rows.map(rowToExec)
}

export async function setCockpitExec(input: {
  workspaceId: string
  agentId: string
  agentKind: string
}): Promise<CockpitExec> {
  const db = getDb()
  const now = new Date()
  await db
    .insert(operatorCockpitExecs)
    .values({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      agentKind: input.agentKind,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: operatorCockpitExecs.workspaceId,
      set: {
        agentId: input.agentId,
        agentKind: input.agentKind,
        updatedAt: now,
      },
    })
  const fresh = await getCockpitExec(input.workspaceId)
  if (!fresh) throw new Error("Failed to set cockpit exec")
  return fresh
}

export async function clearCockpitExec(workspaceId: string): Promise<void> {
  const db = getDb()
  await db
    .delete(operatorCockpitExecs)
    .where(eq(operatorCockpitExecs.workspaceId, workspaceId))
}

/**
 * Mutually-exclusive role status for a (workspace, agent) pair.
 *   exec       — currently the workspace's cockpit exec
 *   worker     — has an active (non-detached) thread-card binding in the workspace
 *   available  — neither of the above
 */
export async function getThreadRoleStatus(
  workspaceId: string,
  agentId: string
): Promise<ThreadRoleStatus> {
  const db = getDb()

  const execRows = await db
    .select({ agentId: operatorCockpitExecs.agentId })
    .from(operatorCockpitExecs)
    .where(
      and(
        eq(operatorCockpitExecs.workspaceId, workspaceId),
        eq(operatorCockpitExecs.agentId, agentId)
      )
    )
    .limit(1)
  if (execRows.length > 0) return "exec"

  const bindingRows = await db
    .select({ id: operatorThreadCardBindings.id })
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.agentId, agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .limit(1)
  if (bindingRows.length > 0) return "worker"

  return "available"
}

export async function getThreadRoleStatuses(
  workspaceId: string,
  agentIds: string[]
): Promise<Map<string, ThreadRoleStatus>> {
  const out = new Map<string, ThreadRoleStatus>()
  if (agentIds.length === 0) return out

  const db = getDb()
  const execAgents = new Set(
    (
      await db
        .select({ agentId: operatorCockpitExecs.agentId })
        .from(operatorCockpitExecs)
        .where(eq(operatorCockpitExecs.workspaceId, workspaceId))
    ).map((r) => r.agentId)
  )

  const workerAgents = new Set(
    (
      await db
        .select({ agentId: operatorThreadCardBindings.agentId })
        .from(operatorThreadCardBindings)
        .where(
          and(
            eq(operatorThreadCardBindings.workspaceId, workspaceId),
            isNull(operatorThreadCardBindings.detachedAt)
          )
        )
    ).map((r) => r.agentId)
  )

  for (const id of agentIds) {
    if (execAgents.has(id)) out.set(id, "exec")
    else if (workerAgents.has(id)) out.set(id, "worker")
    else out.set(id, "available")
  }
  return out
}
