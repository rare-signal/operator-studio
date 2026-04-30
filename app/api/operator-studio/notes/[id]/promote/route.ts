import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { promoteNoteToPlanSteps } from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * POST /api/operator-studio/notes/[id]/promote
 *
 * Body: { planId: string, positionX: number, positionY: number }
 *
 * Materializes the note (and its descendants) as plan steps under
 * `planId`, preserving the parent/child shape, then deletes the notes.
 * Used by the canvas drop handler when the user drags a note out of
 * the rail's notes drawer onto the plan canvas.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (
    typeof body.planId !== "string" ||
    typeof body.positionX !== "number" ||
    typeof body.positionY !== "number"
  ) {
    return NextResponse.json(
      { error: "Body must be { planId, positionX, positionY }" },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  try {
    const result = await promoteNoteToPlanSteps(workspaceId, body.planId, id, {
      positionX: body.positionX,
      positionY: body.positionY,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "promote failed" },
      { status: 400 }
    )
  }
}
