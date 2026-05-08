/**
 * GET  /api/operator-studio/outbox          → list outbox rows for the workspace
 * POST /api/operator-studio/outbox          → stage a new outbox row
 *
 * The POST surface is the staging tool LLMs / MCP tools call when they
 * want to put something on the wire. It does NOT send. Sending requires
 * a separate, PIN-armed approval at /api/operator-studio/outbox/[id]/approve.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  createOutbox,
  getOutboxCounts,
  listOutbox,
  type OutboxState,
} from "@/lib/operator-studio/outbox"
import type { OutboundSurface } from "@/lib/server/agent-bridge/outbound-mode"

export const dynamic = "force-dynamic"

const SURFACES: OutboundSurface[] = [
  "ado",
  "teams",
  "preview_deploy",
  "email",
  "stakeholder_reply",
]

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const url = new URL(req.url)
  const stateParam = url.searchParams.get("state") ?? undefined
  const limit = Number(url.searchParams.get("limit") ?? 100) || 100

  const [items, counts] = await Promise.all([
    listOutbox(workspaceId, { state: stateParam as OutboxState | undefined, limit }),
    getOutboxCounts(workspaceId),
  ])

  return NextResponse.json({ items, counts })
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const body = (await req.json().catch(() => null)) as null | {
    surface?: unknown
    action?: unknown
    targetId?: unknown
    targetLabel?: unknown
    audience?: unknown
    payload?: unknown
    renderedText?: unknown
    rationale?: unknown
    llmRunId?: unknown
    sourceInboxEventIds?: unknown
    relatedPlanStepId?: unknown
    factoryId?: unknown
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  if (typeof body.surface !== "string" || !SURFACES.includes(body.surface as OutboundSurface)) {
    return NextResponse.json(
      { error: `surface must be one of ${SURFACES.join(", ")}` },
      { status: 400 }
    )
  }
  if (typeof body.action !== "string" || !body.action) {
    return NextResponse.json({ error: "action required" }, { status: 400 })
  }
  if (typeof body.targetId !== "string" || !body.targetId) {
    return NextResponse.json({ error: "targetId required" }, { status: 400 })
  }
  if (
    !body.payload ||
    typeof body.payload !== "object" ||
    Array.isArray(body.payload)
  ) {
    return NextResponse.json(
      { error: "payload (object) required" },
      { status: 400 }
    )
  }
  if (typeof body.renderedText !== "string" || !body.renderedText) {
    return NextResponse.json(
      { error: "renderedText required" },
      { status: 400 }
    )
  }

  const row = await createOutbox({
    workspaceId,
    surface: body.surface as OutboundSurface,
    action: body.action,
    targetId: body.targetId,
    targetLabel:
      typeof body.targetLabel === "string" ? body.targetLabel : undefined,
    audience: Array.isArray(body.audience)
      ? body.audience.filter((a) => typeof a === "string")
      : undefined,
    payload: body.payload as Record<string, unknown>,
    renderedText: body.renderedText,
    rationale: typeof body.rationale === "string" ? body.rationale : undefined,
    llmRunId: typeof body.llmRunId === "string" ? body.llmRunId : undefined,
    sourceInboxEventIds: Array.isArray(body.sourceInboxEventIds)
      ? body.sourceInboxEventIds.filter((e) => typeof e === "string")
      : undefined,
    relatedPlanStepId:
      typeof body.relatedPlanStepId === "string"
        ? body.relatedPlanStepId
        : undefined,
    factoryId: typeof body.factoryId === "string" ? body.factoryId : undefined,
  })

  return NextResponse.json({ item: row })
}
