"use client"

import * as React from "react"
import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadSummary,
  OperatorChatSession,
  OperatorSession,
} from "@/lib/operator-studio/types"
import type { ThreadForkContext } from "@/lib/operator-studio/fork-divergence"
import type { Workspace } from "@/lib/operator-studio/workspaces"
import { ThreadDetail } from "../../components/thread-detail"

interface ThreadDetailClientProps {
  thread: OperatorThread
  messages: OperatorThreadMessage[]
  summaries: OperatorThreadSummary[]
  sessions: OperatorChatSession[]
  planSessions: OperatorSession[]
  forks: OperatorThread[]
  parentMessages: OperatorThreadMessage[]
  activeWorkspace: Workspace
  /** Optional — when set and `inheritedCount > 0`, ThreadDetail
   *  collapses the first N turns by default and surfaces a button
   *  to reveal them. Computed by getThreadForkContext on the server
   *  (see fork-divergence.ts). */
  forkContext?: ThreadForkContext | null
}

export function ThreadDetailClient({
  thread,
  messages,
  summaries,
  sessions,
  planSessions,
  forks,
  parentMessages,
  activeWorkspace,
  forkContext,
}: ThreadDetailClientProps) {
  const [reviewer, setReviewer] = React.useState<string | null>(null)

  React.useEffect(() => {
    const stored = localStorage.getItem("operator_studio_reviewer")
    if (stored) setReviewer(stored)
  }, [])

  return (
    <ThreadDetail
      thread={thread}
      messages={messages}
      summaries={summaries}
      sessions={sessions}
      planSessions={planSessions}
      reviewer={reviewer}
      forks={forks}
      parentMessages={parentMessages}
      activeWorkspace={activeWorkspace}
      forkContext={forkContext ?? null}
    />
  )
}
