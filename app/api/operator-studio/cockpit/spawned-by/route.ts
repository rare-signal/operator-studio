/**
 * GET /api/operator-studio/cockpit/spawned-by?exec=<agentId>
 *
 * Returns the composite agent ids of bindings whose
 * `spawned_by_agent_id` matches the provided executive agent id, plus
 * a `workers` array with stable per-binding sequence numbers (1..N) so
 * the cockpit can render "Worker N" labels that don't shift when a
 * worker is marked done.
 *
 * Each active worker entry is enriched with the same metadata shape as
 * /api/operator-studio/agents (label/source/lastActivityAt/status/
 * project/title/isLive) so the cockpit can render the spawned-by
 * drawer directly without intersecting against the recent-agents list.
 * Aged-out workers stay visible as long as their binding is active.
 *
 * Response shape:
 *   {
 *     agentIds: string[]      // active only — back-compat
 *     workers: Array<{
 *       agentId: string,
 *       sequence: number,
 *       active: boolean,
 *       spawnedAt: string,
 *       agentKind: string,
 *       label: string | null,
 *       source: "claude" | "codex" | "tmux",
 *       lastActivityAt: string | null,
 *       status: AgentListItem["status"],
 *       project: string | null,
 *       title: string | null,
 *       isLive: boolean,
 *       reviewStatus: "live" | "candidate-self-believed"
 *                   | "awaiting-berthier-check" | "berthier-reviewed"
 *                   | "human-approved" | "idle",
 *       berthierReviewedAt: string | null,
 *       humanApprovedAt: string | null,
 *     }>
 *   }
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  computeReviewStatus,
  extractLastAssistantSnippet,
  REVIEW_STATUS_RANK,
  type ReviewStatus,
} from "@/lib/operator-studio/review-status"
import {
  autoDetachStaleReadyWorkers,
  getActiveBindingsSpawnedBy,
  getRecentlyDetachedBindingsSpawnedBy,
} from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  getAppSessionEntry,
  getAppSessionTail,
  type AppSlug,
} from "@/lib/server/agent-bridge/app-sessions"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const exec = req.nextUrl.searchParams.get("exec")?.trim()
  if (!exec) {
    return NextResponse.json({ error: "exec required" }, { status: 400 })
  }
  const workspaceId = await getActiveWorkspaceId()

  // Safety-net auto-detach: stale ready-for-review workers that David
  // never circled back to get pulled out of the active rail before we
  // compute the response. Configurable via env var; "0" disables.
  // Multi-tier review (0034): default threshold lifts to 24h —
  // `berthier-reviewed` is the only tier auto-detach now considers.
  const autoDetachMinutesRaw = process.env.OPERATOR_STUDIO_AUTO_DETACH_MINUTES
  const autoDetachMinutes =
    autoDetachMinutesRaw === undefined
      ? 24 * 60
      : Math.max(0, Number(autoDetachMinutesRaw) || 0)
  if (autoDetachMinutes > 0) {
    await autoDetachStaleReadyWorkers(
      workspaceId,
      autoDetachMinutes * 60_000
    ).catch(() => 0)
  }

  const [active, detached] = await Promise.all([
    getActiveBindingsSpawnedBy(workspaceId, exec),
    getRecentlyDetachedBindingsSpawnedBy(workspaceId, exec, 200),
  ])

  const seen = new Set<string>()
  const all = [...active, ...detached].filter((b) => {
    if (seen.has(b.id)) return false
    seen.add(b.id)
    return true
  })

  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const firstByAgent = new Map<
    string,
    {
      agentId: string
      agentKind: string
      spawnedAt: string
      active: boolean
      detachReason: string | null
      berthierReviewedAt: string | null
      humanApprovedAt: string | null
    }
  >()
  for (const b of all) {
    const prior = firstByAgent.get(b.agentId)
    if (!prior) {
      firstByAgent.set(b.agentId, {
        agentId: b.agentId,
        agentKind: b.agentKind,
        spawnedAt: b.createdAt,
        active: b.detachedAt === null,
        detachReason: b.detachedAt !== null ? b.detachReason : null,
        berthierReviewedAt: b.berthierReviewedAt,
        humanApprovedAt: b.humanApprovedAt,
      })
    } else {
      if (b.detachedAt === null) prior.active = true
      if (b.detachedAt !== null && b.detachReason) {
        prior.detachReason = b.detachReason
      }
      // Carry the most-recent review-tier stamps forward.
      if (b.berthierReviewedAt) prior.berthierReviewedAt = b.berthierReviewedAt
      if (b.humanApprovedAt) prior.humanApprovedAt = b.humanApprovedAt
    }
  }

  const ordered = Array.from(firstByAgent.values())
    .sort((a, b) => a.spawnedAt.localeCompare(b.spawnedAt))
    .map((w, i) => ({ ...w, sequence: i + 1 }))

  // Enrich active workers with full metadata. Detached workers don't
  // render in the active drawer so we skip the JSONL lookup for them.
  const workers = await Promise.all(
    ordered.map(async (w) => {
      if (!w.active) {
        return {
          ...w,
          label: null as string | null,
          source: w.agentKind as "claude" | "codex" | "tmux",
          lastActivityAt: null as string | null,
          status: "idle" as const,
          project: null as string | null,
          title: null as string | null,
          isLive: false,
          reviewStatus: (w.humanApprovedAt ? "human-approved" : "idle") as ReviewStatus,
          lastAssistantSnippet: null as string | null,
        }
      }
      const parsed = parseAgentId(w.agentId)
      if (parsed.kind !== "claude" && parsed.kind !== "codex") {
        return {
          ...w,
          label: null,
          source: w.agentKind as "claude" | "codex" | "tmux",
          lastActivityAt: null,
          status: "idle" as const,
          project: null,
          title: null,
          isLive: false,
          reviewStatus: (w.humanApprovedAt ? "human-approved" : "idle") as ReviewStatus,
          lastAssistantSnippet: null as string | null,
        }
      }
      const app: AppSlug = parsed.kind
      const entry = await getAppSessionEntry(app, parsed.ref).catch(() => null)
      if (!entry) {
        return {
          ...w,
          label: null,
          source: app,
          lastActivityAt: null,
          status: "idle" as const,
          project: null,
          title: null,
          isLive: false,
          reviewStatus: (w.humanApprovedAt ? "human-approved" : "idle") as ReviewStatus,
          lastAssistantSnippet: null as string | null,
        }
      }
      // Status comes from parsing the JSONL tail (matches the
      // recent-agents endpoint's behavior). Best-effort — fallback to a
      // mtime-derived coarse status if the tail parse fails. The same
      // tail feeds reviewStatus computation (task_done detection on the
      // last assistant turn, with re-engagement-flips-to-live).
      let status: "idle" | "thinking" | "streaming" | "tool-running" =
        entry.isLive ? "streaming" : "idle"
      const lastActivityAt = new Date(entry.mtimeMs).toISOString()
      let reviewStatus: ReviewStatus = "live"
      let lastAssistantSnippet: string | null = null
      const bindingState = {
        berthierReviewedAt: w.berthierReviewedAt,
        humanApprovedAt: w.humanApprovedAt,
      }
      try {
        const tail = await getAppSessionTail(app, parsed.ref, 50)
        if (!("error" in tail)) {
          status = tail.status
          reviewStatus = computeReviewStatus(tail.turns, lastActivityAt, bindingState)
          lastAssistantSnippet = extractLastAssistantSnippet(tail.turns)
        } else {
          reviewStatus = computeReviewStatus([], lastActivityAt, bindingState)
        }
      } catch {
        reviewStatus = computeReviewStatus([], lastActivityAt, bindingState)
      }
      return {
        ...w,
        label: entry.title?.slice(0, 60) ?? entry.id.slice(0, 8),
        source: app,
        lastActivityAt,
        status,
        project: entry.project,
        title: entry.title,
        isLive: entry.isLive,
        reviewStatus,
        lastAssistantSnippet,
      }
    })
  )

  // Multi-tier review sort (0034): awaiting-berthier-check >
  // berthier-reviewed > live > idle > human-approved. Stable within
  // each tier via spawnedAt. David always sees what's NOT yet
  // human-approved at the top.
  workers.sort((a, b) => {
    const r = REVIEW_STATUS_RANK[a.reviewStatus] - REVIEW_STATUS_RANK[b.reviewStatus]
    if (r !== 0) return r
    return a.spawnedAt.localeCompare(b.spawnedAt)
  })

  const agentIds = Array.from(new Set(active.map((b) => b.agentId)))
  return NextResponse.json({ agentIds, workers })
}
