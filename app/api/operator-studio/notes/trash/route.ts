import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  TRASH_RETENTION_DAYS,
  emptyTrash,
  listTrash,
} from "@/lib/operator-studio/notes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/notes/trash — flat list of soft-deleted
 *  notes for the workspace, newest first. Lazily purges any rows past
 *  the retention window before returning. */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const workspaceId = await getActiveWorkspaceId()
  const notes = await listTrash(workspaceId)
  return NextResponse.json({
    notes,
    count: notes.length,
    retentionDays: TRASH_RETENTION_DAYS,
  })
}

/** DELETE /api/operator-studio/notes/trash — empty the trash for the
 *  current workspace. Irreversible. */
export async function DELETE(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const workspaceId = await getActiveWorkspaceId()
  await emptyTrash(workspaceId)
  return NextResponse.json({ ok: true })
}
