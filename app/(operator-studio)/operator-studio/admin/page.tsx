import {
  getActiveWorkspace,
  listWorkspaces,
} from "@/lib/operator-studio/workspaces"
import { getVisibleThreads } from "@/lib/operator-studio/queries"
import { OperatorStudioShell } from "../components/operator-studio-shell"
import { AdminContent } from "./admin-content"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  let activeWorkspace = await getActiveWorkspace().catch(() => ({
    id: "global",
    label: "Global library",
    isGlobal: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }))

  let workspaces: Awaited<ReturnType<typeof listWorkspaces>> = []
  let threads: Awaited<ReturnType<typeof getVisibleThreads>> = []
  try {
    ;[workspaces, threads] = await Promise.all([
      listWorkspaces(),
      getVisibleThreads(activeWorkspace.id),
    ])
  } catch {
    // DB not yet migrated
  }

  return (
    <OperatorStudioShell
      threads={threads}
      activeWorkspace={activeWorkspace}
      workspaces={workspaces}
    >
      <AdminContent activeWorkspace={activeWorkspace} workspaces={workspaces} />
    </OperatorStudioShell>
  )
}
