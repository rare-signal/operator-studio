import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { restoreNote } from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** POST /api/operator-studio/notes/[id]/restore — bring a trashed note
 *  (and its trashed descendants) back to the active set. If the
 *  parent is still trashed, the note is re-parented to root so it's
 *  visible immediately. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const workspaceId = await getActiveWorkspaceId()
  const note = await restoreNote(workspaceId, id)
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ note })
}
