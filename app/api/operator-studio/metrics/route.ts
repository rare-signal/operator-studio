import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getDailyCounts,
  getMetricsSummary,
  getTopAuthors,
  getTopTags,
} from "@/lib/operator-studio/queries/metrics"
import {
  getActiveWorkspace,
  getActiveWorkspaceId,
} from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { days } = parsed.data
  const workspaceId = await getActiveWorkspaceId()
  const workspace = await getActiveWorkspace().catch(() => null)

  const [summary, daily, topAuthors, topTags] = await Promise.all([
    getMetricsSummary(workspaceId),
    getDailyCounts(workspaceId, days),
    getTopAuthors(workspaceId, days, 10),
    getTopTags(workspaceId, 20),
  ])

  return NextResponse.json({
    summary,
    daily,
    topAuthors,
    topTags,
    workspace: {
      id: workspaceId,
      label: workspace?.label ?? workspaceId,
    },
    rangeDays: days,
  })
}
