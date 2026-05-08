/**
 * POST /api/operator-studio/outbox/[id]/approve
 *
 * Body: { pin: string, durationMs?: number }
 *
 * One user-action: arm a per-row approval with the row's current
 * payload hash AND immediately invoke the writer. The writer's first
 * line consumes the approval, so even though we just armed it, the
 * payload bytes are checked against the bound hash at send time.
 *
 * Returns 200 with { ok:true, state:"sent", sendResult } on success,
 * 4xx with { error, state } on rejection (bad PIN, mismatch, upstream
 * failure).
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { approveAndSendOutbox } from "@/lib/operator-studio/outbox"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const { id } = await params

  const body = (await req.json().catch(() => null)) as null | {
    pin?: unknown
    durationMs?: unknown
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  const pin = typeof body.pin === "string" ? body.pin : ""
  const durationMs =
    typeof body.durationMs === "number" ? body.durationMs : undefined

  const result = await approveAndSendOutbox({
    workspaceId,
    id,
    pin,
    durationMs,
  })
  const status = result.ok ? 200 : 400
  return NextResponse.json(result, { status })
}
