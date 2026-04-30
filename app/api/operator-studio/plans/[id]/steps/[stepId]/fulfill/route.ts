import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getDb } from "@/lib/server/db/client"
import { operatorPlanSteps } from "@/lib/server/db/schema"
import { and, eq } from "drizzle-orm"

import {
  getSessionsForWorkspace,
  promoteToStep,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const VALID_TARGETS = new Set(["thread", "message"])

/**
 * POST /api/operator-studio/plans/[id]/steps/[stepId]/fulfill
 *
 * Plan-scoped sibling of the legacy session-scoped fulfill endpoint. Used by
 * the Atelier step modal's evidence picker.
 *
 * The route name still says "fulfill" for API compatibility. Product language
 * should treat this as accepting evidence for a plan step. The active work
 * session is resolved server-side and stored as provenance for when that
 * evidence was accepted.
 *
 * Body: { targetType: "thread" | "message", targetId: string, note?: string }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id: planId, stepId } = await ctx.params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  if (typeof body.targetType !== "string" || !VALID_TARGETS.has(body.targetType)) {
    return NextResponse.json(
      { error: "targetType must be 'thread' or 'message'" },
      { status: 400 }
    )
  }
  if (typeof body.targetId !== "string" || !body.targetId.trim()) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()

  // Verify the step actually belongs to this plan in this workspace.
  const db = getDb()
  const stepRow = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.id, stepId),
        eq(operatorPlanSteps.planId, planId),
        eq(operatorPlanSteps.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (stepRow.length === 0) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 })
  }

  // Pick the active work session — same heuristic the loader uses
  // (live within last 3h else most recent).
  const sessions = await getSessionsForWorkspace(workspaceId)
  if (sessions.length === 0) {
    return NextResponse.json(
      { error: "No active session — start one to attach evidence." },
      { status: 409 }
    )
  }
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
  const session =
    sessions.find((s) => new Date(s.endedAt).getTime() >= threeHoursAgo) ??
    sessions[0]

  const promotedBy = (await getDisplayName()) || "operator"

  const fulfillment = await promoteToStep(
    workspaceId,
    session.id,
    stepId,
    body.targetType as "thread" | "message",
    body.targetId.trim(),
    promotedBy,
    typeof body.note === "string" ? body.note : undefined
  )

  return NextResponse.json({ ok: true, fulfillment })
}
