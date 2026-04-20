"use client"

import * as React from "react"
import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorThreadSummary,
  OperatorChatSession,
} from "@/lib/operator-studio/types"
import { ThreadDetail } from "../../components/thread-detail"

interface ThreadDetailClientProps {
  thread: OperatorThread
  messages: OperatorThreadMessage[]
  summaries: OperatorThreadSummary[]
  sessions: OperatorChatSession[]
  forks: OperatorThread[]
  parentMessages: OperatorThreadMessage[]
}

export function ThreadDetailClient({
  thread,
  messages,
  summaries,
  sessions,
  forks,
  parentMessages,
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
      reviewer={reviewer}
      forks={forks}
      parentMessages={parentMessages}
    />
  )
}
