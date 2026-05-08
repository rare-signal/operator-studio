import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  decideReviewItem,
  type DecisionAction,
} from "@/lib/operator-studio/review-items"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const ALLOWED: DecisionAction[] = ["promote", "reject", "snooze"]

/** POST /api/operator-studio/review-items/[id]/decide
 *  Body: { action: "promote" | "reject" | "snooze", snoozeUntil?: ISO } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as DecisionAction | undefined
  if (!action || !ALLOWED.includes(action)) {
    return NextResponse.json(
      { error: `action must be one of ${ALLOWED.join("|")}` },
      { status: 400 }
    )
  }

  const workspaceId = await getActiveWorkspaceId()
  const item = await decideReviewItem(workspaceId, id, action, {
    snoozeUntil:
      typeof body.snoozeUntil === "string" ? body.snoozeUntil : undefined,
  })
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ item })
}
