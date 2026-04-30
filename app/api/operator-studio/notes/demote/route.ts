import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { demoteStepToNotes } from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * POST /api/operator-studio/notes/demote
 *
 * Body: { planId: string, stepId: string, parentNoteId?: string|null,
 *         sortIndex?: number }
 *
 * Inverse of /notes/[id]/promote — converts a plan step (and its
 * descendants on the plan) into notes at the requested location in the
 * notes tree, then deletes the plan steps. Used when the user drags a
 * card out of the canvas back into the notes drawer.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (typeof body.planId !== "string" || typeof body.stepId !== "string") {
    return NextResponse.json(
      { error: "Body must be { planId, stepId, parentNoteId?, sortIndex? }" },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  try {
    const result = await demoteStepToNotes(workspaceId, body.planId, body.stepId, {
      parentNoteId:
        typeof body.parentNoteId === "string" ? body.parentNoteId : null,
      sortIndex: typeof body.sortIndex === "number" ? body.sortIndex : 0,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "demote failed" },
      { status: 400 }
    )
  }
}
