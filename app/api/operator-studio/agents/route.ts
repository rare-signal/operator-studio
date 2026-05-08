/**
 * GET /api/operator-studio/agents
 *
 * Combined live-agent list for the Bento command center: tmux sessions
 * on the workstation, plus the latest N Claude Code and Codex JSONL
 * sessions on disk.
 *
 * Query params:
 *   appLimit (default 8) — per-app cap on JSONL sessions returned
 *
 * Each entry has a composite id (tmux:<name> / claude:<uuid> /
 * codex:<uuid>) the client uses for snapshot/send routes. Read-only —
 * never mutates anything on disk.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { listTmuxSessions } from "@/lib/server/agent-bridge/tmux"
import { listAppSessions } from "@/lib/server/agent-bridge/app-sessions"
import type { AgentListItem } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const appLimitRaw = Number(
    req.nextUrl.searchParams.get("appLimit") ?? 8
  )
  const appLimit = Math.max(1, Math.min(40, appLimitRaw || 8))

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
      // tmux read API only tells us "attached" + activity. Map that to
      // a coarse status so the UI can use the same dot palette.
      status: isLive ? "streaming" : "idle",
      project: s.command || null,
      title: null,
      isLive,
    })
  }

  for (const c of claude) {
    items.push({
      id: `claude:${c.id}`,
      kind: "claude",
      label: c.title?.slice(0, 60) ?? c.id.slice(0, 8),
      source: "claude",
      lastActivityAt: new Date(c.mtimeMs).toISOString(),
      status: c.isLive ? "streaming" : "idle",
      project: c.project,
      title: c.title,
      isLive: c.isLive,
    })
  }

  for (const c of codex) {
    items.push({
      id: `codex:${c.id}`,
      kind: "codex",
      label: c.title?.slice(0, 60) ?? c.id.slice(0, 8),
      source: "codex",
      lastActivityAt: new Date(c.mtimeMs).toISOString(),
      status: c.isLive ? "streaming" : "idle",
      project: c.project,
      title: c.title,
      isLive: c.isLive,
    })
  }

  // Sort: live up top, then most recent.
  items.sort((a, b) => {
    if (a.isLive !== b.isLive) return a.isLive ? -1 : 1
    return b.lastActivityAt.localeCompare(a.lastActivityAt)
  })

  return NextResponse.json({
    agents: items,
    fetchedAt: new Date().toISOString(),
  })
}
