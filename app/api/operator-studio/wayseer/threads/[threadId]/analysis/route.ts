import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { getLatestEnrichmentForThread } from "@/lib/operator-studio/wayseer/runner"
import { CONTRACT_VERSION } from "@/lib/operator-studio/wayseer/contracts/thread-analysis"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/wayseer/threads/[threadId]/analysis
 *
 * Returns the most recent enrichment row for the thread (any status).
 * Body shape:
 *
 *   { enrichment: ThreadEnrichmentRow | null,
 *     contractVersion: string }
 *
 * The frontend uses contractVersion to decide whether the stored row
 * is stale — if the row's contractVersion doesn't match the current
 * one we surface a "rerun" affordance.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const { threadId } = await params
  if (!threadId.trim()) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const enrichment = await getLatestEnrichmentForThread(workspaceId, threadId)

  return NextResponse.json({
    enrichment,
    contractVersion: CONTRACT_VERSION,
  })
}
