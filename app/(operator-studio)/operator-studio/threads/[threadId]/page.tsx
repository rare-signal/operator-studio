import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  getChatSessionsByThread,
  getForksOfThread,
  getSessionsForWorkspace,
  getThreadById,
  getThreadMessages,
  getThreadSummaries,
} from "@/lib/operator-studio/queries"
import { getThreadForkContext } from "@/lib/operator-studio/fork-divergence"
import {
  GLOBAL_WORKSPACE_ID,
  getActiveWorkspace,
  getActiveWorkspaceId,
} from "@/lib/operator-studio/workspaces"
import {
  getShowcaseActiveWorkspace,
  getShowcaseThreadById,
  getShowcaseThreadMessages,
  getShowcaseThreadSummaries,
  isShowcase,
  listShowcaseThreadIds,
} from "@/lib/operator-studio/showcase-loader"
import { ThreadDetailClient } from "./thread-detail-client"

// Build-time literal — `scripts/showcase-build.ts` substitutes this
// to `"force-static"` for the showcase export, since Next.js requires
// `dynamic` to parse statically.
export const dynamic = "force-dynamic"

export async function generateStaticParams() {
  if (process.env.SHOWCASE !== "1") return []
  return listShowcaseThreadIds().map((threadId) => ({ threadId }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ threadId: string }>
}): Promise<Metadata> {
  const { threadId } = await params
  if (isShowcase()) {
    const thread = getShowcaseThreadById(threadId)
    return { title: thread?.rawTitle ?? "Thread" }
  }
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  let thread = await getThreadById(workspaceId, threadId).catch(() => null)
  if (!thread && workspaceId !== GLOBAL_WORKSPACE_ID) {
    thread = await getThreadById(GLOBAL_WORKSPACE_ID, threadId).catch(
      () => null
    )
  }
  const title = thread?.promotedTitle ?? thread?.rawTitle ?? null
  return { title: title ?? "Thread" }
}

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ threadId: string }>
}) {
  const { threadId } = await params

  if (isShowcase()) {
    const thread = getShowcaseThreadById(threadId)
    if (!thread) notFound()
    const messages = getShowcaseThreadMessages(threadId)
    const summaries = getShowcaseThreadSummaries(threadId)
    return (
      <ThreadDetailClient
        thread={thread}
        messages={messages}
        summaries={summaries}
        sessions={[]}
        planSessions={[]}
        forks={[]}
        parentMessages={[]}
        activeWorkspace={getShowcaseActiveWorkspace()}
        forkContext={null}
      />
    )
  }

  const activeWorkspace = await getActiveWorkspace()

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
  const [
    messages,
    summaries,
    sessions,
    forks,
    planSessions,
    forkContext,
  ] = await Promise.all([
    getThreadMessages(threadWorkspaceId, threadId),
    getThreadSummaries(threadWorkspaceId, threadId),
    getChatSessionsByThread(threadWorkspaceId, threadId),
    getForksOfThread(threadWorkspaceId, threadId),
    getSessionsForWorkspace(threadWorkspaceId),
    getThreadForkContext(threadWorkspaceId, threadId).catch(() => null),
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
    <ThreadDetailClient
      thread={thread}
      messages={messages}
      summaries={summaries}
      sessions={sessions}
      planSessions={planSessions}
      forks={forks}
      parentMessages={parentMessages}
      activeWorkspace={activeWorkspace}
      forkContext={forkContext}
    />
  )
}
