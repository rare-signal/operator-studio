import { NextResponse, type NextRequest } from "next/server"

import {
  getActiveWorkContext,
} from "@/lib/operator-studio/active-work-context"
import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/active-work-context — composed
 * deterministic answer to "what plan / lane / agents / KB / review
 * queue is the workspace working in right now?". Used by Codex /
 * Claude before any write to avoid silent cross-plan mixing.
 *
 * Query params:
 *   kbLimit     cap for relatedKb (default 12)
 *   reviewLimit cap for recentReviews (default 8)
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  try {
    const workspaceId = await getActiveWorkspaceId()
    const reviewer = auth.identity ?? (await getDisplayName()) ?? "system"
    const url = new URL(req.url)
    const kbLimit = Number(url.searchParams.get("kbLimit") ?? "")
    const reviewLimit = Number(url.searchParams.get("reviewLimit") ?? "")
    const ctx = await getActiveWorkContext(workspaceId, {
      reviewer,
      kbLimit: Number.isFinite(kbLimit) && kbLimit > 0 ? kbLimit : undefined,
      reviewLimit:
        Number.isFinite(reviewLimit) && reviewLimit > 0 ? reviewLimit : undefined,
    })
    return NextResponse.json(ctx)
  } catch (e) {
    console.error("[active-work-context] failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    )
  }
}
