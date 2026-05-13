/**
 * POST /api/operator-studio/work-lanes/[id]/spawn-worker
 *   body: { prompt: string,
 *           appKind?: "claude" | "codex",
 *           model?: string }
 *   → 200 { ok: true, agentId, launchedAt, binding }
 *
 * Cockpit "+ new worker" entry point. Spawns a worker through the CLI
 * surface dispatcher — `claude-cli` (default, subscription-bound,
 * Opus 4.7) or `codex-cli`. AX/Desktop is intentionally not reachable
 * from this route; the project went fully CLI-only on 2026-05-12.
 *
 * The resulting binding is marked `spawnOrigin: "cockpit-bypass"` so the
 * next Berthier sweep can absorb the unfamiliar worker per
 * `feedback_berthier_bypass_spawn.md`. `spawnedByAgentId` is set to the
 * lane's exec agent id so the worker appears in the cockpit's
 * spawned-by rail.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getWorkLane,
  listLaneMembers,
} from "@/lib/operator-studio/work-lanes"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { spawnAgent } from "@/lib/server/agent-bridge/surfaces"
import { DEFAULT_EXEC_MODEL } from "@/lib/server/agent-bridge/surfaces/claude-cli"
import type { SurfaceKind } from "@/lib/server/agent-bridge/surfaces/types"

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
  if (!lane.execAgentId) {
    return NextResponse.json(
      {
        error:
          "lane has no exec yet — promote an exec before spawning workers",
      },
      { status: 409 }
    )
  }

  const body = (await req.json().catch(() => null)) as {
    prompt?: string
    appKind?: string
    model?: string
  } | null

  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : ""
  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 })
  }
  const appKindRaw = body?.appKind?.trim().toLowerCase()
  const agentKind: "claude" | "codex" =
    appKindRaw === "codex" ? "codex" : "claude"
  const surface: SurfaceKind =
    agentKind === "codex" ? "codex-cli" : "claude-cli"
  const surfaceBinding: "claude-cli" | "codex-cli" =
    agentKind === "codex" ? "codex-cli" : "claude-cli"
  const model =
    typeof body?.model === "string" && body.model.trim().length > 0
      ? body.model.trim()
      : agentKind === "claude"
        ? DEFAULT_EXEC_MODEL
        : undefined

  const result = await spawnAgent({
    surface,
    prompt,
    model,
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
          "Worker spawned but JSONL did not reconcile in time. Check /tmp/operator-studio-cli-spawns/ and retry.",
        launchedAt: result.launchedAt,
      },
      { status: 504 }
    )
  }

  // Pick the lane's first plan_step member as the binding's planStepId.
  // Fallback to the lane id itself (the planStepId column is a soft FK
  // — see `lib/server/db/schema.ts`) so a lane with no plan-step
  // members can still spawn bypass workers.
  const members = await listLaneMembers(lane.id)
  const planStepId =
    members.find((m) => m.memberKind === "plan_step")?.memberId ?? lane.id

  let bindingId: string | null = null
  let bindingError: string | null = null
  try {
    const binding = await upsertThreadCardBinding({
      workspaceId: lane.workspaceId,
      agentId: result.agentId,
      agentKind,
      planStepId,
      source: "launch",
      spawnedByAgentId: lane.execAgentId,
      spawnOrigin: "cockpit-bypass",
      surface: surfaceBinding,
      createdBy: auth.identity ?? null,
      rationale: "cockpit + new worker (Berthier-bypass, CLI surface)",
    })
    bindingId = binding.id
  } catch (e) {
    bindingError = e instanceof Error ? e.message : "binding upsert failed"
    console.warn(
      "[spawn-worker] thread-card binding upsert failed:",
      bindingError
    )
  }

  return NextResponse.json({
    ok: true,
    agentId: result.agentId,
    launchedAt: result.launchedAt,
    surface,
    model: model ?? null,
    binding:
      bindingId || bindingError
        ? { id: bindingId, error: bindingError }
        : null,
  })
}
