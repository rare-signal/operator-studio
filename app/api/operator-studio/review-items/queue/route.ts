import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getDavidReviewQueue } from "@/lib/operator-studio/david-review-queue"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/review-items/queue — David Review queue
 * grouped by category (executive / sprawl / intake / agent / other).
 * Same rows as `/review-items` underneath; the category pivot is
 * derived from `sourceType`.
 *
 * Query params:
 *   includeClosed=1 include imported/promoted/rejected/snoozed
 *   limit=N         per-bucket cap (default 50)
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  try {
    const workspaceId = await getActiveWorkspaceId()
    const url = new URL(req.url)
    const includeClosed = url.searchParams.get("includeClosed") === "1"
    const limitRaw = Number(url.searchParams.get("limit") ?? "")
    const queue = await getDavidReviewQueue(workspaceId, {
      includeClosed,
      limitPerBucket:
        Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
    })
    return NextResponse.json(queue)
  } catch (e) {
    console.error("[review-items/queue] failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    )
  }
}
