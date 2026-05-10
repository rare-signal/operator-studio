/**
 * GET  /api/operator-studio/work-lanes?workspaceId=<id>&includeArchived=1
 *   → { lanes: WorkLane[] }
 *
 * POST /api/operator-studio/work-lanes
 *   body: { workspaceId, name, description?, execAgentId?, execAgentKind? }
 *   → { ok: true, lane }
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  createWorkLane,
  listWorkLanes,
  LaneExecConflictError,
} from "@/lib/operator-studio/work-lanes"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId =
    req.nextUrl.searchParams.get("workspaceId")?.trim() ||
    (await getActiveWorkspaceId())
  const includeArchived =
    req.nextUrl.searchParams.get("includeArchived") === "1"
  const lanes = await listWorkLanes(workspaceId, { includeArchived })
  return NextResponse.json({ lanes })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as {
    workspaceId?: string
    name?: string
    description?: string | null
    execAgentId?: string | null
    execAgentKind?: string | null
  } | null

  const workspaceId =
    body?.workspaceId?.trim() || (await getActiveWorkspaceId())
  const name = body?.name?.trim()
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 })
  }

  let execAgentKind = body?.execAgentKind?.trim() || null
  if (body?.execAgentId && !execAgentKind) {
    execAgentKind = parseAgentId(body.execAgentId).kind ?? "claude"
  }

  try {
    const lane = await createWorkLane({
      workspaceId,
      name,
      description: body?.description ?? null,
      execAgentId: body?.execAgentId ?? null,
      execAgentKind,
    })
    return NextResponse.json({ ok: true, lane })
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
