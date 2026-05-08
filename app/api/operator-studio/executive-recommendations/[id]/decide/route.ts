import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  decideExecutiveRecommendation,
  type ExecutiveDecision,
} from "@/lib/operator-studio/executive-recommendations"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const ALLOWED: ExecutiveDecision[] = [
  "approve",
  "reject",
  "mark_executed",
  "supersede",
]

/** POST /api/operator-studio/executive-recommendations/[id]/decide
 *  Body: { action, executionNote? } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  if (!(await isAdmin(auth)))
    return NextResponse.json({ error: "admin only" }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as ExecutiveDecision | undefined
  if (!action || !ALLOWED.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of ${ALLOWED.join("|")}` },
      { status: 400 }
    )
  }

  const workspaceId = await getActiveWorkspaceId()
  const rec = await decideExecutiveRecommendation(workspaceId, id, action, {
    executionNote:
      typeof body.executionNote === "string" ? body.executionNote : null,
  })
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ item: rec })
}
