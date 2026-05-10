import "server-only"

import { and, asc, eq, isNotNull, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorThreadCardBindings,
  operatorWorkLanes,
  operatorWorkLaneMembership,
} from "@/lib/server/db/schema"
import { getThreadRoleStatus } from "./cockpit-execs"
import { getActiveBindingsForAgents } from "./thread-card-bindings"
import {
  getAppSessionEntry,
  type AppSlug,
} from "@/lib/server/agent-bridge/app-sessions"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

export type LaneMemberKind = "plan_step" | "kb_entry"

export interface WorkLane {
  id: string
  workspaceId: string
  name: string
  description: string | null
  execAgentId: string | null
  execAgentKind: string | null
  createdAt: string
  archivedAt: string | null
}

export interface WorkLaneMember {
  laneId: string
  memberKind: LaneMemberKind
  memberId: string
  addedAt: string
}

function rowToLane(
  row: typeof operatorWorkLanes.$inferSelect
): WorkLane {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    execAgentId: row.execAgentId,
    execAgentKind: row.execAgentKind,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }
}

function rowToMember(
  row: typeof operatorWorkLaneMembership.$inferSelect
): WorkLaneMember {
  return {
    laneId: row.laneId,
    memberKind: row.memberKind as LaneMemberKind,
    memberId: row.memberId,
    addedAt: row.addedAt.toISOString(),
  }
}

