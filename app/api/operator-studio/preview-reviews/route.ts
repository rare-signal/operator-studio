/**
 * POST /api/operator-studio/preview-reviews
 *
 * Receives structured preview-feedback payloads from Telegento (or any
 * other agent-built feature deploy) and persists them as Operator
 * Studio review-items keyed on `sourceType: "deployment"`. Operator
 * Studio is the system of record for these reviews; ADO/Teams updates
 * are deliberate later steps initiated from the OS review surface.
 *
 * Auth: standard `authorizeRequest` — reviewers using the OS UI hit
 * this via cookie; cross-service callers (Telegento preview pods) use
 * `Authorization: Bearer <OPERATOR_STUDIO_INGEST_TOKEN>` shared with
 * the preview deploy's env.
 *
 * Idempotency: `(sourceType, sourceId)` is the natural key. We mint a
 * `sourceId` from the deploy id + commit + verdict + ISO submitted-at
 * so a second submit on the same preview can be distinguished by
 * minute. The store's upsert keys on (sourceType, sourceId) so a
 * retry with the same sourceId folds into the existing row.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { createReviewItem } from "@/lib/operator-studio/review-items"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const VALID_VERDICTS = new Set([
  "approve",
  "request-changes",
  "reject",
  "needs-discussion",
])

interface PreviewFeatureMetadata {
  sourceSystem: string | null
  sourceId: string | null
  sourceUrl: string | null
  originalAsk: string | null
  agentWorkSummary: string | null
  reviewCriteria: string[]
  featureId: string | null
}

interface PreviewDeployMetadata {
  commit: string | null
  branch: string | null
  deployId: string | null
  deployedAt: string | null
  agentSessionUrl: string | null
}

interface PreviewContextLike {
  isPreview: boolean
  detectedVia: "env" | "hostname" | null
  deploy: PreviewDeployMetadata
  feature: PreviewFeatureMetadata
}

interface IncomingBody {
  verdict?: string
  notes?: string
  reviewer?: string | null
  context?: PreviewContextLike
  submittedAt?: string
  submittedFromHostname?: string | null
}

const VERDICT_TO_PROPOSED_ACTION: Record<string, string> = {
  approve: "Mark feature accepted; close the upstream task.",
  "request-changes": "Send back to agent worker with reviewer notes attached.",
  reject: "Reject the feature; capture the reason and re-plan upstream.",
  "needs-discussion": "Schedule a sync — feedback isn't a clean accept/reject.",
}

function pickReviewer(body: IncomingBody, authIdentity: string | null): string {
  const explicit = typeof body.reviewer === "string" ? body.reviewer.trim() : ""
  if (explicit.length > 0) return explicit
  if (authIdentity && authIdentity.length > 0) return authIdentity
  return "anonymous-reviewer"
}

function buildSourceId(body: IncomingBody): string {
  const ctx = body.context!
  const deployId = ctx.deploy.deployId ?? ctx.deploy.commit ?? "unknown-deploy"
  const featureId =
    ctx.feature.featureId ?? ctx.feature.sourceId ?? "unknown-feature"
  // Minute-precision so retries within the same minute fold into one
  // review-item; a fresh submit a minute later creates a new row.
  const minute = (body.submittedAt ?? new Date().toISOString()).slice(0, 16)
  return `preview-review:${deployId}:${featureId}:${body.verdict}:${minute}`
}

function buildTitle(body: IncomingBody): string {
  const ctx = body.context!
  const tag =
    ctx.feature.featureId ?? ctx.feature.sourceId ?? ctx.deploy.deployId ?? "preview"
  const verdictLabel =
    body.verdict === "approve"
      ? "✓ Approved"
      : body.verdict === "request-changes"
        ? "↻ Request changes"
        : body.verdict === "reject"
          ? "✗ Rejected"
          : "? Needs discussion"
  return `${verdictLabel} — preview review · ${tag}`
}

function buildSummary(body: IncomingBody): string {
  const ctx = body.context!
  const lines: string[] = []
  if (ctx.feature.originalAsk) {
    lines.push(`Original ask: ${ctx.feature.originalAsk}`)
  }
  if (ctx.feature.agentWorkSummary) {
    lines.push(`Agent summary: ${ctx.feature.agentWorkSummary}`)
  }
  if (body.notes && body.notes.trim().length > 0) {
    lines.push("")
    lines.push("Reviewer notes:")
    lines.push(body.notes.trim())
  }
  return lines.join("\n")
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  let body: IncomingBody
  try {
    body = (await req.json()) as IncomingBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  if (!body.verdict || !VALID_VERDICTS.has(body.verdict)) {
    return NextResponse.json(
      { error: `verdict must be one of ${[...VALID_VERDICTS].join(" / ")}` },
      { status: 400 }
    )
  }
  if (!body.context || typeof body.context !== "object") {
    return NextResponse.json({ error: "context is required" }, { status: 400 })
  }

  const reviewer = pickReviewer(body, auth.identity)
  const sourceId = buildSourceId(body)
  const workspaceId = await getActiveWorkspaceId()

  // Map upstream source so the review item carries the right
  // sourceLabel (and a future filter on the OS review board can
  // pivot by upstream system).
  const upstream = body.context.feature.sourceSystem
  const sourceLabel = upstream
    ? `Preview review · ${upstream.toUpperCase()}`
    : "Preview review"

  const tags = ["preview-review", `verdict:${body.verdict}`]
  if (upstream) tags.push(`upstream:${upstream}`)
  if (body.context.deploy.branch) tags.push(`branch:${body.context.deploy.branch}`)

  const item = await createReviewItem(workspaceId, {
    sourceType: "deployment",
    sourceLabel,
    sourceId,
    sourceUrl: body.context.feature.sourceUrl ?? null,
    title: buildTitle(body),
    summary: buildSummary(body),
    rawText: body.notes ?? null,
    rawPayload: {
      verdict: body.verdict,
      reviewer,
      submittedAt: body.submittedAt ?? new Date().toISOString(),
      submittedFromHostname: body.submittedFromHostname ?? null,
      context: body.context,
    },
    proposedAction: VERDICT_TO_PROPOSED_ACTION[body.verdict] ?? null,
    visibility: "david_only",
    state: "candidate",
    rationale: `Preview review submitted by ${reviewer} · verdict ${body.verdict}`,
    tags,
  })

  return NextResponse.json({
    ok: true,
    reviewItem: {
      id: item.id,
      state: item.state,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      visibility: item.visibility,
      tags: item.tags,
    },
  })
}
