/**
 * POST /api/operator-studio/outbox/[id]/reject
 *
 * Body: { reason?: string }
 *
 * Marks the row as rejected and clears any in-flight approval.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { rejectOutbox } from "@/lib/operator-studio/outbox"
import { disarmOutboundApproval } from "@/lib/server/agent-bridge/outbound-mode"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const { id } = await params

  const body = (await req.json().catch(() => null)) as null | { reason?: unknown }
  const reason =
    body && typeof body.reason === "string" && body.reason ? body.reason : undefined

  disarmOutboundApproval(id)
  const row = await rejectOutbox(workspaceId, id, "operator", reason)
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ item: row })
}
