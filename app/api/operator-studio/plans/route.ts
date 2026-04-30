import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { createPlan, listPlans } from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/plans — list all plans for the active workspace. */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const workspaceId = await getActiveWorkspaceId()
  const plans = await listPlans(workspaceId)
  return NextResponse.json({ plans, count: plans.length })
}

/** POST /api/operator-studio/plans — create a new plan, optionally with
 *  initial steps; optionally attach to a session.
 *  Body: {title, goal?, outcome?, pinned?, ownerName?, steps?, attachToSessionId?, state?} */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.title !== "string") {
    return NextResponse.json(
      { error: "Body must include at least {title}" },
      { status: 400 }
    )
  }

  const workspaceId = await getActiveWorkspaceId()
  const reviewer =
    auth.identity ?? (await getDisplayName()) ?? "unknown"
  const plan = await createPlan({
    workspaceId,
    title: body.title,
    goal: body.goal ?? null,
    outcome: body.outcome ?? null,
    pinned: body.pinned === true,
    ownerName: body.ownerName ?? null,
    createdBy: reviewer,
    steps: Array.isArray(body.steps) ? body.steps : undefined,
    attachToSessionId:
      typeof body.attachToSessionId === "string"
        ? body.attachToSessionId
        : undefined,
    state: body.state,
  })
  return NextResponse.json({ plan })
}
