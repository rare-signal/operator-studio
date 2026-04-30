import type { Metadata } from "next"
import { Suspense } from "react"

import {
  loadInboxCandidates,
  loadSessionPlanForInbox,
  type ActivePlan,
} from "@/app/2/v2/data/load"
import { InboxView } from "@/app/2/v2/components/inbox-view"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Inbox" }

export default function InboxPage() {
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxContent />
    </Suspense>
  )
}

async function InboxContent() {
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const candidates = await loadInboxCandidates(workspaceId).catch(() => [])

  const uniqueSessionIds = Array.from(
    new Set(candidates.map((c) => c.sessionId))
  )
  const planEntries = await Promise.all(
    uniqueSessionIds.map(async (sid) => {
      const p = await loadSessionPlanForInbox(workspaceId, sid).catch(
        () => null
      )
      return [sid, p] as const
    })
  )
  const planBySessionId: Record<string, ActivePlan | null> = {}
  for (const [sid, p] of planEntries) planBySessionId[sid] = p

  return (
    <InboxView
      candidates={candidates}
      planBySessionId={planBySessionId}
      homePrefix="/operator-studio"
    />
  )
}

function InboxSkeleton() {
  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="h-8 w-72 rounded bg-stone-200/70 dark:bg-stone-800/70 animate-pulse mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-md bg-stone-200/60 dark:bg-stone-800/60 animate-pulse"
          />
        ))}
      </div>
    </div>
  )
}
