import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getPlanById, updatePlan } from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/plans/[id] */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const plan = await getPlanById(workspaceId, id)
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ plan })
}

/** PATCH /api/operator-studio/plans/[id] — update title/goal/outcome/owner */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const plan = await updatePlan(workspaceId, id, {
    title: typeof body.title === "string" ? body.title : undefined,
    goal:
      body.goal === null || typeof body.goal === "string"
        ? body.goal
        : undefined,
    outcome:
      body.outcome === null || typeof body.outcome === "string"
        ? body.outcome
        : undefined,
    ownerName:
      body.ownerName === null || typeof body.ownerName === "string"
        ? body.ownerName
        : undefined,
  })
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ plan })
}
