import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  getDashboardStats,
  getThreadsBySource,
  getThreadsByState,
  getVisibleThreads,
} from "@/lib/operator-studio/queries"
import {
  OPERATOR_SOURCE_APPS,
  type OperatorReviewState,
  type OperatorSourceApp,
} from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

const reviewStates = new Set<OperatorReviewState>([
  "imported",
  "in-review",
  "promoted",
  "archived",
])
const sourceApps = new Set<OperatorSourceApp>(OPERATOR_SOURCE_APPS)

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const { searchParams } = new URL(req.url)
  const stateParam = searchParams.get("state")
  const sourceParam = searchParams.get("source")
  const includeStats = searchParams.get("stats") === "1"

  let threads
  if (stateParam && reviewStates.has(stateParam as OperatorReviewState)) {
    threads = await getThreadsByState(
      workspaceId,
      stateParam as OperatorReviewState
    )
  } else if (sourceParam && sourceApps.has(sourceParam as OperatorSourceApp)) {
    threads = await getThreadsBySource(
      workspaceId,
      sourceParam as OperatorSourceApp
    )
  } else {
    threads = await getVisibleThreads(workspaceId)
  }

  const result: Record<string, unknown> = { threads }
  if (includeStats) {
    result.stats = await getDashboardStats(workspaceId)
  }

  return NextResponse.json(result)
}
