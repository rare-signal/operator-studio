import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getClaudeSessionRoots } from "@/lib/operator-studio/importers/claude-code"
import { getCodexSessionRoots } from "@/lib/operator-studio/importers/codex"
import { getOpencodeStorageRoots } from "@/lib/operator-studio/importers/opencode"
import { isWatcherEnabled } from "@/lib/operator-studio/watcher"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/watcher-status
 *
 * Reports whether the file watcher is active and which session
 * directories it's watching. Used by the sessions page "live"
 * indicator.
 *
 * Caveats:
 * - We can't directly query the watcher handle from instrumentation
 *   across route invocations (no shared state module). Instead we
 *   report whether it SHOULD be running based on env + which roots
 *   exist. For Phase 3 this is close enough to the truth.
 * - In serverless environments isWatcherEnabled returns false, so
 *   the UI correctly shows "not watching."
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const enabled = isWatcherEnabled()
  const roots = enabled
    ? [
        ...getClaudeSessionRoots().map((r) => ({ source: "claude", root: r })),
        ...getCodexSessionRoots().map((r) => ({ source: "codex", root: r })),
        ...getOpencodeStorageRoots().map((r) => ({
          source: "opencode",
          root: r,
        })),
      ]
    : []

  return NextResponse.json({
    enabled,
    watching: enabled && roots.length > 0,
    roots,
  })
}
