import {
  getDashboardStats,
  getVisibleThreads,
} from "@/lib/operator-studio/queries"
import {
  getActiveWorkspace,
  listWorkspaces,
} from "@/lib/operator-studio/workspaces"
import { OperatorStudioShell } from "./components/operator-studio-shell"
import { Dashboard } from "./components/dashboard"

export const dynamic = "force-dynamic"

export default async function OperatorStudioPage() {
  let threads: Awaited<ReturnType<typeof getVisibleThreads>> = []
  let stats: Awaited<ReturnType<typeof getDashboardStats>> | null = null
  let activeWorkspace: Awaited<ReturnType<typeof getActiveWorkspace>> = {
    id: "global",
    label: "Global library",
    isGlobal: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
  let workspaces: Awaited<ReturnType<typeof listWorkspaces>> = []

  try {
    activeWorkspace = await getActiveWorkspace()
    ;[threads, stats, workspaces] = await Promise.all([
      getVisibleThreads(activeWorkspace.id),
      getDashboardStats(activeWorkspace.id),
      listWorkspaces(),
    ])
  } catch {
    // DB not yet migrated — show empty state
  }

  return (
    <OperatorStudioShell
      threads={threads}
      activeWorkspace={activeWorkspace}
      workspaces={workspaces}
    >
      <Dashboard threads={threads} stats={stats} />
    </OperatorStudioShell>
  )
}
