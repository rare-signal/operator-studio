import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { isAuthenticated } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  getDashboardStats,
  getThreadsBySource,
  getThreadsByState,
  getVisibleThreads,
} from "@/lib/operator-studio/queries"
import type {
  OperatorReviewState,
  OperatorSourceApp,
} from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

const reviewStates = new Set<OperatorReviewState>([
  "imported",
  "in-review",
  "promoted",
  "archived",
])
const sourceApps = new Set<OperatorSourceApp>([
  "codex",
  "cursor",
  "claude",
  "antigravity",
  "void",
  "manual",
])

export async function GET(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
