/**
 * GET   /api/operator-studio/outbox/[id]   → row + computed payload hash
 * PATCH /api/operator-studio/outbox/[id]   → edit rendered text / payload
 *                                            (clears any prior approval)
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { editOutbox, getOutbox } from "@/lib/operator-studio/outbox"
import { hashOutboundPayload } from "@/lib/operator-studio/outbound-gate"
import { disarmOutboundApproval } from "@/lib/server/agent-bridge/outbound-mode"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const { id } = await params
  const row = await getOutbox(workspaceId, id)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({
    item: row,
    payloadHash: hashOutboundPayload(row.payload),
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const { id } = await params

  const body = (await req.json().catch(() => null)) as null | {
    renderedText?: unknown
    payload?: unknown
    editedBy?: unknown
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  const editedBy = typeof body.editedBy === "string" ? body.editedBy : "operator"

  // Editing the row clears any prior approval — the approval was bound
  // to the old payload hash, which the edit just invalidated.
  disarmOutboundApproval(id)

  const row = await editOutbox({
    workspaceId,
    id,
    renderedText:
      typeof body.renderedText === "string" ? body.renderedText : undefined,
    payload:
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : undefined,
    editedBy,
  })
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({
    item: row,
    payloadHash: hashOutboundPayload(row.payload),
  })
}
