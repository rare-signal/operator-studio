import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getReviewItemById,
  updateReviewItem,
} from "@/lib/operator-studio/review-items"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/review-items/[id] */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const workspaceId = await getActiveWorkspaceId()
  const item = await getReviewItemById(workspaceId, id)
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ item })
}

/** PATCH /api/operator-studio/review-items/[id]
 *  Body: { title?, summary?, rawText?, proposedAction?, rationale?, tags? } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const workspaceId = await getActiveWorkspaceId()

  const item = await updateReviewItem(workspaceId, id, {
    title: typeof body.title === "string" ? body.title : undefined,
    summary: typeof body.summary === "string" ? body.summary : undefined,
    rawText:
      body.rawText === null
        ? null
        : typeof body.rawText === "string"
          ? body.rawText
          : undefined,
    proposedAction:
      body.proposedAction === null
        ? null
        : typeof body.proposedAction === "string"
          ? body.proposedAction
          : undefined,
    rationale:
      body.rationale === null
        ? null
        : typeof body.rationale === "string"
          ? body.rationale
          : undefined,
    tags: Array.isArray(body.tags)
      ? body.tags.filter((t: unknown): t is string => typeof t === "string")
      : undefined,
  })
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.json({ item })
}
