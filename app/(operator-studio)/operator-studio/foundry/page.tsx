/**
 * The Foundry — Skunk Works command-center surface.
 *
 * Lives ALONGSIDE the rest of Operator Studio (dashboard, sessions,
 * threads, etc.) — this is a parallel UX, not a replacement. Same
 * backend, same data model, completely different visual language:
 * dense, dark, monospaced, intelligence-grade. For users who want
 * to see the whole workspace as a single tactical display.
 */

import type { Metadata } from "next"

import {
  ensureSessionsForWorkspace,
  getCircadianActivity,
  getDailyMessageActivity,
  getDashboardStats,
  getHotThreads,
  getPromotionVelocity,
  getRecentFoundryEvents,
  getRecentMessagesAcrossWorkspace,
  getSessionThreadCanvas,
  getSessionsForWorkspace,
  getSourceBreakdown,
  getThreadGenomes,
  getThreadsInSession,
  getTopActors,
  getTopThreadsPerSession,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspace } from "@/lib/operator-studio/workspaces"
import { extractGoldCandidates } from "@/lib/operator-studio/gold-extractor"
import { extractDecisions } from "@/lib/operator-studio/decision-extractor"
import { extractThemes } from "@/lib/operator-studio/theme-extractor"
import { buildConstellation } from "@/lib/operator-studio/theme-graph"
import { FoundryView } from "./foundry-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Foundry" }

