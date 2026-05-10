/**
 * GET /api/operator-studio/cockpit/threads?workspaceId=<id>&appLimit=<n>
 *
 * Candidate threads for the cockpit lane dropdown. Mirrors the shape of
 * /api/operator-studio/agents and adds a `roleStatus` field per row
 * ("exec" | "worker" | "available") derived from cockpit-execs +
 * thread-card-bindings, so the UI can disable the wrong-role rows in
 * the exec-picker section.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getThreadRoleStatuses } from "@/lib/operator-studio/cockpit-execs"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { listAppSessions } from "@/lib/server/agent-bridge/app-sessions"
import { listTmuxSessions } from "@/lib/server/agent-bridge/tmux"
import type { AgentListItem } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId =
    req.nextUrl.searchParams.get("workspaceId")?.trim() ||
    (await getActiveWorkspaceId())

  const appLimitRaw = Number(req.nextUrl.searchParams.get("appLimit") ?? 12)
  const appLimit = Math.max(1, Math.min(40, appLimitRaw || 12))

  const [tmux, claude, codex] = await Promise.all([
    listTmuxSessions().catch(() => []),
    listAppSessions("claude", appLimit).catch(() => []),
    listAppSessions("codex", appLimit).catch(() => []),
  ])

  const now = Date.now()
  const items: AgentListItem[] = []

  for (const s of tmux) {
    const ageMs = Math.max(0, now - new Date(s.lastActivityAt).getTime())
    const isLive = s.attached || ageMs < 5_000
    items.push({
      id: `tmux:${s.name}`,
      kind: "tmux",
      label: s.name,
      source: "tmux",
      lastActivityAt: s.lastActivityAt,
      status: isLive ? "streaming" : "idle",
      project: s.command || null,
      title: null,
      isLive,
    })
  }

  for (const s of claude) {
    items.push({
      id: `claude:${s.id}`,
      kind: "claude",
      label: s.title?.slice(0, 60) ?? s.id.slice(0, 8),
      source: "claude",
      lastActivityAt: new Date(s.mtimeMs).toISOString(),
      status: s.isLive ? "streaming" : "idle",
      project: s.project,
      title: s.title,
      isLive: s.isLive,
    })
  }

  for (const s of codex) {
    items.push({
      id: `codex:${s.id}`,
      kind: "codex",
      label: s.title?.slice(0, 60) ?? s.id.slice(0, 8),
      source: "codex",
      lastActivityAt: new Date(s.mtimeMs).toISOString(),
      status: s.isLive ? "streaming" : "idle",
      project: s.project,
      title: s.title,
      isLive: s.isLive,
    })
  }

  items.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))

  const roleMap = await getThreadRoleStatuses(
    workspaceId,
    items.map((i) => i.id)
  )

  const threads = items.map((a) => ({
    ...a,
    roleStatus: roleMap.get(a.id) ?? ("available" as const),
  }))

  return NextResponse.json({ workspaceId, threads })
}
