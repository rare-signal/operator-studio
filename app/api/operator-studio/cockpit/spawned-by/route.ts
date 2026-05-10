/**
 * GET /api/operator-studio/cockpit/spawned-by?exec=<agentId>
 *
 * Returns the composite agent ids of bindings whose
 * `spawned_by_agent_id` matches the provided executive agent id, plus
 * a `workers` array with stable per-binding sequence numbers (1..N) so
 * the cockpit can render "Worker N" labels that don't shift when a
 * worker is marked done.
 *
 * Each active worker entry is enriched with the same metadata shape as
 * /api/operator-studio/agents (label/source/lastActivityAt/status/
 * project/title/isLive) so the cockpit can render the spawned-by
 * drawer directly without intersecting against the recent-agents list.
 * Aged-out workers stay visible as long as their binding is active.
 *
 * Response shape:
 *   {
 *     agentIds: string[]      // active only — back-compat
 *     workers: Array<{
 *       agentId: string,
 *       sequence: number,
 *       active: boolean,
 *       spawnedAt: string,
 *       agentKind: string,
 *       label: string | null,
 *       source: "claude" | "codex" | "tmux",
 *       lastActivityAt: string | null,
 *       status: AgentListItem["status"],
 *       project: string | null,
 *       title: string | null,
 *       isLive: boolean,
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
import {
  getAppSessionEntry,
  getAppSessionTail,
  type AppSlug,
} from "@/lib/server/agent-bridge/app-sessions"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

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

  const seen = new Set<string>()
  const all = [...active, ...detached].filter((b) => {
    if (seen.has(b.id)) return false
    seen.add(b.id)
    return true
  })

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
      prior.active = true
    }
  }

  const ordered = Array.from(firstByAgent.values())
    .sort((a, b) => a.spawnedAt.localeCompare(b.spawnedAt))
    .map((w, i) => ({ ...w, sequence: i + 1 }))

  // Enrich active workers with full metadata. Detached workers don't
  // render in the active drawer so we skip the JSONL lookup for them.
  const workers = await Promise.all(
    ordered.map(async (w) => {
      if (!w.active) {
        return {
          ...w,
          label: null as string | null,
          source: w.agentKind as "claude" | "codex" | "tmux",
          lastActivityAt: null as string | null,
          status: "idle" as const,
          project: null as string | null,
          title: null as string | null,
          isLive: false,
        }
      }
      const parsed = parseAgentId(w.agentId)
      if (parsed.kind !== "claude" && parsed.kind !== "codex") {
        return {
          ...w,
          label: null,
          source: w.agentKind as "claude" | "codex" | "tmux",
          lastActivityAt: null,
          status: "idle" as const,
          project: null,
          title: null,
          isLive: false,
        }
      }
      const app: AppSlug = parsed.kind
      const entry = await getAppSessionEntry(app, parsed.ref).catch(() => null)
      if (!entry) {
        return {
          ...w,
          label: null,
          source: app,
          lastActivityAt: null,
          status: "idle" as const,
          project: null,
          title: null,
          isLive: false,
        }
      }
      // Status comes from parsing the JSONL tail (matches the
      // recent-agents endpoint's behavior). Best-effort — fallback to a
      // mtime-derived coarse status if the tail parse fails.
      let status: "idle" | "thinking" | "streaming" | "tool-running" =
        entry.isLive ? "streaming" : "idle"
      try {
        const tail = await getAppSessionTail(app, parsed.ref, 12)
        if (!("error" in tail)) status = tail.status
      } catch {
        /* keep mtime-derived fallback */
      }
      return {
        ...w,
        label: entry.title?.slice(0, 60) ?? entry.id.slice(0, 8),
        source: app,
        lastActivityAt: new Date(entry.mtimeMs).toISOString(),
        status,
        project: entry.project,
        title: entry.title,
        isLive: entry.isLive,
      }
    })
  )

  const agentIds = Array.from(new Set(active.map((b) => b.agentId)))
  return NextResponse.json({ agentIds, workers })
}
