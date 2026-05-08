/**
 * GET /api/operator-studio/agents/recent
 *
 * "What just happened lately?" — current-tail-derived activity for the
 * Bento command center. Unlike GET /api/operator-studio/agents (which
 * returns the first-user-prompt as `title`), this endpoint surfaces:
 *   - latest user instruction in the tail
 *   - latest assistant status text
 *   - latest tool / file activity
 *   - a best-effort plan-card id sniffed from recent content
 * and clearly labels the first-prompt-derived field as `staleTitle`
 * so callers (Codex, Claude, the Bento UI) don't confuse it with
 * current state.
 *
 * Query params:
 *   appLimit       (default 8)   — per-app cap on JSONL sessions scanned
 *   recentTurns    (default 12)  — trailing turns to keep per session
 *   tmuxLines      (default 60)  — trailing tmux capture lines
 *   freshWithinMs  (optional)    — drop sessions inactive longer than this
 *   limit          (default 12)  — cap on returned items
 *   includeTmux    (default 1)   — set to 0 to omit tmux sessions
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getRecentAgentActivity } from "@/lib/server/agent-bridge/recent-activity"

export const dynamic = "force-dynamic"

function num(req: NextRequest, key: string, fallback: number): number {
  const raw = req.nextUrl.searchParams.get(key)
  if (raw === null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const appLimit = num(req, "appLimit", 8)
  const recentTurns = num(req, "recentTurns", 12)
  const tmuxLines = num(req, "tmuxLines", 60)
  const freshWithinMs = num(req, "freshWithinMs", 0)
  const limit = num(req, "limit", 12)
  const includeTmuxRaw = req.nextUrl.searchParams.get("includeTmux")
  const includeTmux =
    includeTmuxRaw === null ? true : includeTmuxRaw !== "0" && includeTmuxRaw !== "false"

  const items = await getRecentAgentActivity({
    appLimit,
    recentTurns,
    tmuxLines,
    freshWithinMs: freshWithinMs > 0 ? freshWithinMs : undefined,
    limit,
    includeTmux,
  })

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    note: "staleTitle is first-prompt-derived and may not reflect current state. Trust latestUserInstruction / latestAssistantStatus / latestToolActivity / latestFileActivity.",
    items,
  })
}
