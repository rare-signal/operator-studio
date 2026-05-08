/**
 * POST /api/operator-studio/executive-recommendations/[id]/launch
 *
 * Spawn a fresh tmux worker bound to an approved `launch_worker`
 * recommendation. Gates:
 *   - admin auth
 *   - hot mode armed
 *   - kind === "launch_worker"
 *   - status === "approved"
 *   - prompt non-empty
 *
 * On success: sets the recommendation's `launch` metadata, marks it
 * executed, closes the review row, and returns the launched agent
 * id (`tmux:exec-<id>`) so the caller can surface it / link to it in
 * Bento.
 *
 * On failure: leaves the recommendation in `approved` so David can
 * retry once the underlying issue (tmux server, nvm path, cwd) is
 * resolved.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  getExecutiveRecommendation,
  recordRecommendationLaunch,
} from "@/lib/operator-studio/executive-recommendations"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { isHotModeArmed } from "@/lib/server/agent-bridge/hot-mode"
import { launchClaudeWorker } from "@/lib/server/agent-bridge/tmux-launch"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  if (!(await isAdmin(auth)))
    return NextResponse.json({ error: "admin only" }, { status: 403 })

  if (!isHotModeArmed()) {
    return NextResponse.json(
      {
        error:
          "Hot mode is not armed. Lift the cover in Bento and enter the PIN before launching workers.",
      },
      { status: 403 }
    )
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const cwdOverride =
    typeof body.cwd === "string" && body.cwd.length > 0 ? body.cwd : null
  const launchCommand =
    typeof body.launchCommand === "string" && body.launchCommand.length > 0
      ? body.launchCommand
      : null
  const collisionPolicy =
    body.collisionPolicy === "reuse" ? "reuse" : "error"
  const promptDelayMs =
    typeof body.promptDelayMs === "number" && Number.isFinite(body.promptDelayMs)
      ? body.promptDelayMs
      : undefined

  const workspaceId = await getActiveWorkspaceId()
  const rec = await getExecutiveRecommendation(workspaceId, id)
  if (!rec) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  if (rec.payload.kind !== "launch_worker") {
    return NextResponse.json(
      {
        error: `Only launch_worker recommendations can be launched (got ${rec.payload.kind}).`,
      },
      { status: 400 }
    )
  }
  if (rec.payload.status !== "approved") {
    return NextResponse.json(
      {
        error: `Recommendation must be approved before launch (status=${rec.payload.status}).`,
      },
      { status: 400 }
    )
  }
  const prompt = rec.payload.prompt ?? ""
  if (prompt.trim().length === 0) {
    return NextResponse.json(
      { error: "Recommendation has no prompt to launch with." },
      { status: 400 }
    )
  }

  const cwd = cwdOverride ?? rec.payload.target.cwd ?? null

  const result = await launchClaudeWorker({
    recommendationId: rec.id,
    cwd,
    prompt,
    launchCommand,
    promptDelayMs,
    collisionPolicy,
  })
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  const updated = await recordRecommendationLaunch(
    workspaceId,
    rec.id,
    {
      agentId: result.agentId,
      sessionName: result.sessionName,
      cwd: result.cwd,
      launchCommand: result.launchCommand,
      promptPreview: result.promptPreview,
      launchedAt: result.launchedAt,
      planStepId: rec.payload.target.planStepId ?? null,
    },
    `Launched in tmux:${result.sessionName} (${result.agentId})`
  )

  return NextResponse.json({
    item: updated,
    launch: {
      agentId: result.agentId,
      sessionName: result.sessionName,
      cwd: result.cwd,
      launchedAt: result.launchedAt,
    },
  })
}
