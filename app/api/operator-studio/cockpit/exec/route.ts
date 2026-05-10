/**
 * GET  /api/operator-studio/cockpit/exec?workspaceId=<id>
 *   → { exec: { agentId, agentKind, updatedAt } | null }
 *
 * POST /api/operator-studio/cockpit/exec
 *   body: { workspaceId, agentId, agentKind?: string }
 *   → 200 { ok: true, exec: {...} }
 *   → 409 { error: "...currently a worker..." } when role guard rejects
 *
 * Role guard: a thread already bound as a worker (any active row in
 * operator_thread_card_bindings) cannot be promoted to exec.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getCockpitExec,
  setCockpitExec,
  getThreadRoleStatus,
} from "@/lib/operator-studio/cockpit-execs"
import { getActiveBindingsForAgents } from "@/lib/operator-studio/thread-card-bindings"
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
  const exec = await getCockpitExec(workspaceId)
  return NextResponse.json({ exec })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as {
    workspaceId?: string
    agentId?: string
    agentKind?: string
  } | null

  const workspaceId =
    body?.workspaceId?.trim() || (await getActiveWorkspaceId())
  const agentId = body?.agentId?.trim()
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  }

  let agentKind: string = body?.agentKind?.trim() ?? ""
  if (!agentKind) {
    const parsed = parseAgentId(agentId)
    agentKind = parsed.kind ?? "claude"
  }

  const role = await getThreadRoleStatus(workspaceId, agentId)
  if (role === "worker") {
    const active = await getActiveBindingsForAgents(workspaceId, [agentId])
    const stepId = active[0]?.planStepId ?? "an active plan card"
    return NextResponse.json(
      {
        error: `This thread is currently working on ${stepId}; detach it first before setting as exec.`,
        roleStatus: role,
      },
      { status: 409 }
    )
  }

  const exec = await setCockpitExec({
    workspaceId,
    agentId,
    agentKind,
  })
  return NextResponse.json({ ok: true, exec })
}
