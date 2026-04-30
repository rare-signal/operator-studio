import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getFulfillmentsForSession,
  getSessionById,
  getThreadsInSession,
  updateSessionLabel,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  // Allow empty string → null to let users clear the label.
  label: z.string().trim().max(256).nullable(),
})

/**
 * GET /api/operator-studio/sessions/[sessionId]
 *
 * Returns the session row plus its thread membership (derived from
 * timestamp overlap). Used by the session detail page.
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
  const session = await getSessionById(workspaceId, sessionId)
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const [threads, fulfillments] = await Promise.all([
    getThreadsInSession(workspaceId, sessionId),
    getFulfillmentsForSession(workspaceId, sessionId),
  ])

  return NextResponse.json({
    session,
    threads,
    fulfillments,
    threadCount: threads.length,
  })
}

/**
 * PATCH /api/operator-studio/sessions/[sessionId]
 *
 * Edit the session label. Phase 2 will extend this with planSteps edits;
 * for now label is the only editable field.
 */
export async function PATCH(
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
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const existing = await getSessionById(workspaceId, sessionId)
  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  const label = parsed.data.label?.trim() || null
  await updateSessionLabel(workspaceId, sessionId, label)
  return NextResponse.json({ ok: true })
}
