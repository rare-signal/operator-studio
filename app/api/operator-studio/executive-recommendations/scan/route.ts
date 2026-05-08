import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  analyzeWorkers,
  persistScanDrafts,
} from "@/lib/operator-studio/worker-continuation-analyzer"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * POST /api/operator-studio/executive-recommendations/scan
 *
 * Runs the worker continuation detector and persists each proposed
 * recommendation. Drafts are deduped per agent + hour bucket via
 * `sourceId`, so re-running within the same hour updates rows in
 * place. Body: { dryRun?: boolean }.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  if (!(await isAdmin(auth)))
    return NextResponse.json({ error: "admin only" }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const dryRun = body && body.dryRun === true

  const workspaceId = await getActiveWorkspaceId()
  const result = await analyzeWorkers(workspaceId, auth.identity ?? "operator")

  if (dryRun) {
    return NextResponse.json({
      scannedAgents: result.scannedAgents,
      inMotionCards: result.inMotionCards,
      proposed: result.drafts.length,
      drafts: result.drafts.map((d) => d.input),
    })
  }

  const persisted = await persistScanDrafts(workspaceId, result.drafts)
  return NextResponse.json({
    scannedAgents: result.scannedAgents,
    inMotionCards: result.inMotionCards,
    proposed: persisted.length,
    items: persisted,
  })
}
