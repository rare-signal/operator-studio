/**
 * POST /api/operator-studio/work-lanes/[id]/exec
 *   body: { agentId, agentKind? }   → set/promote existing thread as exec
 *   body: { agentId: null }         → clear exec
 *   body: { action: "create-new", initialPlanStepId?, initialChatId? }
 *                                   → spawn a fresh Claude Desktop session
 *                                     hydrated with the canonical Berthier
 *                                     kickoff for this lane, then bind it.
 *   → 200 { ok: true, lane }
 *   → 409 when role-conflict guard rejects
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  setLaneExec,
  getWorkLane,
  LaneExecConflictError,
} from "@/lib/operator-studio/work-lanes"
import { buildBerthierKickoff } from "@/lib/operator-studio/berthier-kickoff"
import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { isHotModeArmed } from "@/lib/server/agent-bridge/hot-mode"
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
    action?: string
    initialPlanStepId?: string | null
    initialChatId?: string | null
  } | null

  if (body && body.action === "create-new") {
    if (!(await isAdmin(auth))) {
      return NextResponse.json({ error: "admin only" }, { status: 403 })
    }
    if (!isHotModeArmed()) {
      return NextResponse.json(
        {
          error:
            "Hot mode is not armed. Lift the cover in Bento and enter the PIN to arm before spawning a new exec.",
        },
        { status: 403 }
      )
    }
    const kickoff = buildBerthierKickoff({
      laneId: lane.id,
      laneName: lane.name,
      workspaceId: lane.workspaceId,
      initialPlanStepId: body.initialPlanStepId ?? null,
      initialChatId: body.initialChatId ?? null,
    })
    const result = await createNewAppSessionAndSend({
      appKind: "claude",
      prompt: kickoff,
      submit: true,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, stage: result.stage },
        { status: result.status }
      )
    }
    if (!result.reconciled || !result.agentId) {
      return NextResponse.json(
        {
          error:
            "Session spawned but JSONL did not reconcile in time. Re-run once the new chat appears.",
          launchedAt: result.launchedAt,
        },
        { status: 504 }
      )
    }
    try {
      const updated = await setLaneExec(id, {
        agentId: result.agentId,
        agentKind: "claude",
      })
      return NextResponse.json({
        ok: true,
        lane: updated,
        spawned: { agentId: result.agentId, launchedAt: result.launchedAt },
      })
    } catch (err) {
      if (err instanceof LaneExecConflictError) {
        return NextResponse.json(
          { error: err.message, conflictingPlanStepId: err.conflictingPlanStepId },
          { status: 409 }
        )
      }
      throw err
    }
  }

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
