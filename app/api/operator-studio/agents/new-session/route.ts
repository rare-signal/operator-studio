/**
 * POST /api/operator-studio/agents/new-session
 *
 * Body: {
 *   appKind: "claude" | "codex",
 *   prompt: string,
 *   appName?: string,           // override the macOS app name
 *   submit?: boolean,           // default true
 *   planStepId?: string | null,
 *   sourceRecommendationId?: string | null,
 *   reconcileBudgetMs?: number,
 *   reconcileIntervalMs?: number,
 * }
 *
 * Admin + hot-mode gated. Creates a brand-new Claude/Codex Desktop
 * thread via Cmd+N, pastes the prompt, optionally submits, then polls
 * the JSONL session list to reconcile a `claude:<id>` / `codex:<id>`
 * for Bento and the recent-agent feed to pick up.
 *
 * The route returns a structured result: `reconciled: true` with an
 * `agentId` on the happy path, otherwise `reconciled: false` with the
 * pre/post snapshot evidence so the caller can decide whether to
 * retry. This is the "create" sibling of `/agents/:id/send`, which
 * remains the path for sending into an existing session.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { isHotModeArmed } from "@/lib/server/agent-bridge/hot-mode"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
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
  if (!isHotModeArmed()) {
    return NextResponse.json(
      {
        error:
          "Hot mode is not armed. Lift the cover in Bento and enter the PIN to arm before launching new sessions.",
      },
      { status: 403 }
    )
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }

  const appKindRaw = (body as Record<string, unknown>).appKind
  if (appKindRaw !== "claude" && appKindRaw !== "codex") {
    return NextResponse.json(
      { error: 'appKind must be "claude" or "codex"' },
      { status: 400 }
    )
  }
  const prompt =
    typeof (body as Record<string, unknown>).prompt === "string"
      ? ((body as Record<string, unknown>).prompt as string)
      : ""
  const appName =
    typeof (body as Record<string, unknown>).appName === "string"
      ? ((body as Record<string, unknown>).appName as string)
      : undefined
  const submit =
    (body as Record<string, unknown>).submit === undefined
      ? undefined
      : !!(body as Record<string, unknown>).submit
  const planStepId =
    typeof (body as Record<string, unknown>).planStepId === "string"
      ? ((body as Record<string, unknown>).planStepId as string)
      : null
  const sourceRecommendationId =
    typeof (body as Record<string, unknown>).sourceRecommendationId === "string"
      ? ((body as Record<string, unknown>).sourceRecommendationId as string)
      : null
  const reconcileBudgetMs =
    typeof (body as Record<string, unknown>).reconcileBudgetMs === "number"
      ? ((body as Record<string, unknown>).reconcileBudgetMs as number)
      : undefined
  const reconcileIntervalMs =
    typeof (body as Record<string, unknown>).reconcileIntervalMs === "number"
      ? ((body as Record<string, unknown>).reconcileIntervalMs as number)
      : undefined

  const result = await createNewAppSessionAndSend({
    appKind: appKindRaw,
    prompt,
    appName,
    submit,
    reconcileBudgetMs,
    reconcileIntervalMs,
  })

  if (result.ok === false) {
    return NextResponse.json(
      {
        error: result.error,
        stage: result.stage,
        appKind: result.appKind,
      },
      { status: result.status }
    )
  }

  // Persist the durable agent → plan-card binding when the launch
  // reconciled to a fresh JSONL session id and the caller named a
  // planStepId. Failures here must not break the launch — the launch
  // already happened — so the upsert is best-effort and logged.
  let bindingId: string | null = null
  let bindingError: string | null = null
  if (result.reconciled && result.agentId && planStepId) {
    try {
      const workspaceId = await getActiveWorkspaceId()
      const binding = await upsertThreadCardBinding({
        workspaceId,
        agentId: result.agentId,
        agentKind: result.appKind,
        planStepId,
        source: "launch",
        sourceRecommendationId: sourceRecommendationId ?? null,
        createdBy: auth.identity ?? null,
        rationale: "agents/new-session reconciled launch",
      })
      bindingId = binding.id
    } catch (e) {
      bindingError = e instanceof Error ? e.message : "binding upsert failed"
      console.warn("[new-session] thread-card binding upsert failed:", bindingError)
    }
  }

  return NextResponse.json({
    ok: true,
    reconciled: result.reconciled,
    appKind: result.appKind,
    agentId: result.agentId,
    launchedAt: result.launchedAt,
    promptPreview: result.promptPreview,
    submitted: result.submitted,
    planStepId,
    sourceRecommendationId,
    reason: "reason" in result ? result.reason : null,
    evidence: result.evidence,
    binding:
      bindingId || bindingError
        ? { id: bindingId, error: bindingError }
        : null,
  })
}
