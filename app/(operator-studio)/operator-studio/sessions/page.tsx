import type { Metadata } from "next"

import {
  ensureSessionsForWorkspace,
  getDailyMessageActivity,
  getSessionsForWorkspace,
  getTopThreadsPerSession,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  getShowcaseDailyActivity,
  getShowcaseTopThreadsPerSession,
  isShowcase,
  listShowcaseWorkSessions,
} from "@/lib/operator-studio/showcase-loader"

import { SessionsList } from "./sessions-list"

// Build-time literal — `scripts/showcase-build.ts` substitutes to
// "force-static" for the showcase export.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Sessions" }

/**
 * Session Spaces list page. Shell rendered by the layout — this page
 * fetches only session-specific data.
 */
export default async function SessionsPage() {
  if (isShowcase()) {
    return (
      <SessionsList
        sessions={listShowcaseWorkSessions()}
        activity={getShowcaseDailyActivity()}
        topThreads={getShowcaseTopThreadsPerSession()}
      />
    )
  }

  const workspaceId = await getActiveWorkspaceId().catch(() => "global")

  let sessions: Awaited<ReturnType<typeof getSessionsForWorkspace>> = []
  let activity: Awaited<ReturnType<typeof getDailyMessageActivity>> = []
  let topThreadsPerSession: Awaited<
    ReturnType<typeof getTopThreadsPerSession>
  > = new Map()

  try {
    await ensureSessionsForWorkspace(workspaceId)
    ;[sessions, activity, topThreadsPerSession] = await Promise.all([
      getSessionsForWorkspace(workspaceId),
      getDailyMessageActivity(workspaceId, 30),
      getTopThreadsPerSession(workspaceId, 3),
    ])
  } catch {
    // DB not yet migrated — empty state
  }

  const topThreads: Record<
    string,
    Array<{ threadId: string; title: string | null; messageCount: number }>
  > = {}
  for (const [k, v] of topThreadsPerSession.entries()) topThreads[k] = v

  return (
    <SessionsList
      sessions={sessions}
      activity={activity}
      topThreads={topThreads}
    />
  )
}
