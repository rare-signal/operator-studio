import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { setPlanPinned } from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** POST /api/operator-studio/plans/[id]/pin — body {pinned: boolean} */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body.pinned !== "boolean") {
    return NextResponse.json(
      { error: "Body must include {pinned: boolean}" },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  const plan = await setPlanPinned(workspaceId, id, body.pinned)
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ plan })
}
