import type { Metadata } from "next"

import { getThreadCounts } from "@/lib/operator-studio/queries"
import {
  getActiveWorkspace,
  listWorkspaces,
} from "@/lib/operator-studio/workspaces"
import {
  getShowcaseActiveWorkspace,
  getShowcaseThreadCounts,
  isShowcase,
  listShowcaseWorkspaces,
} from "@/lib/operator-studio/showcase-loader"

import { OperatorStudioShell } from "./components/operator-studio-shell"

export const metadata: Metadata = {
  description:
    "Review, summarize, and continue agent coding sessions.",
  robots: { index: false, follow: false },
}

// Shell chrome (sidebar, brand, workspace switcher, search, sub-counts)
// lives at the layout level so it stays mounted across navigation.
// Pages beneath just return their main content — the shell persists
// without re-fetching on every nav.
//
// Data fetched here is intentionally LIGHT:
//   - getActiveWorkspace: single-row cookie lookup
//   - listWorkspaces: small set
//   - getThreadCounts: ONE indexed aggregation query instead of the
//     thousand-row getVisibleThreads() the shell used to call on
//     every page render. Sidebar only needs counts, so we only
//     fetch counts.
export default async function OperatorStudioLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (isShowcase()) {
    return (
      <OperatorStudioShell
        activeWorkspace={getShowcaseActiveWorkspace()}
        workspaces={listShowcaseWorkspaces()}
        threadCounts={getShowcaseThreadCounts()}
      >
        {children}
      </OperatorStudioShell>
    )
  }

  const activeWorkspace = await getActiveWorkspace().catch(() => ({
    id: "global",
    label: "Global library",
    isGlobal: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }))

  const [workspaces, threadCounts] = await Promise.all([
    listWorkspaces().catch(() => []),
    getThreadCounts(activeWorkspace.id).catch(() => ({
      byState: {},
      bySource: {},
      total: 0,
    })),
  ])

  return (
    <OperatorStudioShell
      activeWorkspace={activeWorkspace}
      workspaces={workspaces}
      threadCounts={threadCounts}
    >
      {children}
    </OperatorStudioShell>
  )
}
