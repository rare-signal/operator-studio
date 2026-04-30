import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { deletePlanStep, updatePlanStep } from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const VALID_STATUSES = new Set([
  "open",
  "in-motion",
  "covered",
  "skipped",
])

/**
 * PATCH /api/operator-studio/plans/[id]/steps/[stepId]
 *
 * Surgical update — title, description, and/or status. Any subset.
 * Preferred over the wholesale PUT /steps endpoint for in-place edits
 * because it preserves untouched rows (status, fulfillments, ordering).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id, stepId } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  const status =
    typeof body.status === "string" && VALID_STATUSES.has(body.status)
      ? (body.status as "open" | "in-motion" | "covered" | "skipped")
      : undefined

  const parentStepId =
    body.parentStepId === null
      ? null
      : typeof body.parentStepId === "string"
        ? body.parentStepId
        : undefined

  const positionX =
    body.positionX === null
      ? null
      : typeof body.positionX === "number" && Number.isFinite(body.positionX)
        ? body.positionX
        : undefined
  const positionY =
    body.positionY === null
      ? null
      : typeof body.positionY === "number" && Number.isFinite(body.positionY)
        ? body.positionY
        : undefined

  const workspaceId = await getActiveWorkspaceId()
  const plan = await updatePlanStep(workspaceId, id, stepId, {
    title: typeof body.title === "string" ? body.title : undefined,
    description:
      body.description === null
        ? null
        : typeof body.description === "string"
          ? body.description
          : undefined,
    status,
    parentStepId,
    positionX,
    positionY,
  })
  if (!plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ plan })
}

/** DELETE — remove a single step in place. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id, stepId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const plan = await deletePlanStep(workspaceId, id, stepId)
  if (!plan) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ plan })
}
