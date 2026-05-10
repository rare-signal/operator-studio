/**
 * GET  /api/operator-studio/agents/launch-attempts?status=pending|resolved|dismissed|all
 * POST /api/operator-studio/agents/launch-attempts
 *   Body: { appKind, prompt, planStepId?, sourceRecommendationId? }
 *   Manual stash of a prompt the operator wants to recover later
 *   without firing the new-session automation.
 *
 * The list endpoint backs the LaunchFallbackPanel — it polls every
 * few seconds and surfaces pending recoveries so a typed prompt is
 * never lost across a server restart or a tab reload.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  createLaunchAttempt,
  listLaunchAttempts,
  type LaunchAttemptStatus,
} from "@/lib/operator-studio/launch-attempts"
import { copyForStage } from "@/lib/server/agent-bridge/launch-fallback"

export const dynamic = "force-dynamic"

function parseStatus(v: string | null): LaunchAttemptStatus | "all" {
  if (v === "resolved" || v === "dismissed" || v === "pending" || v === "all") {
    return v
  }
  return "pending"
}

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "admin only" }, { status: 403 })
  }
  const url = new URL(req.url)
  const status = parseStatus(url.searchParams.get("status"))
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200)
  const records = await listLaunchAttempts({ status, limit })
  return NextResponse.json({
    ok: true,
    attempts: records.map((rec) => {
      const copy = copyForStage(rec.stage)
      return {
        ...rec,
        // Re-derive the stage copy on read so message/body changes
        // pick up without rewriting old records.
        message: copy.headline,
        body: copy.body,
        suggestedActions: copy.suggestedActions,
      }
    }),
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
  const appKind = body.appKind === "codex" ? "codex" : "claude"
  const prompt = typeof body.prompt === "string" ? body.prompt : ""
  if (prompt.trim().length === 0) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 })
  }
  const planStepId = typeof body.planStepId === "string" ? body.planStepId : null
  const sourceRecommendationId =
    typeof body.sourceRecommendationId === "string" ? body.sourceRecommendationId : null
  const headline = copyForStage("manual").headline
  const record = await createLaunchAttempt({
    appKind,
    prompt,
    planStepId,
    sourceRecommendationId,
    stage: "manual",
    message: headline,
    errorRaw: null,
    evidence: null,
  })
  return NextResponse.json({ ok: true, attempt: record })
}
