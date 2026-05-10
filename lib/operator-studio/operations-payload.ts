import "server-only"

import { loadActivePlan } from "@/app/2/v2/data/load"
import { listAppSessions } from "@/lib/server/agent-bridge/app-sessions"
import { getRecentAgentActivity } from "@/lib/server/agent-bridge/recent-activity"
import { listTmuxSessions } from "@/lib/server/agent-bridge/tmux"
import type { AgentListItem } from "@/lib/server/agent-bridge/types"

import { listExecutiveRecommendations } from "./executive-recommendations"
import { listLaunchAttempts } from "./launch-attempts"
import { summarizeLaunchWaves, type LaunchWaveLedger } from "./launch-waves"
import {
  deriveOperationsControlLoop,
  type OperationsControlLoopView,
} from "./operations"
import { listReviewItems } from "./review-items"
import { listActiveThreadCardBindings } from "./thread-card-bindings"

export interface BuildOperationsPayloadOptions {
  workspaceId: string
  planId?: string | null
  recentLimit?: number
  manualLinks?: Record<string, string>
}

export interface OperationsPayload {
  view: OperationsControlLoopView
  launchWaveLedger: LaunchWaveLedger
  fetchedAt: string
}

async function buildAgents(): Promise<AgentListItem[]> {
  const [tmux, claude, codex] = await Promise.all([
    listTmuxSessions().catch(() => []),
    listAppSessions("claude", 8).catch(() => []),
    listAppSessions("codex", 8).catch(() => []),
  ])
  const nowMs = Date.now()
  const agents: AgentListItem[] = []
  for (const s of tmux) {
    const ageMs = Math.max(0, nowMs - new Date(s.lastActivityAt).getTime())
    const isLive = s.attached || ageMs < 5_000
    agents.push({
      id: `tmux:${s.name}`,
      kind: "tmux",
      label: s.name,
      source: "tmux",
      lastActivityAt: s.lastActivityAt,
      status: isLive ? "streaming" : "idle",
      project: s.command || null,
      title: null,
      isLive,
    })
  }
  for (const c of claude) {
    agents.push({
      id: `claude:${c.id}`,
      kind: "claude",
      label: c.title?.slice(0, 60) ?? c.id.slice(0, 8),
      source: "claude",
      lastActivityAt: new Date(c.mtimeMs).toISOString(),
      status: c.isLive ? "streaming" : "idle",
      project: c.project,
      title: c.title,
      isLive: c.isLive,
    })
  }
  for (const c of codex) {
    agents.push({
      id: `codex:${c.id}`,
      kind: "codex",
      label: c.title?.slice(0, 60) ?? c.id.slice(0, 8),
      source: "codex",
      lastActivityAt: new Date(c.mtimeMs).toISOString(),
      status: c.isLive ? "streaming" : "idle",
      project: c.project,
      title: c.title,
      isLive: c.isLive,
    })
  }
  return agents
}

export async function buildOperationsPayload(
  opts: BuildOperationsPayloadOptions
): Promise<OperationsPayload> {
  const recentLimit = Math.max(
    4,
    Math.min(64, Number.isFinite(opts.recentLimit) ? opts.recentLimit ?? 24 : 24)
  )
  const [
    activePlan,
    agents,
    recent,
    durableBindings,
    recommendations,
    reviewItems,
    launchAttempts,
  ] = await Promise.all([
    loadActivePlan(opts.workspaceId, opts.planId ?? null).catch(() => null),
    buildAgents(),
    getRecentAgentActivity({ limit: recentLimit }).catch(() => []),
    listActiveThreadCardBindings(opts.workspaceId).catch(() => []),
    listExecutiveRecommendations(opts.workspaceId, {
      includeClosed: true,
      limit: 100,
    }).catch(() => []),
    listReviewItems(opts.workspaceId, { includeClosed: false, limit: 100 }).catch(
      () => []
    ),
    listLaunchAttempts({ status: "all", limit: 100 }).catch(() => []),
  ])

  const durableLinks: Record<string, { stepId: string; planId: string | null }> =
    {}
  for (const b of durableBindings) {
    durableLinks[b.agentId] = { stepId: b.planStepId, planId: b.planId }
  }

  const filteredReviewItems = reviewItems.filter(
    (r) => r.sourceType !== "executive_recommendation"
  )
  const view = deriveOperationsControlLoop({
    activePlan,
    agents,
    recent,
    durableLinks,
    manualLinks: opts.manualLinks,
    recommendations,
    reviewItems: filteredReviewItems,
  })
  const launchWaveLedger = summarizeLaunchWaves({
    agents,
    recent,
    bindings: durableBindings,
    launchAttempts,
    planSteps: activePlan?.steps ?? [],
  })

  return {
    view,
    launchWaveLedger,
    fetchedAt: new Date().toISOString(),
  }
}
