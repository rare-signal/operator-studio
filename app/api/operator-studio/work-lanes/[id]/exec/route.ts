/**
 * POST /api/operator-studio/work-lanes/[id]/exec
 *   body: { agentId, agentKind? }   → set/promote existing thread as exec
 *   body: { agentId: null }         → clear exec
 *   body: { action: "create-new", initialPlanStepId?, initialChatId?, appKind?, model? }
 *   body: { create: true, appKind?: "claude"|"codex", initialPlanStepId?, initialChatId? }
 *                                   → spawn a fresh exec session via the
 *                                     CLI surface dispatcher
 *                                     (`claude-cli` default, `codex-cli`
 *                                     when appKind = "codex"), hydrated
 *                                     with the canonical Berthier
 *                                     kickoff for this lane, then bound.
 *   → 200 { ok: true, lane }
 *   → 409 when role-conflict guard rejects
 *
 * CLI-only as of 2026-05-12. The retired Claude/Codex Desktop AX spawn
 * branch was removed in the same migration that flipped `bindings.surface`
 * default to `claude-cli`. Legacy Desktop threads remain participable
 * via the chat-send route's CLI-resume path.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  setLaneExec,
  getWorkLane,
  LaneExecConflictError,
} from "@/lib/operator-studio/work-lanes"
import { buildKickoffForFactory } from "@/lib/operator-studio/berthier-flavors"
import { getFactoryById } from "@/lib/operator-studio/factory-registry"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { isHotModeArmed } from "@/lib/server/agent-bridge/hot-mode"
import { spawnAgent } from "@/lib/server/agent-bridge/surfaces"
import { DEFAULT_EXEC_MODEL } from "@/lib/server/agent-bridge/surfaces/claude-cli"
import type { SurfaceKind } from "@/lib/server/agent-bridge/surfaces/types"
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
    create?: boolean
    appKind?: string
    /** Model id for CLI surfaces. Defaults to DEFAULT_EXEC_MODEL when
     *  omitted. Honored only by claude-cli; codex-cli reads from env. */
    model?: string
    initialPlanStepId?: string | null
    initialChatId?: string | null
    /** Optional factory id to drive flavor selection. When set, the
     *  kickoff is built via the factory's flavor (`buildKickoffForFactory`);
     *  otherwise the canonical Berthier kickoff is used. */
    factoryId?: string | null
  } | null

  const isCreateNew =
    !!body && (body.action === "create-new" || body.create === true)

  if (isCreateNew) {
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
    const appKindRaw = body?.appKind?.trim().toLowerCase()
    const agentKind: "claude" | "codex" =
      appKindRaw === "codex" ? "codex" : "claude"
    const surface: SurfaceKind =
      agentKind === "codex" ? "codex-cli" : "claude-cli"
    const factoryEntry = getFactoryById(body?.factoryId ?? null)
    const kickoff = buildKickoffForFactory({
      laneId: lane.id,
      laneName: lane.name,
      workspaceId: lane.workspaceId,
      factoryEntry,
      initialPlanStepId: body?.initialPlanStepId ?? null,
      initialChatId: body?.initialChatId ?? null,
    })

    const model =
      typeof body?.model === "string" && body.model.trim().length > 0
        ? body.model.trim()
        : agentKind === "claude"
          ? DEFAULT_EXEC_MODEL
          : undefined

    const result = await spawnAgent({
      surface,
      model,
      prompt: kickoff,
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
            "CLI session spawned but JSONL did not reconcile in time. Check /tmp/operator-studio-cli-spawns/ and retry.",
          launchedAt: result.launchedAt,
        },
        { status: 504 }
      )
    }

    // Persist the exec binding with the CLI surface tag so the
    // chat-send route dispatches via `claude --resume`, not AX paste.
    try {
      const workspaceId = await getActiveWorkspaceId()
      const initialPlanStepId =
        body?.initialPlanStepId && body.initialPlanStepId.trim().length > 0
          ? body.initialPlanStepId
          : lane.id
      await upsertThreadCardBinding({
        workspaceId,
        agentId: result.agentId,
        agentKind,
        planStepId: initialPlanStepId,
        source: "launch",
        spawnOrigin: "cockpit",
        surface,
        createdBy: auth.identity ?? null,
        rationale: "lane exec create-new (CLI surface)",
      })
    } catch (e) {
      console.warn(
        "[exec] exec-binding upsert failed (non-fatal):",
        e instanceof Error ? e.message : e
      )
    }

    try {
      const updated = await setLaneExec(id, {
        agentId: result.agentId,
        agentKind,
      })
      return NextResponse.json({
        ok: true,
        lane: updated,
        spawned: {
          agentId: result.agentId,
          launchedAt: result.launchedAt,
          model: model ?? null,
          surface,
        },
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
