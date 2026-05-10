import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getPlanInventory,
  proposeMergePruneReview,
} from "@/lib/operator-studio/plan-inventory"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/plans/inventory — list every plan with
 * sprawl signals (empty / stale / abandoned / shipped-pinned) and
 * duplicate-title candidates. Read-only.
 *
 * Query params:
 *   staleDays         override the staleness window (default 14)
 *   threshold         override Jaccard duplicate threshold (default 0.5)
 *   propose=duplicates upsert one david-only review item per duplicate
 *                     pair (idempotent via deterministic sourceId).
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  try {
    const workspaceId = await getActiveWorkspaceId()
    const url = new URL(req.url)
    const staleDays = Number(url.searchParams.get("staleDays") ?? "")
    const threshold = Number(url.searchParams.get("threshold") ?? "")
    const inventory = await getPlanInventory(workspaceId, {
      staleDays: Number.isFinite(staleDays) && staleDays > 0 ? staleDays : undefined,
      duplicateThreshold:
        Number.isFinite(threshold) && threshold > 0 && threshold <= 1
          ? threshold
          : undefined,
    })

    const propose = url.searchParams.get("propose")
    const proposed: string[] = []
    if (propose === "duplicates" && inventory.duplicatePairs.length > 0) {
      const titleById = new Map(inventory.plans.map((p) => [p.id, p.title]))
      for (const pair of inventory.duplicatePairs) {
        const aTitle = titleById.get(pair.aPlanId) ?? "(unknown)"
        const bTitle = titleById.get(pair.bPlanId) ?? "(unknown)"
        const item = await proposeMergePruneReview(workspaceId, pair, {
          aTitle,
          bTitle,
        })
        proposed.push(item.id)
      }
    }

    return NextResponse.json({ ...inventory, proposedReviewItemIds: proposed })
  } catch (e) {
    console.error("[plans/inventory] failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    )
  }
}
