import type { Metadata } from "next"
import { notFound } from "next/navigation"

import {
  getFulfillmentsForSession,
  getMessagesInSessionWindow,
  getSessionById,
  getThreadsInSession,
} from "@/lib/operator-studio/queries"
import { defaultSessionLabel } from "@/lib/operator-studio/sessions"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { computeActivityPulse } from "@/lib/operator-studio/activity-pulse"
import { extractGoldCandidates } from "@/lib/operator-studio/gold-extractor"
import { extractThemes } from "@/lib/operator-studio/theme-extractor"
import { SessionDetail } from "./session-detail"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>
}): Promise<Metadata> {
  const { sessionId } = await params
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const session = await getSessionById(workspaceId, sessionId).catch(
    () => null
  )
  const label =
    session?.label ??
    (session ? defaultSessionLabel(new Date(session.startedAt)) : null)
  return { title: label ?? "Session" }
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const workspaceId = await getActiveWorkspaceId().catch(() => "global")

  const session = await getSessionById(workspaceId, sessionId)
  if (!session) {
    notFound()
  }

  const [sessionThreads, fulfillments, rawMessages] = await Promise.all([
    getThreadsInSession(workspaceId, sessionId).catch(() => []),
    getFulfillmentsForSession(workspaceId, sessionId).catch(() => []),
    getMessagesInSessionWindow(
      workspaceId,
      new Date(session.startedAt),
      new Date(session.endedAt)
    ).catch(() => []),
  ])

  // Thread title lookup for gold candidate attribution.
  const threadTitleById = new Map<string, string | null>()
  for (const t of sessionThreads) {
    threadTitleById.set(t.id, t.promotedTitle ?? t.rawTitle)
  }
  const threadTurnCount = new Map<string, number>()
  for (const m of rawMessages) {
    threadTurnCount.set(
      m.threadId,
      Math.max(threadTurnCount.get(m.threadId) ?? 0, m.turnIndex + 1)
    )
  }

  // Run the three extractors server-side so the detail page renders
  // complete on first paint — no client spinner for "computing themes".
  const gold = extractGoldCandidates(
    rawMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        threadTitle: threadTitleById.get(m.threadId) ?? null,
        role: m.role as "user" | "assistant",
        content: m.content,
        turnIndex: m.turnIndex,
        createdAt: m.createdAt,
        threadTurnCount: threadTurnCount.get(m.threadId) ?? 0,
      }))
  )

  const themes = extractThemes({
    messages: rawMessages.map((m) => ({ id: m.id, content: m.content })),
    topN: 18,
    minMessageHits: 3,
  })

  const pulse = computeActivityPulse({
    sessionStart: session.startedAt,
    sessionEnd: session.endedAt,
    messages: rawMessages.map((m) => ({ createdAt: m.createdAt })),
    targetBuckets: 40,
  })

  return (
    <SessionDetail
      session={session}
      threads={sessionThreads}
      fulfillments={fulfillments}
      gold={gold}
      themes={themes}
      pulse={pulse}
    />
  )
}