export default async function FoundryPage() {
  const activeWorkspace = await getActiveWorkspace().catch(() => ({
    id: "global",
    label: "Global library",
    isGlobal: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }))

  // Empty defaults so the page renders even when DB is bare.
  let stats: Awaited<ReturnType<typeof getDashboardStats>> | null = null
  let sessions: Awaited<ReturnType<typeof getSessionsForWorkspace>> = []
  let activity: Awaited<ReturnType<typeof getDailyMessageActivity>> = []
  let promotionVelocity: Awaited<
    ReturnType<typeof getPromotionVelocity>
  > = []
  let sourceBreakdown: Awaited<ReturnType<typeof getSourceBreakdown>> = []
  let events: Awaited<ReturnType<typeof getRecentFoundryEvents>> = []
  let topThreadsPerSession: Awaited<
    ReturnType<typeof getTopThreadsPerSession>
  > = new Map()
  let recentMessages: Awaited<
    ReturnType<typeof getRecentMessagesAcrossWorkspace>
  > = []
  let circadian: Awaited<ReturnType<typeof getCircadianActivity>> = []
  let topActors: Awaited<ReturnType<typeof getTopActors>> = []
  let hotThreads: Awaited<ReturnType<typeof getHotThreads>> = []
  let genomes: Awaited<ReturnType<typeof getThreadGenomes>> = []

  try {
    await ensureSessionsForWorkspace(activeWorkspace.id)
    ;[
      stats,
      sessions,
      activity,
      promotionVelocity,
      sourceBreakdown,
      events,
      topThreadsPerSession,
      recentMessages,
      circadian,
      topActors,
      hotThreads,
    ] = await Promise.all([
      getDashboardStats(activeWorkspace.id),
      getSessionsForWorkspace(activeWorkspace.id),
      getDailyMessageActivity(activeWorkspace.id, 90),
      getPromotionVelocity(activeWorkspace.id, 30),
      getSourceBreakdown(activeWorkspace.id),
      getRecentFoundryEvents(activeWorkspace.id, 50),
      getTopThreadsPerSession(activeWorkspace.id, 1),
      getRecentMessagesAcrossWorkspace(activeWorkspace.id, {
        days: 14,
        limit: 8000,
      }),
      getCircadianActivity(activeWorkspace.id, 14),
      getTopActors(activeWorkspace.id, 30, 8),
      getHotThreads(activeWorkspace.id, 60, 6),
      getThreadGenomes(activeWorkspace.id, 6, 80),
    ])
  } catch {
    // DB not yet migrated — empty state
  }

  // Workspace-wide gold pass: heuristic extractor over the last 14d
  // of messages, returns top candidates ranked across the entire
  // workspace. The extractor cap (topN) is generous here because
  // Foundry's gold queue is meant to be the firehose.
  const gold = extractGoldCandidates(
    recentMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        threadTitle: m.threadTitle,
        role: m.role as "user" | "assistant",
        content: m.content,
        turnIndex: m.turnIndex,
        createdAt: m.createdAt,
        threadTurnCount: m.threadTurnCount,
      })),
    { topN: 24, maxPerThread: 4, minScore: 3, excerptLength: 320 }
  )

  // Workspace-wide themes: same recent-message corpus.
  const themes = extractThemes({
    messages: recentMessages.map((m) => ({ id: m.id, content: m.content })),
    topN: 32,
    minMessageHits: 4,
  })

  // Decision log — heuristic-flagged decision moments across recent
  // messages. Powers the dedicated DECISIONS panel.
  const decisions = extractDecisions(
    recentMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        threadTitle: m.threadTitle,
        role: m.role as "user" | "assistant",
        content: m.content,
        turnIndex: m.turnIndex,
        createdAt: m.createdAt,
      })),
    { topN: 12 }
  )

  // Constellation: themes as a real network with edges from message-
  // level co-occurrence. Force-laid so positions are stable across
  // refreshes.
  const constellation = buildConstellation(
    themes,
    recentMessages.map((m) => ({ content: m.content })),
    { minCoOccur: 3, iterations: 80, topN: 28 }
  )

  // Signal mix: aggregate which gold-extractor signals are firing
  // across the workspace gold queue. Quick read on what KIND of gold
  // we're surfacing — TLDRs vs emphatic claims vs structured analysis.
  const signalMix: Record<string, number> = {}
  for (const g of gold) {
    for (const s of g.signals) {
      signalMix[s.kind] = (signalMix[s.kind] ?? 0) + 1
    }
  }

  // Breakthrough meter: insight-density (TLDR + insight-callout
  // signals) per turn over the last 24h vs the last 7d baseline.
  // A spike means the user is in heavy-thinking mode right now.
  function densityFor(start: Date, end: Date): {
    insightCount: number
    turnCount: number
  } {
    let insightCount = 0
    let turnCount = 0
    for (const m of recentMessages) {
      const t = new Date(m.createdAt).getTime()
      if (t < start.getTime() || t >= end.getTime()) continue
      turnCount++
      const lc = m.content.toLowerCase()
      if (
        lc.includes("tldr") ||
        lc.includes("the insight is") ||
        lc.includes("key insight") ||
        lc.includes("key decision") ||
        lc.includes("the real")
      ) {
        insightCount++
      }
    }
    return { insightCount, turnCount }
  }
  const now = new Date()
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const recent = densityFor(last24h, now)
  const baseline = densityFor(last7d, last24h)
  const recentDensity =
    recent.turnCount > 0 ? recent.insightCount / recent.turnCount : 0
  const baselineDensity =
    baseline.turnCount > 0 ? baseline.insightCount / baseline.turnCount : 0
  const breakthrough = {
    recentTurns: recent.turnCount,
    recentInsights: recent.insightCount,
    baselineTurns: baseline.turnCount,
    baselineInsights: baseline.insightCount,
    recentDensity,
    baselineDensity,
    deltaPercent:
      baselineDensity > 0
        ? Math.round((recentDensity / baselineDensity - 1) * 100)
        : recentDensity > 0
          ? 100
          : 0,
  }

  // Convert Map to plain object for client serialization.
  const topThreads: Record<
    string,
    Array<{ threadId: string; title: string | null; messageCount: number }>
  > = {}
  for (const [k, v] of topThreadsPerSession.entries()) topThreads[k] = v

  // ── Canvas data — threads from the most recent session (current if
  // live within the last 3h, else the latest past one). The canvas is
  // the hero element above the KPI strip, so we always prefer to
  // render SOMETHING if the workspace has any session at all.
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
  const canvasSession =
    sessions.find((s) => new Date(s.endedAt).getTime() >= threeHoursAgo) ??
    sessions[0] ??
    null

  let canvasThreads: Array<{
    id: string
    title: string | null
    sourceApp: string
    reviewState: string
    messageCount: number
    parentThreadId: string | null
    createdAt: string
  }> = []
  let canvasData: Awaited<ReturnType<typeof getSessionThreadCanvas>> = []

  if (canvasSession) {
    try {
      const canvasSessionThreads = await getThreadsInSession(
        activeWorkspace.id,
        canvasSession.id
      )
      // Cap to 8 threads to keep the canvas breathable; if a session
      // has more, we'll show the busiest ones first.
      const capped = [...canvasSessionThreads]
        .sort((a, b) => b.messageCount - a.messageCount)
        .slice(0, 8)
      canvasThreads = capped.map((t) => ({
        id: t.id,
        title: t.promotedTitle ?? t.rawTitle,
        sourceApp: t.sourceApp,
        reviewState: t.reviewState,
        messageCount: t.messageCount,
        parentThreadId: t.parentThreadId,
        createdAt: t.createdAt,
      }))
      canvasData = await getSessionThreadCanvas(
        activeWorkspace.id,
        canvasThreads.map((t) => t.id)
      )
    } catch {
      // Canvas is best-effort — page still renders without it.
    }
  }

  return (
    <FoundryView
      workspaceLabel={activeWorkspace.label}
      stats={stats}
      sessions={sessions}
      activity={activity}
      promotionVelocity={promotionVelocity}
      sourceBreakdown={sourceBreakdown}
      events={events}
      gold={gold}
      themes={themes}
      topThreads={topThreads}
      circadian={circadian}
      topActors={topActors}
      hotThreads={hotThreads}
      genomes={genomes}
      decisions={decisions}
      constellation={constellation}
      signalMix={signalMix}
      breakthrough={breakthrough}
      canvasSession={canvasSession}
      canvasThreads={canvasThreads}
      canvasData={canvasData}
    />
  )
}
