import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { backfillCodexTurnIds } from "@/lib/operator-studio/codex-backfill"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * POST /api/operator-studio/admin/codex-backfill
 *
 * One-shot enrichment pass for existing Codex threads — re-parses the
 * source `.jsonl` and stamps `codex_turn_id` into each message's
 * `metadataJson`. Required after rolling out the parser change that
 * captures `turn_id`, since already-imported rows have null metadata
 * and per-turn deep links won't render without it.
 *
 * Idempotent. Scopes to the active workspace by default; pass
 * `?all=1` to scan every workspace.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const all = searchParams.get("all") === "1"
  const workspaceId = all ? undefined : await getActiveWorkspaceId()

  const result = await backfillCodexTurnIds(workspaceId)
  return NextResponse.json(result)
}
