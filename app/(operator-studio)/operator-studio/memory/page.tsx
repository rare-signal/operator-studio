import type { Metadata } from "next"

import {
  getDashboardStats,
  getThreadsByState,
  getVisibleThreads,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  getShowcaseDashboardStats,
  isShowcase,
  listShowcaseThreads,
} from "@/lib/operator-studio/showcase-loader"
import { Dashboard } from "../components/dashboard"

// Build-time literal — `scripts/showcase-build.ts` substitutes to
// "force-static" for the showcase export.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Memory" }

const RECENT_THREADS_LIMIT = 100

export default async function OperatorStudioMemoryPage() {
  if (isShowcase()) {
    // Showcase ships every snapshotted thread, not the live cap — the
    // marketing point is "browse the full chat log," so the 100-row
    // limit is wrong here.
    const threads = listShowcaseThreads()
    return <Dashboard threads={threads} stats={getShowcaseDashboardStats()} />
  }

  let threads: Awaited<ReturnType<typeof getVisibleThreads>> = []
  let stats: Awaited<ReturnType<typeof getDashboardStats>> | null = null

  try {
    const workspaceId = await getActiveWorkspaceId()
    const [recent, promoted, inReview, dashStats] = await Promise.all([
      getVisibleThreads(workspaceId, { limit: RECENT_THREADS_LIMIT }),
      getThreadsByState(workspaceId, "promoted"),
      getThreadsByState(workspaceId, "in-review"),
      getDashboardStats(workspaceId),
    ])
    const seen = new Set<string>()
    threads = [...promoted, ...inReview, ...recent].filter((t) => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    stats = dashStats
  } catch {
    // DB not yet migrated — show empty state
  }

  return <Dashboard threads={threads} stats={stats} />
}
