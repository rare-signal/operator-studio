import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { setPlanState } from "@/lib/operator-studio/plans"
import type { OperatorPlanState } from "@/lib/operator-studio/types"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const ALLOWED: OperatorPlanState[] = [
  "drafting",
  "active",
  "paused",
  "shipped",
  "archived",
]

/** POST /api/operator-studio/plans/[id]/state — body {state: OperatorPlanState} */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || !ALLOWED.includes(body.state)) {
    return NextResponse.json(
      { error: `Body must include {state: ${ALLOWED.join("|")}}` },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  const plan = await setPlanState(workspaceId, id, body.state)
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ plan })
}
