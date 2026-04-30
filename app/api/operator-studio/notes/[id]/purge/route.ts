import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { purgeNote } from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** POST /api/operator-studio/notes/[id]/purge — permanently delete a
 *  trashed note. Refuses (silently no-ops) if the note isn't currently
 *  in the trash, so a misfire from the active list can't bypass the
 *  recoverability guarantee. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const workspaceId = await getActiveWorkspaceId()
  await purgeNote(workspaceId, id)
  return NextResponse.json({ ok: true })
}