function newLaneId(): string {
  return `lane_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export async function createWorkLane(input: {
  workspaceId: string
  name: string
  description?: string | null
  execAgentId?: string | null
  execAgentKind?: string | null
  /** Optional override (used by migration backfill for stable ids). */
  id?: string
}): Promise<WorkLane> {
  const db = getDb()
  const id = input.id ?? newLaneId()
  const now = new Date()
  await db.insert(operatorWorkLanes).values({
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description ?? null,
    execAgentId: input.execAgentId ?? null,
    execAgentKind: input.execAgentKind ?? null,
    createdAt: now,
    archivedAt: null,
  })
  const fresh = await getWorkLane(id)
  if (!fresh) throw new Error("Failed to create work lane")
  return fresh
}

export async function getWorkLane(id: string): Promise<WorkLane | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorWorkLanes)
    .where(eq(operatorWorkLanes.id, id))
    .limit(1)
  return rows.length > 0 ? rowToLane(rows[0]) : null
}

export interface EnrichedWorkLaneExec {
  agentId: string
  agentKind: string
  label: string | null
  lastActivityAt: string | null
  isLive: boolean
}

export interface EnrichedWorkLane extends WorkLane {
  exec: EnrichedWorkLaneExec | null
  /** Active worker bindings spawned by this lane's exec. */
  liveWorkerCount: number
  /** Active bindings with berthier_reviewed_at set but human_approved_at
   *  not yet stamped — these are the workers awaiting David's eyes. */
  readyForReviewCount: number
}

/**
 * Enrich a set of lanes with per-lane at-a-glance metadata for the
 * cockpit entry picker:
 *   - exec label + last activity + liveness (resolved from JSONL on
 *     disk, best-effort; null if the exec session can't be located)
 *   - live worker count = active bindings spawned by this lane's exec
 *   - ready-for-review count = subset that are berthier-reviewed but
 *     not yet human-approved
 *
 * Lanes with no exec set return zeroed counts and a null exec entry.
 */
export async function enrichWorkLanes(
  lanes: WorkLane[]
): Promise<EnrichedWorkLane[]> {
  if (lanes.length === 0) return []
  const db = getDb()
  const execAgentIds = lanes
    .map((l) => l.execAgentId)
    .filter((id): id is string => !!id)

  // Count active + ready-for-review bindings per spawned_by agent in one query.
  const counts = new Map<
    string,
    { live: number; ready: number }
  >()
  if (execAgentIds.length > 0) {
    const rows = await db
      .select({
        spawnedByAgentId: operatorThreadCardBindings.spawnedByAgentId,
        berthierReviewedAt: operatorThreadCardBindings.berthierReviewedAt,
        humanApprovedAt: operatorThreadCardBindings.humanApprovedAt,
      })
      .from(operatorThreadCardBindings)
      .where(
        and(
          isNull(operatorThreadCardBindings.detachedAt),
          isNotNull(operatorThreadCardBindings.spawnedByAgentId)
        )
      )
    for (const r of rows) {
      const exec = r.spawnedByAgentId
      if (!exec || !execAgentIds.includes(exec)) continue
      const c = counts.get(exec) ?? { live: 0, ready: 0 }
      c.live += 1
      if (r.berthierReviewedAt && !r.humanApprovedAt) c.ready += 1
      counts.set(exec, c)
    }
  }

  return Promise.all(
    lanes.map(async (lane) => {
      let exec: EnrichedWorkLaneExec | null = null
      if (lane.execAgentId) {
        const parsed = parseAgentId(lane.execAgentId)
        if (parsed.kind === "claude" || parsed.kind === "codex") {
          const app: AppSlug = parsed.kind
          const entry = await getAppSessionEntry(app, parsed.ref).catch(
            () => null
          )
          exec = {
            agentId: lane.execAgentId,
            agentKind: lane.execAgentKind ?? parsed.kind,
            label: entry?.title?.slice(0, 60) ?? null,
            lastActivityAt: entry
              ? new Date(entry.mtimeMs).toISOString()
              : null,
            isLive: entry?.isLive ?? false,
          }
        } else {
          exec = {
            agentId: lane.execAgentId,
            agentKind: lane.execAgentKind ?? "claude",
            label: null,
            lastActivityAt: null,
            isLive: false,
          }
        }
      }
      const c = lane.execAgentId ? counts.get(lane.execAgentId) : undefined
      return {
        ...lane,
        exec,
        liveWorkerCount: c?.live ?? 0,
        readyForReviewCount: c?.ready ?? 0,
      }
    })
  )
}

export async function listWorkLanes(
  workspaceId: string,
  opts: { includeArchived?: boolean } = {}
): Promise<WorkLane[]> {
  const db = getDb()
  const conds = [eq(operatorWorkLanes.workspaceId, workspaceId)]
  if (!opts.includeArchived) conds.push(isNull(operatorWorkLanes.archivedAt))
  const rows = await db
    .select()
    .from(operatorWorkLanes)
    .where(and(...conds))
    .orderBy(asc(operatorWorkLanes.createdAt))
  return rows.map(rowToLane)
}

export async function archiveWorkLane(id: string): Promise<WorkLane | null> {
  const db = getDb()
  await db
    .update(operatorWorkLanes)
    .set({ archivedAt: new Date() })
    .where(eq(operatorWorkLanes.id, id))
  return getWorkLane(id)
}

/**
 * Set or clear the lane's exec. Enforces the role-conflict guard from
 * cockpit-execs.ts: a thread already bound as a worker in this
 * workspace cannot be promoted.
 *
 * Throws `LaneExecConflictError` if the candidate is already a worker.
 */
export class LaneExecConflictError extends Error {
  readonly code = "lane_exec_conflict"
  readonly conflictingPlanStepId: string | null
  constructor(message: string, conflictingPlanStepId: string | null) {
    super(message)
    this.conflictingPlanStepId = conflictingPlanStepId
  }
}

export async function setLaneExec(
  laneId: string,
  exec: { agentId: string; agentKind: string } | null
): Promise<WorkLane | null> {
  const db = getDb()
  if (exec) {
    const lane = await getWorkLane(laneId)
    if (!lane) throw new Error(`Unknown lane: ${laneId}`)
    const role = await getThreadRoleStatus(lane.workspaceId, exec.agentId)
    if (role === "worker") {
      const active = await getActiveBindingsForAgents(lane.workspaceId, [
        exec.agentId,
      ])
      throw new LaneExecConflictError(
        `Thread ${exec.agentId} is currently a worker; detach before promoting to lane exec.`,
        active[0]?.planStepId ?? null
      )
    }
    await db
      .update(operatorWorkLanes)
      .set({ execAgentId: exec.agentId, execAgentKind: exec.agentKind })
      .where(eq(operatorWorkLanes.id, laneId))
  } else {
    await db
      .update(operatorWorkLanes)
      .set({ execAgentId: null, execAgentKind: null })
      .where(eq(operatorWorkLanes.id, laneId))
  }
  return getWorkLane(laneId)
}

export async function addLaneMember(
  laneId: string,
  memberKind: LaneMemberKind,
  memberId: string
): Promise<WorkLaneMember> {
  const db = getDb()
  const now = new Date()
  await db
    .insert(operatorWorkLaneMembership)
    .values({ laneId, memberKind, memberId, addedAt: now })
    .onConflictDoNothing()
  const rows = await db
    .select()
    .from(operatorWorkLaneMembership)
    .where(
      and(
        eq(operatorWorkLaneMembership.laneId, laneId),
        eq(operatorWorkLaneMembership.memberKind, memberKind),
        eq(operatorWorkLaneMembership.memberId, memberId)
      )
    )
    .limit(1)
  if (rows.length === 0) throw new Error("Failed to add lane member")
  return rowToMember(rows[0])
}

export async function removeLaneMember(
  laneId: string,
  memberKind: LaneMemberKind,
  memberId: string
): Promise<void> {
  const db = getDb()
  await db
    .delete(operatorWorkLaneMembership)
    .where(
      and(
        eq(operatorWorkLaneMembership.laneId, laneId),
        eq(operatorWorkLaneMembership.memberKind, memberKind),
        eq(operatorWorkLaneMembership.memberId, memberId)
      )
    )
}

export async function listLaneMembers(
  laneId: string
): Promise<WorkLaneMember[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorWorkLaneMembership)
    .where(eq(operatorWorkLaneMembership.laneId, laneId))
    .orderBy(asc(operatorWorkLaneMembership.addedAt))
  return rows.map(rowToMember)
}

/**
 * Migration helper used by the apply script AND by the acceptance gate
 * to verify that every workspace has at least one active lane. Returns
 * the count of lanes inserted.
 */
export async function backfillDefaultLanes(): Promise<{
  inserted: number
  workspaces: string[]
}> {
  const db = getDb()
  // Pull workspaces that have no active lane yet, joined with their
  // cockpit-exec row if any.
  const rows = await db.execute<{
    workspace_id: string
    agent_id: string | null
    agent_kind: string | null
  }>(/* sql */ `
    SELECT w.id AS workspace_id,
           ce.agent_id,
           ce.agent_kind
      FROM workspaces w
      LEFT JOIN operator_cockpit_execs ce ON ce.workspace_id = w.id
      LEFT JOIN operator_work_lanes wl
        ON wl.workspace_id = w.id AND wl.archived_at IS NULL
     WHERE wl.id IS NULL
  `)
  // drizzle's execute() returns a result with `.rows`. Be defensive
  // in case of driver differences.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = ((rows as any).rows ?? rows ?? []) as Array<{
    workspace_id: string
    agent_id: string | null
    agent_kind: string | null
  }>
  const workspaces: string[] = []
  for (const r of list) {
    const id = `lane_default_${r.workspace_id}`
    await createWorkLane({
      id,
      workspaceId: r.workspace_id,
      name: "Default lane",
      description: "Auto-created from the workspace's existing cockpit exec.",
      execAgentId: r.agent_id,
      execAgentKind: r.agent_kind,
    }).catch(() => null)
    workspaces.push(r.workspace_id)
  }
  return { inserted: workspaces.length, workspaces }
}
