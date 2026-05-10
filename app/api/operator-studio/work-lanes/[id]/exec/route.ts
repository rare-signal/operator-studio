/**
 * POST /api/operator-studio/work-lanes/[id]/exec
 *   body: { agentId, agentKind? }   → set/promote exec
 *   body: { agentId: null }         → clear exec
 *   → 200 { ok: true, lane }
 *   → 409 when role-conflict guard rejects
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  setLaneExec,
  getWorkLane,
  LaneExecConflictError,
} from "@/lib/operator-studio/work-lanes"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id } = await params
  const lane = await getWorkLane(id)
  if (!lane) {
    return NextResponse.json({ error: "lane not found" }, { status: 404 })
  }

  const body = (await req.json().catch(() => null)) as {
    agentId?: string | null
    agentKind?: string
  } | null

  if (body && body.agentId === null) {
    const updated = await setLaneExec(id, null)
    return NextResponse.json({ ok: true, lane: updated })
  }

  const agentId = body?.agentId?.trim()
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  }
  const agentKind =
    body?.agentKind?.trim() || parseAgentId(agentId).kind || "claude"

  try {
    const updated = await setLaneExec(id, { agentId, agentKind })
    return NextResponse.json({ ok: true, lane: updated })
  } catch (err) {
    if (err instanceof LaneExecConflictError) {
      return NextResponse.json(
        { error: err.message, conflictingPlanStepId: err.conflictingPlanStepId },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
