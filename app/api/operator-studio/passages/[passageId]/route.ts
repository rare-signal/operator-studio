import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { deletePassage } from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * DELETE /api/operator-studio/passages/[passageId]
 *
 * Un-promote a passage. Workspace-scoped, idempotent — deleting a
 * passage that doesn't exist (or isn't in this workspace) returns
 * 404 rather than silently succeeding so the caller can distinguish
 * "already gone" from "wrong workspace".
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ passageId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { passageId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const ok = await deletePassage(workspaceId, passageId)
  if (!ok) {
    return NextResponse.json({ error: "Passage not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
