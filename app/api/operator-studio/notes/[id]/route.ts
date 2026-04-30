import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  deleteNote,
  getNoteById,
  moveNote,
  updateNote,
} from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/notes/[id] */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const workspaceId = await getActiveWorkspaceId()
  const note = await getNoteById(workspaceId, id)
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ note })
}

/** PATCH /api/operator-studio/notes/[id]
 *  Body: { title?, body?, parentNoteId?, sortIndex? }
 *  When parentNoteId or sortIndex is present, performs a move. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const workspaceId = await getActiveWorkspaceId()

  const wantsMove = "parentNoteId" in body || "sortIndex" in body
  if (wantsMove) {
    const note = await moveNote(workspaceId, id, {
      parentNoteId:
        typeof body.parentNoteId === "string" ? body.parentNoteId : null,
      targetSortIndex:
        typeof body.sortIndex === "number" ? body.sortIndex : 0,
    })
    if (!note)
      return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json({ note })
  }

  const note = await updateNote(workspaceId, id, {
    title: typeof body.title === "string" ? body.title : undefined,
    body:
      body.body === null
        ? null
        : typeof body.body === "string"
          ? body.body
          : undefined,
    icon:
      body.icon === null
        ? null
        : typeof body.icon === "string"
          ? body.icon
          : undefined,
  })
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ note })
}

/** DELETE /api/operator-studio/notes/[id] — soft-deletes the note and
 *  any active descendants into the workspace trash. Recover via POST
 *  to /restore; permanently delete via POST to /purge. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const workspaceId = await getActiveWorkspaceId()
  await deleteNote(workspaceId, id)
  return NextResponse.json({ ok: true })
}
