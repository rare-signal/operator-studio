import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getContinuumById } from "@/lib/operator-studio/continuum"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/continuum/[id] — read a persisted handoff.
 *  Used by the read-only `/operator-studio/continuum/[id]` page and by
 *  any external poller (e.g. the dialog that just minted one). */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const continuum = await getContinuumById(workspaceId, id)
  if (!continuum)
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ continuum })
}
