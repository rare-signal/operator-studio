/**
 * POST /api/operator-studio/spawn/cli
 *
 * Smoke-test endpoint for the headless Claude Code CLI spawn pipeline.
 * The eventual ADO webhook handler will call `spawnClaudeCliWorker`
 * directly (server-to-server) — this route exists so the operator can
 * manually exercise the pipeline before that webhook is wired up.
 *
 * Body: {
 *   prompt: string,
 *   cwd?: string,
 *   systemPromptAppend?: string,
 *   maxWallMs?: number,
 *   planStepId?: string | null,
 *   sourceRecommendationId?: string | null,
 *   spawnedByAgentId?: string | null,
 * }
 *
 * Auth: admin-gated (same surface as /agents/new-session). Hot mode is
 * NOT required here — the CLI pipeline has no clipboard / GUI side
 * effects, so the "are you sure" gate is unnecessary for headless use.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { spawnClaudeCliWorker } from "@/lib/server/agent-bridge/claude-cli"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }

  const prompt = typeof body.prompt === "string" ? body.prompt : ""
  const cwd = typeof body.cwd === "string" && body.cwd.length > 0 ? body.cwd : undefined
  const systemPromptAppend =
    typeof body.systemPromptAppend === "string" && body.systemPromptAppend.length > 0
      ? body.systemPromptAppend
      : undefined
  const maxWallMs = typeof body.maxWallMs === "number" ? body.maxWallMs : undefined
  const planStepId = typeof body.planStepId === "string" ? body.planStepId : null
  const sourceRecommendationId =
    typeof body.sourceRecommendationId === "string" ? body.sourceRecommendationId : null
  const spawnedByAgentId =
    typeof body.spawnedByAgentId === "string" ? body.spawnedByAgentId : null

  const result = await spawnClaudeCliWorker({
    prompt,
    cwd,
    systemPromptAppend,
    maxWallMs,
  })

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        kind: result.kind,
        logPath: result.logPath ?? null,
        exitCode: result.exitCode ?? null,
        stdoutTail: result.stdout?.slice(-2000) ?? null,
        stderrTail: result.stderr?.slice(-2000) ?? null,
      },
      { status: result.kind === "cli-not-ready" ? 503 : 500 }
    )
  }

  // Best-effort binding write — same shape as the Desktop pipeline,
  // but with spawnOrigin = "cli-server" so the cockpit can distinguish.
  let bindingId: string | null = null
  let bindingError: string | null = null
  if (planStepId && result.jsonlPath) {
    try {
      const workspaceId = await getActiveWorkspaceId()
      const binding = await upsertThreadCardBinding({
        workspaceId,
        agentId: result.agentId,
        agentKind: "claude",
        planStepId,
        source: "launch",
        sourceRecommendationId,
        spawnedByAgentId,
        spawnOrigin: "cli-server",
        surface: "claude-cli",
        createdBy: auth.identity ?? null,
        rationale: "spawn/cli reconciled CLI launch",
      })
      bindingId = binding.id
    } catch (e) {
      bindingError = e instanceof Error ? e.message : "binding upsert failed"
      console.warn("[spawn/cli] thread-card binding upsert failed:", bindingError)
    }
  }

  return NextResponse.json({
    ok: true,
    agentId: result.agentId,
    jsonlPath: result.jsonlPath,
    logPath: result.logPath,
    durationMs: result.durationMs,
    binding: bindingId || bindingError ? { id: bindingId, error: bindingError } : null,
    stdoutTail: result.stdout.slice(-2000),
    stderrTail: result.stderr.slice(-2000),
  })
}
