/**
 * GET /api/operator-studio/agents/:id/snapshot?lines=N
 *
 * Returns a compact snapshot for one agent so a Bento pane can render
 * "what's happening right now":
 *   - tmux:<name>  → last `lines` lines of pane scrollback (text)
 *   - claude:<id>  → last `lines` parsed turns from the JSONL
 *   - codex:<id>   → same as claude, codex variant
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { captureTmuxPane } from "@/lib/server/agent-bridge/tmux"
import { getAppSessionTail } from "@/lib/server/agent-bridge/app-sessions"
import { isValidJsonlId, isValidSessionName } from "@/lib/server/agent-bridge/exec"
import { parseAgentId } from "@/lib/server/agent-bridge/types"
import type { AgentSnapshot } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const { id } = await ctx.params
  const parsed = parseAgentId(decodeURIComponent(id))
  if (parsed.kind === null) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const linesRaw = Number(req.nextUrl.searchParams.get("lines") ?? 18)
  const lines = Math.max(4, Math.min(2000, linesRaw || 18))

  if (parsed.kind === "tmux") {
    if (!isValidSessionName(parsed.ref)) {
      return NextResponse.json(
        { error: "Invalid tmux session name" },
        { status: 400 }
      )
    }
    const cap = await captureTmuxPane(parsed.ref, lines)
    if ("error" in cap) {
      return NextResponse.json({ error: cap.error }, { status: 404 })
    }
    const trimmed = cap.content
      .split("\n")
      .slice(-lines)
      .join("\n")
    const snapshot: AgentSnapshot = {
      id: `tmux:${parsed.ref}`,
      kind: "tmux",
      capturedAt: cap.capturedAt,
      // tmux capture is text-only; we don't have a real status enum.
      // Heuristic: if the trailing line looks like a shell prompt we
      // call it idle, else streaming. Cheap and good enough.
      status: /[#$>]\s*$/.test(trimmed.trim()) ? "idle" : "streaming",
      text: trimmed,
    }
    return NextResponse.json(snapshot)
  }

  if (!isValidJsonlId(parsed.ref)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 })
  }
  const tail = await getAppSessionTail(parsed.kind, parsed.ref, lines)
  if ("error" in tail) {
    return NextResponse.json({ error: tail.error }, { status: tail.status })
  }
  const snapshot: AgentSnapshot = {
    id: `${parsed.kind}:${parsed.ref}` as AgentSnapshot["id"],
    kind: parsed.kind,
    capturedAt: new Date().toISOString(),
    status: tail.status,
    turns: tail.turns,
    fileMtime: tail.fileMtime,
    pendingBytes: tail.pendingBytes,
  }
  return NextResponse.json(snapshot)
}
