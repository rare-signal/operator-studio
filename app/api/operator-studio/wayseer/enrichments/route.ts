import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { getLatestCompletedEnrichmentsForThreads } from "@/lib/operator-studio/wayseer/queries"
import type { ThreadAnalysis } from "@/lib/operator-studio/wayseer/contracts/thread-analysis"
import type { ThreadRollup } from "@/lib/operator-studio/wayseer/contracts/thread-rollup"

export const dynamic = "force-dynamic"

const MAX_IDS = 50
const SNIPPET_MAX_CHARS = 110

/**
 * Batch read for the sidebar enrichment one-liner.
 *
 * GET /api/operator-studio/wayseer/enrichments?threadIds=t1,t2,t3
 *   →  { snippets: { [threadId]: string } }
 *
 * Only returns threads with a completed enrichment. Threads without
 * one (or where no analysis has been run) are simply absent from the
 * map. The snippet is a one-line "what got done" — first bullet of
 * what_got_done if available, else a truncated attitude. We compute
 * it on the server so the client doesn't need to know the analysis
 * shape at all.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const raw = url.searchParams.get("threadIds") ?? ""
  const threadIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS)

  if (threadIds.length === 0) {
    return NextResponse.json({ snippets: {} })
  }

  const workspaceId = await getActiveWorkspaceId()
  const enrichments = await getLatestCompletedEnrichmentsForThreads(
    workspaceId,
    threadIds
  )

  const snippets: Record<string, string> = {}
  for (const [threadId, enrichment] of enrichments) {
    if (!enrichment.resultPayload) continue
    const snippet = pickSnippet(enrichment.resultPayload)
    if (snippet) snippets[threadId] = snippet
  }

  return NextResponse.json({ snippets })
}

/**
 * Pull a one-liner from any wayseer contract payload. The
 * enrichments table is shared across contract versions; this helper
 * dispatches by shape so a v1 thread-analysis row and a v2 thread-
 * rollup row both produce a sidebar-suitable snippet without the
 * caller knowing which one it got back.
 */
function pickSnippet(payload: ThreadAnalysis | ThreadRollup): string | null {
  const candidate = isV1Analysis(payload)
    ? payload.what_got_done.find((s) => s.trim().length > 0) ?? payload.attitude
    : payload.needToKnow.find((s) => s.trim().length > 0) ?? payload.vibe
  if (!candidate) return null
  const collapsed = candidate.replace(/\s+/g, " ").trim()
  if (collapsed.length <= SNIPPET_MAX_CHARS) return collapsed
  return collapsed.slice(0, SNIPPET_MAX_CHARS - 1).trimEnd() + "…"
}

function isV1Analysis(
  payload: ThreadAnalysis | ThreadRollup
): payload is ThreadAnalysis {
  return Array.isArray((payload as ThreadAnalysis).what_got_done)
}
