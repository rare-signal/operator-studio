/**
 * GET /api/operator-studio/cockpit/spawned-by?exec=<agentId>
 *
 * Returns the composite agent ids of bindings whose
 * `spawned_by_agent_id` matches the provided executive agent id, plus
 * a `workers` array with stable per-binding sequence numbers (1..N) so
 * the cockpit can render "Worker N" labels that don't shift when a
 * worker is marked done.
 *
 * Response shape:
 *   {
 *     agentIds: string[]      // active only — back-compat
 *     workers: Array<{
 *       agentId: string,
 *       sequence: number,     // 1-indexed across active+detached
 *       active: boolean,
 *       spawnedAt: string,    // binding.createdAt ISO
 *       agentKind: string,
 *     }>
 *   }
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getActiveBindingsSpawnedBy,
  getRecentlyDetachedBindingsSpawnedBy,
} from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const exec = req.nextUrl.searchParams.get("exec")?.trim()
  if (!exec) {
    return NextResponse.json({ error: "exec required" }, { status: 400 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const [active, detached] = await Promise.all([
    getActiveBindingsSpawnedBy(workspaceId, exec),
    getRecentlyDetachedBindingsSpawnedBy(workspaceId, exec, 200),
  ])

  // Dedupe by binding.id (defensive — primitives shouldn't overlap, but
  // a binding flipping state mid-fetch is harmless to coalesce).
  const seen = new Set<string>()
  const all = [...active, ...detached].filter((b) => {
    if (seen.has(b.id)) return false
    seen.add(b.id)
    return true
  })

  // First-seen-per-agent across the spawn timeline — the sequence is
  // owned by the agent's first binding under this exec, so re-binding
  // the same agent to a new card doesn't bump its number.
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const firstByAgent = new Map<
    string,
    { agentId: string; agentKind: string; spawnedAt: string; active: boolean }
  >()
  for (const b of all) {
    const prior = firstByAgent.get(b.agentId)
    if (!prior) {
      firstByAgent.set(b.agentId, {
        agentId: b.agentId,
        agentKind: b.agentKind,
        spawnedAt: b.createdAt,
        active: b.detachedAt === null,
      })
    } else if (b.detachedAt === null) {
      // Promote to active if any binding for this agent is currently active.
      prior.active = true
    }
  }

  const workers = Array.from(firstByAgent.values())
    .sort((a, b) => a.spawnedAt.localeCompare(b.spawnedAt))
    .map((w, i) => ({ ...w, sequence: i + 1 }))

  const agentIds = Array.from(new Set(active.map((b) => b.agentId)))
  return NextResponse.json({ agentIds, workers })
}
