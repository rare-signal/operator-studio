import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  createExecutiveRecommendation,
  listExecutiveRecommendations,
  type ExecutiveRecommendationKind,
  type ExecutiveRecommendationRisk,
  type WorkerKind,
} from "@/lib/operator-studio/executive-recommendations"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/executive-recommendations
 *  David-only inbox of proposed worker actions. */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  if (!(await isAdmin(auth)))
    return NextResponse.json({ error: "admin only" }, { status: 403 })

  const url = new URL(req.url)
  const includeClosed = url.searchParams.get("includeClosed") !== "0"
  const limitRaw = Number(url.searchParams.get("limit") ?? 200)
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitRaw) ? limitRaw : 200))

  const workspaceId = await getActiveWorkspaceId()
  const items = await listExecutiveRecommendations(workspaceId, {
    includeClosed,
    limit,
  })
  return NextResponse.json({ items, count: items.length })
}

/** POST /api/operator-studio/executive-recommendations
 *  Body: ExecutiveRecommendationInput (see helpers). */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  if (!(await isAdmin(auth)))
    return NextResponse.json({ error: "admin only" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title required" }, { status: 400 })
  }
  if (typeof body.kind !== "string") {
    return NextResponse.json({ error: "kind required" }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  try {
    const rec = await createExecutiveRecommendation(workspaceId, {
      title: body.title,
      rationale:
        typeof body.rationale === "string"
          ? body.rationale
          : typeof body.summary === "string"
            ? body.summary
            : "",
      kind: body.kind as ExecutiveRecommendationKind,
      workerKind:
        typeof body.workerKind === "string"
          ? (body.workerKind as WorkerKind)
          : null,
      target:
        body.target && typeof body.target === "object" ? body.target : {},
      prompt: typeof body.prompt === "string" ? body.prompt : null,
      expectedOutput:
        typeof body.expectedOutput === "string" ? body.expectedOutput : null,
      acceptanceCriteria:
        typeof body.acceptanceCriteria === "string"
          ? body.acceptanceCriteria
          : null,
      riskNote: typeof body.riskNote === "string" ? body.riskNote : null,
      risk:
        typeof body.risk === "string"
          ? (body.risk as ExecutiveRecommendationRisk)
          : undefined,
      evidence: typeof body.evidence === "string" ? body.evidence : null,
      sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
      tags: Array.isArray(body.tags)
        ? body.tags.filter((t: unknown): t is string => typeof t === "string")
        : [],
    })
    return NextResponse.json({ item: rec })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "create failed" },
      { status: 400 }
    )
  }
}
