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

  let thread, messages, summaries, sessions, allThreads, forks

  try {
    ;[thread, messages, summaries, sessions, allThreads, forks] =
      await Promise.all([
        getThreadById(activeWorkspace.id, threadId),
        getThreadMessages(activeWorkspace.id, threadId),
        getThreadSummaries(activeWorkspace.id, threadId),
        getChatSessionsByThread(activeWorkspace.id, threadId),
        getVisibleThreads(activeWorkspace.id),
        getForksOfThread(activeWorkspace.id, threadId),
      ])
  } catch {
    notFound()
  }

  if (!thread) {
    notFound()
  }

  let parentMessages: typeof messages = []
  if (thread.parentThreadId) {
    try {
      parentMessages = await getThreadMessages(
        activeWorkspace.id,
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
      />
    </OperatorStudioShell>
  )
}
