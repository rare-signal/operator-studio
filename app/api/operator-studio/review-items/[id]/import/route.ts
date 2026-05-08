import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { importReviewItemAsPlanStep } from "@/lib/operator-studio/review-items"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** POST /api/operator-studio/review-items/[id]/import
 *  Body: { planId: string, parentStepId?: string } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (typeof body.planId !== "string" || !body.planId) {
    return NextResponse.json({ error: "planId required" }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const result = await importReviewItemAsPlanStep(workspaceId, id, {
    planId: body.planId,
    parentStepId:
      typeof body.parentStepId === "string" ? body.parentStepId : null,
  })
  if (!result)
    return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json(result)
}
