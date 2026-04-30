import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getThreadPreviews } from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const MAX_IDS = 100

/**
 * Bulk thread-bookend previews for the recent-rail hover popover.
 * Caller passes ?ids=a,b,c and gets back `{ previews: { [id]: {...} } }`
 * with first/last user + assistant messages and message counts. The
 * rail pre-warms this on mount so hover is instant (no per-item fetch).
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const idsParam = new URL(req.url).searchParams.get("ids")
  if (!idsParam) {
    return NextResponse.json({ previews: {} })
  }
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS)
  if (ids.length === 0) {
    return NextResponse.json({ previews: {} })
  }
  const previews = await getThreadPreviews(workspaceId, ids)
  return NextResponse.json({ previews })
}
