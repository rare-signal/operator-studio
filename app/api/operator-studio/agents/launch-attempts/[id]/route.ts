/**
 * GET    /api/operator-studio/agents/launch-attempts/:id
 * POST   /api/operator-studio/agents/launch-attempts/:id
 *   Body: { agentId?: string, status: "resolved" | "dismissed" }
 *   When `status === "resolved"` and `agentId` is set, the existing
 *   plan-step (if any) is bound to that agent so the operator's
 *   manual fallback still produces the same agent → plan card link
 *   the happy-path launch would have created.
 * DELETE /api/operator-studio/agents/launch-attempts/:id
 *   Convenience alias for status=dismissed.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  getLaunchAttempt,
  resolveLaunchAttempt,
} from "@/lib/operator-studio/launch-attempts"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { parseAgentId } from "@/lib/server/agent-bridge/types"
import { copyForStage } from "@/lib/server/agent-bridge/launch-fallback"

export const dynamic = "force-dynamic"

async function gateAdmin(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return { ok: false as const, response: NextResponse.json({ error: auth.reason }, { status: 401 }) }
  }
  if (!(await isAdmin(auth))) {
    return { ok: false as const, response: NextResponse.json({ error: "admin only" }, { status: 403 }) }
  }
  return { ok: true as const, auth }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await gateAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  const rec = await getLaunchAttempt(id)
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const copy = copyForStage(rec.stage)
  return NextResponse.json({
    ok: true,
    attempt: {
      ...rec,
      message: copy.headline,
      body: copy.body,
      suggestedActions: copy.suggestedActions,
    },
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await gateAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const status =
    body && (body.status === "dismissed" || body.status === "resolved")
      ? body.status
      : "resolved"
  const agentIdRaw = body && typeof body.agentId === "string" ? body.agentId : null
  // Validate agentId format up front so we never persist garbage as
  // a "resolution".
  let agentId: string | null = null
  if (agentIdRaw) {
    const parsed = parseAgentId(agentIdRaw)
    if (parsed.kind === null) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    agentId = agentIdRaw
  }

  const existing = await getLaunchAttempt(id)
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Best-effort plan-card binding when the operator picks an existing
  // agent to receive the recovered prompt. Mirrors the binding the
  // happy-path /agents/new-session would have done on reconcile.
  let bindingId: string | null = null
  let bindingError: string | null = null
  if (status === "resolved" && agentId && existing.planStepId) {
    const parsed = parseAgentId(agentId)
    if (parsed.kind === "claude" || parsed.kind === "codex" || parsed.kind === "tmux") {
      try {
        const workspaceId = await getActiveWorkspaceId()
        const binding = await upsertThreadCardBinding({
          workspaceId,
          agentId,
          agentKind: parsed.kind,
          planStepId: existing.planStepId,
          source: "launch",
          sourceRecommendationId: existing.sourceRecommendationId ?? null,
          createdBy: gate.auth.identity ?? null,
          rationale: "launch-fallback resolved against existing agent",
        })
        bindingId = binding.id
      } catch (e) {
        bindingError = e instanceof Error ? e.message : "binding upsert failed"
        console.warn("[launch-attempts] binding upsert failed:", bindingError)
      }
    }
  }

  const next = await resolveLaunchAttempt(id, { agentId, status })
  return NextResponse.json({
    ok: true,
    attempt: next,
    binding:
      bindingId || bindingError ? { id: bindingId, error: bindingError } : null,
  })
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await gateAdmin(req)
  if (!gate.ok) return gate.response
  const { id } = await ctx.params
  const next = await resolveLaunchAttempt(id, { agentId: null, status: "dismissed" })
  if (!next) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true, attempt: next })
}
