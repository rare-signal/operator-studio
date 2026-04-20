import { notFound } from "next/navigation"

import {
  getChatSessionsByThread,
  getForksOfThread,
  getThreadById,
  getThreadMessages,
  getThreadSummaries,
  getVisibleThreads,
} from "@/lib/operator-studio/queries"
import {
  GLOBAL_WORKSPACE_ID,
  getActiveWorkspace,
  listWorkspaces,
} from "@/lib/operator-studio/workspaces"
import { OperatorStudioShell } from "../../components/operator-studio-shell"
import { ThreadDetailClient } from "./thread-detail-client"

export const dynamic = "force-dynamic"

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params

  const activeWorkspace = await getActiveWorkspace()
  const workspaces = await listWorkspaces()

  // Thread lookup: try the active workspace first, then fall back to global.
  // This keeps workspace isolation for lists and writes, but lets operators
  // view a global thread from a sub-workspace so the cross-workspace "Pull
  // into <workspace>" action in the Copy menu is reachable. The page's
  // activeWorkspace prop still reflects the user's active workspace; the
  // thread itself carries its true workspaceId so the Copy menu can decide
  // which action to offer.
  let thread = await getThreadById(activeWorkspace.id, threadId).catch(() => null)
  let threadWorkspaceId = activeWorkspace.id
  if (!thread && activeWorkspace.id !== GLOBAL_WORKSPACE_ID) {
    thread = await getThreadById(GLOBAL_WORKSPACE_ID, threadId).catch(() => null)
    if (thread) threadWorkspaceId = GLOBAL_WORKSPACE_ID
  }
  if (!thread) notFound()

  // Everything else is fetched from the thread's true workspace, not the
  // viewer's active one, so messages / summaries / forks of a global thread
  // viewed from a sub-workspace all resolve correctly.
  const [messages, summaries, sessions, allThreads, forks] = await Promise.all([
    getThreadMessages(threadWorkspaceId, threadId),
    getThreadSummaries(threadWorkspaceId, threadId),
    getChatSessionsByThread(threadWorkspaceId, threadId),
    getVisibleThreads(activeWorkspace.id),
    getForksOfThread(threadWorkspaceId, threadId),
  ])

  let parentMessages: typeof messages = []
  if (thread.parentThreadId) {
    try {
      parentMessages = await getThreadMessages(
        threadWorkspaceId,
        thread.parentThreadId
      )
    } catch {
      // parent may have been deleted
    }
  }

  return (
    <OperatorStudioShell
      threads={allThreads}
      activeWorkspace={activeWorkspace}
      workspaces={workspaces}
    >
      <ThreadDetailClient
        thread={thread}
        messages={messages}
        summaries={summaries}
        sessions={sessions}
        forks={forks}
        parentMessages={parentMessages}
        activeWorkspace={activeWorkspace}
      />
    </OperatorStudioShell>
  )
}
