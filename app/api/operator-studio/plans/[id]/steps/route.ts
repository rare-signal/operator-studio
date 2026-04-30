import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { setPlanSteps } from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** PUT /api/operator-studio/plans/[id]/steps — replace the step list. */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || !Array.isArray(body.steps)) {
    return NextResponse.json(
      { error: "Body must include {steps: Array}" },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  const steps = body.steps
    .filter(
      (s: unknown) =>
        s !== null && typeof s === "object" && "title" in (s as object)
    )
    .map((s: { id?: string; title: string; description?: string }) => ({
      id: typeof s.id === "string" ? s.id : undefined,
      title: s.title,
      description:
        typeof s.description === "string" ? s.description : undefined,
    }))
  const plan = await setPlanSteps(workspaceId, id, steps)
  if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ plan })
}
