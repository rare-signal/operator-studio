/**
 * GET /api/operator-studio/agents/thread-card-bindings
 *
 * Returns the active durable bindings between worker agents (Claude /
 * Codex / tmux) and plan-card step ids for the active workspace.
 *
 * Operations and the Bento command center read this to populate
 * card-thread links without depending on localStorage. The
 * localStorage map remains as a fallback during rollout.
 *
 * POST /api/operator-studio/agents/thread-card-bindings
 *
 * Body: { agentId, agentKind, planStepId, source?, sourceRecommendationId?,
 *         confidence?, rationale? }
 *
 * Manual binding entry point — what the Bento UI's "Link to plan card"
 * action calls today against localStorage. Admin-gated; idempotent.
 *
 * DELETE /api/operator-studio/agents/thread-card-bindings?agentId=…
 *
 * Detach the agent from its current card (soft-detach; history kept).
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  detachThreadCardBinding,
  listActiveThreadCardBindings,
  upsertThreadCardBinding,
  type ThreadBindingSource,
} from "@/lib/operator-studio/thread-card-bindings"

export const dynamic = "force-dynamic"

const ALLOWED_SOURCES: readonly ThreadBindingSource[] = [
  "launch",
  "manual",
  "tail-sniff",
  "scheduled",
]

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const bindings = await listActiveThreadCardBindings(workspaceId)
  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    workspaceId,
    bindings,
  })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: "Body required" }, { status: 400 })

  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : ""
  const agentKind = typeof body.agentKind === "string" ? body.agentKind.trim() : ""
  const planStepId = typeof body.planStepId === "string" ? body.planStepId.trim() : ""
  if (!agentId || !agentKind || !planStepId) {
    return NextResponse.json(
      { error: "agentId, agentKind, planStepId are required" },
      { status: 400 }
    )
  }
  const sourceRaw = typeof body.source === "string" ? body.source : "manual"
  if (!ALLOWED_SOURCES.includes(sourceRaw as ThreadBindingSource)) {
    return NextResponse.json(
      { error: `source must be one of ${ALLOWED_SOURCES.join(", ")}` },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  const binding = await upsertThreadCardBinding({
    workspaceId,
    agentId,
    agentKind,
    planStepId,
    source: sourceRaw as ThreadBindingSource,
    confidence: typeof body.confidence === "number" ? body.confidence : null,
    rationale: typeof body.rationale === "string" ? body.rationale : null,
    sourceRecommendationId:
      typeof body.sourceRecommendationId === "string"
        ? body.sourceRecommendationId
        : null,
    createdBy: auth.identity ?? null,
  })
  return NextResponse.json({ ok: true, binding })
}

export async function DELETE(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }
  const agentId = req.nextUrl.searchParams.get("agentId")?.trim() ?? ""
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const detached = await detachThreadCardBinding(workspaceId, agentId)
  return NextResponse.json({ ok: true, detached })
}
