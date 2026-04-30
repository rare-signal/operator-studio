import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { createNote, listNotes } from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/notes — flat list of all notes for the workspace. */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const workspaceId = await getActiveWorkspaceId()
  const notes = await listNotes(workspaceId)
  return NextResponse.json({ notes, count: notes.length })
}

/** POST /api/operator-studio/notes
 *  Body: { parentNoteId?, title?, body?, sortIndex? } */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const workspaceId = await getActiveWorkspaceId()
  const note = await createNote(workspaceId, {
    parentNoteId:
      typeof body.parentNoteId === "string" ? body.parentNoteId : null,
    title: typeof body.title === "string" ? body.title : "",
    body: typeof body.body === "string" ? body.body : null,
    icon: typeof body.icon === "string" ? body.icon : null,
    sortIndex: typeof body.sortIndex === "number" ? body.sortIndex : undefined,
  })
  return NextResponse.json({ note })
}
