/**
 * GET /api/operator-studio/operations
 *
 * The single source of truth for the Operations control-loop view.
 * Loads everything Operations needs (active plan + agents + recent
 * activity + durable bindings + executive recommendations + open
 * review items), passes them through `deriveOperationsControlLoop`,
 * and returns the compact view the UI / Codex / future CLI all
 * consume.
 *
 * Optional query params:
 *   planId   override the resolved active plan
 *   limit    cap on returned recent activity items (default 24)
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { loadActivePlan } from "@/app/2/v2/data/load"
import { listExecutiveRecommendations } from "@/lib/operator-studio/executive-recommendations"
import {
  deriveOperationsControlLoop,
  type OperationsControlLoopView,
} from "@/lib/operator-studio/operations"
import { listReviewItems } from "@/lib/operator-studio/review-items"
import { listActiveThreadCardBindings } from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { getRecentAgentActivity } from "@/lib/server/agent-bridge/recent-activity"
import { listAppSessions } from "@/lib/server/agent-bridge/app-sessions"
import { listTmuxSessions } from "@/lib/server/agent-bridge/tmux"
import type { AgentListItem } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const planIdOverride = url.searchParams.get("planId")
  const limitRaw = Number(url.searchParams.get("limit") ?? 24)
  const limit = Math.max(
    4,
    Math.min(64, Number.isFinite(limitRaw) ? limitRaw : 24)
  )

  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const manualLinksParam = url.searchParams.get("manualLinks")
  let manualLinks: Record<string, string> = {}
  if (manualLinksParam) {
    try {
      const parsed = JSON.parse(manualLinksParam)
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") manualLinks[k] = v
        }
      }
    } catch {
      manualLinks = {}
    }
  }

  const [
    activePlan,
    tmux,
    claude,
    codex,
    recent,
    durableBindings,
    recommendations,
    reviewItems,
  ] = await Promise.all([
    loadActivePlan(workspaceId, planIdOverride).catch(() => null),
    listTmuxSessions().catch(() => []),
    listAppSessions("claude", 8).catch(() => []),
    listAppSessions("codex", 8).catch(() => []),
    getRecentAgentActivity({ limit }).catch(() => []),
    listActiveThreadCardBindings(workspaceId).catch(() => []),
    listExecutiveRecommendations(workspaceId, {
      includeClosed: true,
      limit: 100,
    }).catch(() => []),
    // Open review items only — closed ones are noise on the loop.
    listReviewItems(workspaceId, { includeClosed: false, limit: 100 }).catch(
      () => []
    ),
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

  const durableLinks: Record<string, { stepId: string; planId: string | null }> = {}
  for (const b of durableBindings) {
    durableLinks[b.agentId] = { stepId: b.planStepId, planId: b.planId }
  }

  // Strip executive recommendation review items so they don't double-
  // count as "evidence". They flow in via `recommendations`.
  const filteredReviewItems = reviewItems.filter(
    (r) => r.sourceType !== "executive_recommendation"
  )

  const view: OperationsControlLoopView = deriveOperationsControlLoop({
    activePlan,
    agents,
    recent,
    durableLinks,
    manualLinks,
    recommendations,
    reviewItems: filteredReviewItems,
  })

  return NextResponse.json({
    view,
    fetchedAt: new Date().toISOString(),
  })
}
