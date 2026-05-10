import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import {
  getFulfillmentsForSession,
  getPassageById,
  getSessionById,
  promoteToStep,
  unpromoteFromStep,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const promoteSchema = z.object({
  stepId: z.string().trim().min(1),
  targetType: z.enum(["thread", "message", "passage"]),
  targetId: z.string().trim().min(1),
  note: z.string().trim().max(2048).optional(),
})

/**
 * GET — list fulfillments for this session (used by coverage view).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const { sessionId } = await params
  const fulfillments = await getFulfillmentsForSession(workspaceId, sessionId)
  return NextResponse.json({ fulfillments })
}

/**
 * POST — promote a thread or message to a step. Idempotent: calling
 * twice with the same target is a no-op (returns the same row).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const { sessionId } = await params
  const raw = await req.json().catch(() => null)
  const parsed = promoteSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const session = await getSessionById(workspaceId, sessionId)
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }
  // Sanity: step must exist in the session's plan.
  if (!session.planSteps.some((s) => s.id === parsed.data.stepId)) {
    return NextResponse.json(
      { error: `Step "${parsed.data.stepId}" isn't in this session's plan` },
      { status: 400 }
    )
  }

  // Validate passage targets up-front so an unknown id can't fake coverage.
  if (parsed.data.targetType === "passage") {
    const passage = await getPassageById(workspaceId, parsed.data.targetId)
    if (!passage) {
      return NextResponse.json(
        { error: "Passage not found in this workspace" },
        { status: 404 }
      )
    }
  }

  const promotedBy =
    auth.identity ?? (await getDisplayName()) ?? "operator"

  const fulfillment = await promoteToStep(
    workspaceId,
    sessionId,
    parsed.data.stepId,
    parsed.data.targetType,
    parsed.data.targetId,
    promotedBy,
    parsed.data.note
  )

  return NextResponse.json({ ok: true, fulfillment })
}

/**
 * DELETE — remove a fulfillment by id. The id is in the query string
 * (`?fulfillmentId=...`) since route params are reserved for sessionId.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  // sessionId is validated as a route param but we don't need it for
  // the delete — fulfillment ids are globally unique and scoped by
  // workspace. Touching params to avoid unused-var lint.
  await params

  const fulfillmentId = req.nextUrl.searchParams.get("fulfillmentId")
  if (!fulfillmentId) {
    return NextResponse.json(
      { error: "Missing ?fulfillmentId=" },
      { status: 400 }
    )
  }

  await unpromoteFromStep(workspaceId, fulfillmentId)
  return NextResponse.json({ ok: true })
}
