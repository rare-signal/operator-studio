import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  archiveLabel,
  deleteLabel,
  getLabelById,
  unarchiveLabel,
  updateLabel,
} from "@/lib/operator-studio/promotion-labels"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/promotion-labels/[id] */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const label = await getLabelById(workspaceId, id)
  if (!label) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ label })
}

/** PATCH /api/operator-studio/promotion-labels/[id] — update fields, or
 *  archive/unarchive via {archived: true|false}. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }

  if (typeof body.archived === "boolean") {
    const updated = body.archived
      ? await archiveLabel(workspaceId, id)
      : await unarchiveLabel(workspaceId, id)
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json({ label: updated })
  }

  const updated = await updateLabel(workspaceId, id, {
    label: typeof body.label === "string" ? body.label : undefined,
    aiContext:
      typeof body.aiContext === "string" ? body.aiContext : undefined,
    icon: typeof body.icon === "string" ? body.icon : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    sortIndex:
      typeof body.sortIndex === "number" ? body.sortIndex : undefined,
  })
  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ label: updated })
}

/** DELETE /api/operator-studio/promotion-labels/[id] — hard delete. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const ok = await deleteLabel(workspaceId, id)
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
