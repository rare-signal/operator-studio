import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  createReviewItem,
  listReviewItems,
  type ReviewItemSourceType,
  type ReviewItemState,
} from "@/lib/operator-studio/review-items"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/review-items
 *  Query: ?state=raw,summarized&sourceType=ado&includeClosed=1 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const url = new URL(req.url)
  const stateParam = url.searchParams.get("state")
  const states = stateParam
    ? (stateParam.split(",").map((s) => s.trim()) as ReviewItemState[])
    : undefined
  const sourceType =
    (url.searchParams.get("sourceType") as ReviewItemSourceType | null) ??
    undefined
  const includeClosed = url.searchParams.get("includeClosed") === "1"

  const workspaceId = await getActiveWorkspaceId()
  const items = await listReviewItems(workspaceId, {
    states,
    sourceType: sourceType ?? undefined,
    includeClosed,
  })
  return NextResponse.json({ items, count: items.length })
}

/** POST /api/operator-studio/review-items
 *  Body: { sourceType, title, summary?, sourceId?, sourceUrl?,
 *          sourceLabel?, rawText?, rawPayload?, proposedAction?,
 *          rationale?, confidence?, tags?, agentRunId?,
 *          relatedPlanStepId? } */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (typeof body.sourceType !== "string" || !body.sourceType) {
    return NextResponse.json(
      { error: "sourceType required" },
      { status: 400 }
    )
  }
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const item = await createReviewItem(workspaceId, {
    sourceType: body.sourceType,
    sourceLabel:
      typeof body.sourceLabel === "string" ? body.sourceLabel : null,
    sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
    sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
    title: body.title,
    summary: typeof body.summary === "string" ? body.summary : "",
    rawText: typeof body.rawText === "string" ? body.rawText : null,
    rawPayload:
      body.rawPayload && typeof body.rawPayload === "object"
        ? body.rawPayload
        : null,
    proposedAction:
      typeof body.proposedAction === "string" ? body.proposedAction : null,
    relatedPlanStepId:
      typeof body.relatedPlanStepId === "string"
        ? body.relatedPlanStepId
        : null,
    rationale: typeof body.rationale === "string" ? body.rationale : null,
    confidence:
      typeof body.confidence === "number" ? body.confidence : null,
    agentRunId:
      typeof body.agentRunId === "string" ? body.agentRunId : null,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((t: unknown): t is string => typeof t === "string")
      : [],
  })
  return NextResponse.json({ item })
}
