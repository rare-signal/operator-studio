"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Home,
  Plus,
  X,
} from "lucide-react"

import {
  BentoPane,
  HotModeSwitch,
  type HotModeStatus,
} from "@/app/2/v2/components/bento-view"
import { SoundToggle } from "../components/sound-toggle"
import { useSound } from "../components/sound-context"
import { MarshalRegion } from "./marshal-region"
import type {
  AgentListItem,
  AgentCompositeId,
  AgentKind,
} from "@/lib/server/agent-bridge/types"
import type { AppStatus } from "@/lib/server/agent-bridge/app-sessions"

// Mirrors `LaneTaskCard` from `lib/operator-studio/work-lane-tasks.ts`.
// Inlined here to keep this client component free of server-only
// imports (the helper is server-only because it touches the DB).
type LaneTaskStatusClient =
  | "open"
  | "in-motion"
  | "covered"
  | "skipped"
interface LaneTaskCard {
  id: string
  title: string
  description: string | null
  status: LaneTaskStatusClient
  updatedAt: string
  createdAt: string
}

// Active rail in the bottom drawer. Mobile shows one at a time via a
// switcher; the planned desktop-sidebar reveal will render both
// simultaneously, at which point this state becomes per-pane.
type CockpitRail = "workers" | "tasks" | "artifacts"
const COCKPIT_RAIL_KEY = "operator-studio:cockpit:active-rail"
function readCockpitRail(): CockpitRail {
  try {
    const raw = window.localStorage.getItem(COCKPIT_RAIL_KEY)
    if (raw === "workers" || raw === "tasks" || raw === "artifacts") return raw
    // Migrate the V2-era "activity" key to its renamed-2026-05-12
    // counterpart so existing users don't fall back to the workers tab
    // on first load.
    if (raw === "activity") {
      try {
        window.localStorage.setItem(COCKPIT_RAIL_KEY, "artifacts")
      } catch {
        /* ignore */
      }
      return "artifacts"
    }
  } catch {
    /* ignore */
  }
  return "workers"
}

type ReviewStatus =
  | "live"
  | "candidate-self-believed"
  | "awaiting-berthier-check"
  | "berthier-reviewed"
  | "human-approved"
  | "idle"

interface SpawnedByWorker {
  agentId: string
  sequence: number
  active: boolean
  spawnedAt: string
  agentKind: string
  label: string | null
  source: "claude" | "codex" | "tmux"
  lastActivityAt: string | null
  status: AppStatus
  project: string | null
  title: string | null
  isLive: boolean
  reviewStatus: ReviewStatus
  berthierReviewedAt?: string | null
  humanApprovedAt?: string | null
  /** Title of the plan_step this worker is bound to — the operator-
   *  meaningful name that says WHAT the worker is for ("Marshal tier",
   *  "CLI quota baseline"). Beats the JSONL kickoff title for telling
   *  workers apart in the rail at a glance. Falls back when null. */
  planStepTitle?: string | null
}

// Multi-tier review sort: awaiting-berthier-check > berthier-reviewed
// > live > idle > human-approved. Mirrors the server route so the
// drawer order matches what /spawned-by returns.
const REVIEW_STATUS_RANK: Record<ReviewStatus, number> = {
  "awaiting-berthier-check": 0,
  "candidate-self-believed": 0,
  "berthier-reviewed": 1,
  live: 2,
  idle: 3,
  "human-approved": 4,
}

// ─── Cockpit lane view ────────────────────────────────────────────────────
// First-principles: copy the Bento focused-mobile shell verbatim, then
// stack BentoPanes inside it as the user populates the lane. Layout:
//
//   no exec set         → full-screen pick list (recent agents)
//   exec, no workers    → full-screen exec BentoPane
//   exec, N workers     → exec on top, workers list on bottom; the list
//                         takes only the height it needs (capped at 50%
//                         once it would push past)
//   exec, worker picked → 50/50 split — exec on top, worker on bottom
//                         (Nintendo-DS style). Either side can be
//                         collapsed via the small chrome controls.
//
// Until the spawn-linkage schema lift lands, `spawnedWorkers` is empty.
// The bottom half stays hidden in that case — the exec gets the entire
// screen, which matches the "don't show workers I haven't spawned"
// directive. After the lift, `spawnedWorkers` is populated from the
// authoritative join and the layout above kicks in unchanged.

const HOME_PREFIX = "/operator-studio"

import {
  LaneEntryView,
  type EnrichedWorkLanePickerLane,
  decideFirstPaint,
  getSessionActiveLaneId,
  setSessionActiveLaneId,
  setStoredActiveLaneId,
} from "./lane-picker"
import { buildArtifactItems } from "@/lib/operator-studio/cockpit-artifact-grouping"

interface CockpitClientProps {
  workspaceId: string
}

export default function CockpitClient({
  workspaceId,
}: CockpitClientProps) {
  // Two-state cockpit:
  //   activeLaneId === null  → lane-picker entry view (full-screen)
  //   activeLaneId !== null  → in-lane view (existing cockpit shell)
  //
  // The picker is the entry experience. We do NOT auto-route into the
  // first lane on cold load — even if a "Default lane" was backfilled.
  // The one exception is the localStorage `last-lane-open` hint: if
  // it's still present in the live lane list, jump straight back in
  // (this is the "I had this lane open and reloaded" case). Anything
  // else surfaces the picker. localStorage is purely a soft hint here,
  // never the source of truth for "what lanes exist" or "what's the
  // exec" — both come from the backend.
  const [lanes, setLanes] = React.useState<EnrichedWorkLanePickerLane[]>([])
  const [lanesError, setLanesError] = React.useState<string | null>(null)
  const [lanesLoaded, setLanesLoaded] = React.useState(false)
  const [activeLaneId, setActiveLaneId] = React.useState<string | null>(null)
  // Desktop = wide viewport reveal layer; at >= 1024px the rail
  // expands from a tab switcher into a three-column workers/tasks/
  // activity side-by-side panel. The timeline-as-toggle button on the
  // top rail was removed (V2): activity is now a tab inside the rail
  // alongside workers and tasks — one unified component per David's
  // 2026-05-12 feedback on the conflation.
  const isDesktop = useIsDesktop()

  const refreshLanes = React.useCallback(async () => {
    try {
      const r = await fetch(
        `/api/operator-studio/work-lanes?workspaceId=${encodeURIComponent(workspaceId)}`,
        { cache: "no-store" }
      )
      if (!r.ok) {
        setLanesError(`HTTP ${r.status}`)
        return
      }
      const data = (await r.json()) as {
        lanes?: EnrichedWorkLanePickerLane[]
      }
      const list = Array.isArray(data?.lanes) ? data.lanes : []
      setLanes(list)
      setLanesError(null)
      setLanesLoaded(true)
      return list
    } catch (e) {
      setLanesError(e instanceof Error ? e.message : "fetch failed")
      setLanesLoaded(true)
    }
  }, [workspaceId])

  // First-load: fetch lanes; only auto-jump if the IN-TAB session
  // marker says the user already picked a lane in THIS browser session
  // AND the lane is still in the live list. A pure localStorage hint
  // (cross-session breadcrumb) is NOT enough — cold loads, new tabs,
  // and fresh app launches all surface the picker. Reloading within
  // the same tab (cmd-R) preserves the sessionStorage marker, so David
  // lands back in the lane he was inside.
  const didInitRef = React.useRef(false)
  React.useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    ;(async () => {
      const list = await refreshLanes()
      const sessionHint = getSessionActiveLaneId(workspaceId)
      const ids = Array.isArray(list) ? list.map((l) => l.id) : []
      const decision = decideFirstPaint(sessionHint, ids)
      if (decision.kind === "lane") setActiveLaneId(decision.laneId)
    })()
  }, [refreshLanes, workspaceId])

  // Poll lanes so counts (live workers / ready-for-review) and exec
  // metadata stay fresh while David is in the picker OR inside a lane.
  React.useEffect(() => {
    const id = window.setInterval(() => {
      refreshLanes()
    }, 8_000)
    return () => window.clearInterval(id)
  }, [refreshLanes])

  const selectLane = React.useCallback(
    (laneId: string) => {
      setActiveLaneId(laneId)
      setStoredActiveLaneId(workspaceId, laneId)
      setSessionActiveLaneId(workspaceId, laneId)
    },
    [workspaceId]
  )
  const backToLanes = React.useCallback(() => {
    setActiveLaneId(null)
    setStoredActiveLaneId(workspaceId, null)
    setSessionActiveLaneId(workspaceId, null)
  }, [workspaceId])

  // Query-string deeplink: ?lane=<id> auto-selects the lane on load and
  // whenever the URL param changes, provided it matches a known lane in
  // the live list. Lets David (or anyone) bookmark/share a URL that
  // jumps straight into a particular cockpit instead of the picker.
  // Purely additive — does not override the sessionStorage hint or the
  // user's explicit picks; the param is just another input that calls
  // selectLane like any tap on the lane card would.
  const searchParams = useSearchParams()
  const queryLaneId = searchParams?.get("lane") ?? null
  const lastAppliedQueryLaneRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!queryLaneId) return
    if (lastAppliedQueryLaneRef.current === queryLaneId) return
    if (!lanes.some((l) => l.id === queryLaneId)) return
    lastAppliedQueryLaneRef.current = queryLaneId
    selectLane(queryLaneId)
  }, [queryLaneId, lanes, selectLane])

  const activeLane = React.useMemo(
    () => lanes.find((l) => l.id === activeLaneId) ?? null,
    [lanes, activeLaneId]
  )

  // Exec source of truth: the lane's `execAgentId` (backend), NOT
  // localStorage and NOT the URL. Reload preserves anointing because we
  // re-fetch the lane on mount.
  const execId: AgentCompositeId | null =
    (activeLane?.execAgentId as AgentCompositeId | null) ?? null

  const [agents, setAgents] = React.useState<AgentListItem[]>([])
  const [agentsError, setAgentsError] = React.useState<string | null>(null)
  const [workerId, setWorkerId] = React.useState<AgentCompositeId | null>(null)
  const [execCollapsed, setExecCollapsed] = React.useState(false)
  // Maximize-pane state for the 50/50 split. Holds the agent id of the
  // pane the user wants to view full-viewport. null = normal split. Cleared
  // automatically when the underlying agent goes away (worker dismissed,
  // exec swapped) so we never get stuck rendering nothing.
  const [maximizedAgentId, setMaximizedAgentId] =
    React.useState<AgentCompositeId | null>(null)
  const [hotMode, setHotMode] = React.useState<HotModeStatus | null>(null)
  // Multi-tier review (0034): when David taps a `berthier-reviewed`
  // worker's pill, hold the agent id here to render the
  // human-approval modal. Null = no modal showing.
  const [ackModalAgentId, setAckModalAgentId] =
    React.useState<AgentCompositeId | null>(null)

  // Hot-mode polling (mirror of BentoView).
  React.useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const r = await fetch("/api/operator-studio/agents/hot-mode", {
          cache: "no-store",
        })
        if (!r.ok) return
        const data = (await r.json()) as HotModeStatus
        if (alive) setHotMode(data)
      } catch {
        /* ignore */
      }
    }
    poll()
    const id = window.setInterval(poll, 5_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // Recent-agents polling — drives the top-level pick list (no exec
  // chosen yet). The spawned-by drawer no longer intersects against
  // this list; it consumes /cockpit/spawned-by directly so aged
  // workers stay visible as long as their binding is active.
  React.useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const r = await fetch("/api/operator-studio/agents?appLimit=40", {
          cache: "no-store",
        })
        if (!r.ok) {
          if (alive) setAgentsError(`HTTP ${r.status}`)
          return
        }
        const data = (await r.json()) as { agents?: AgentListItem[] }
        const items = Array.isArray(data?.agents) ? data.agents : []
        // Defensive: drop items without a stable id.
        const clean = items.filter(
          (a) => typeof a?.id === "string" && a.id.length > 0
        )
        if (alive) {
          setAgents(clean)
          setAgentsError(null)
        }
      } catch (e) {
        if (alive) setAgentsError(e instanceof Error ? e.message : "fetch failed")
      }
    }
    poll()
    const id = window.setInterval(poll, 4_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [])

  // Lane tasks — polled separately from workers. Drives the cockpit
  // Tasks rail (mobile switcher between Workers/Tasks; on a future
  // desktop layout both rails render side-by-side). Empty when the
  // lane has no anchor plan_step yet.
  const [laneTasks, setLaneTasks] = React.useState<LaneTaskCard[]>([])
  const [laneCardStepId, setLaneCardStepId] = React.useState<string | null>(
    null
  )
  const refreshTasks = React.useCallback(async () => {
    if (!activeLaneId) {
      setLaneTasks([])
      setLaneCardStepId(null)
      return
    }
    try {
      const r = await fetch(
        `/api/operator-studio/work-lanes/${encodeURIComponent(activeLaneId)}/tasks`,
        { cache: "no-store" }
      )
      if (!r.ok) return
      const data = (await r.json()) as {
        tasks?: LaneTaskCard[]
        laneCardStepId?: string | null
      }
      setLaneTasks(Array.isArray(data?.tasks) ? data.tasks : [])
      setLaneCardStepId(data?.laneCardStepId ?? null)
    } catch {
      /* ignore */
    }
  }, [activeLaneId])
  React.useEffect(() => {
    refreshTasks()
    const id = window.setInterval(refreshTasks, 6_000)
    return () => window.clearInterval(id)
  }, [refreshTasks])

  // Spawned workers — authoritative via /cockpit/spawned-by, which
  // joins operator_thread_card_bindings on spawned_by_agent_id. Empty
  // until this exec actually originates a worker (binding rows are
  // written at spawn time by /agents/new-session when the caller
  // passes spawnedByAgentId — e.g. the cockpit). No heuristic.
  const [spawnedByWorkers, setSpawnedByWorkers] = React.useState<
    SpawnedByWorker[]
  >([])
  React.useEffect(() => {
    if (!execId) {
      setSpawnedByWorkers([])
      return
    }
    let alive = true
    async function poll() {
      try {
        const r = await fetch(
          `/api/operator-studio/cockpit/spawned-by?exec=${encodeURIComponent(execId!)}`,
          { cache: "no-store" }
        )
        if (!r.ok) return
        const data = (await r.json()) as {
          agentIds?: string[]
          workers?: SpawnedByWorker[]
        }
        const workers = Array.isArray(data?.workers) ? data.workers : []
        if (alive) setSpawnedByWorkers(workers)
      } catch {
        /* ignore */
      }
    }
    poll()
    const id = window.setInterval(poll, 4_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [execId])

  // Exec resolution prefers the live AgentListItem from the recent-
  // agents poll (richer status / title / project). When the exec isn't
  // in that list yet — fresh spawn, aged-out beyond the appLimit cap,
  // or first-paint race — fall back to a placeholder built from the
  // lane's enriched exec block. The lane row carries enough to render
  // the BentoPane without flickering back to the "pick an exec" UI
  // (Bug 2: `lane.execAgentId` is the source of truth).
  const exec = React.useMemo<AgentListItem | null>(() => {
    if (!execId) return null
    const live = agents.find((a) => a.id === execId)
    if (live) return live
    const fallback = activeLane?.exec ?? null
    if (!fallback || fallback.agentId !== execId) return null
    const kind: AgentKind =
      fallback.agentKind === "codex"
        ? "codex"
        : fallback.agentKind === "tmux"
          ? "tmux"
          : "claude"
    const sourceField: "claude" | "codex" | "tmux" =
      kind === "tmux" ? "tmux" : kind === "codex" ? "codex" : "claude"
    return {
      id: execId,
      kind,
      label:
        fallback.label ??
        execId.split(":").slice(1).join(":").slice(0, 8),
      source: sourceField,
      lastActivityAt:
        fallback.lastActivityAt ?? new Date(0).toISOString(),
      status: "idle",
      project: null,
      title: fallback.label,
      isLive: fallback.isLive,
    }
  }, [agents, execId, activeLane])
  const spawnedWorkers = React.useMemo<AgentListItem[]>(() => {
    if (!execId) return []
    const active = spawnedByWorkers.filter(
      (w) => w.active && w.agentId !== execId
    )
    // Pin ready-for-review workers to the top, then live, then idle.
    // Stable within each group via spawnedAt (server-sorted).
    active.sort((a, b) => {
      const r = REVIEW_STATUS_RANK[a.reviewStatus] - REVIEW_STATUS_RANK[b.reviewStatus]
      if (r !== 0) return r
      return a.spawnedAt.localeCompare(b.spawnedAt)
    })
    return active.map((w) => {
      const kind: AgentKind =
        w.source === "tmux" || w.source === "claude" || w.source === "codex"
          ? w.source
          : "claude"
      // Label preference: plan_step.title (what the worker is FOR) →
      // JSONL kickoff title (what the worker said first) → agent-id
      // tail. Lets David see "Marshal tier" / "CLI quota baseline" /
      // "Error watching" at a glance instead of three identical
      // 8-char hashes.
      const preferredLabel =
        w.planStepTitle ??
        w.label ??
        w.agentId.split(":").slice(1).join(":").slice(0, 8)
      return {
        id: w.agentId as AgentCompositeId,
        kind,
        label: preferredLabel,
        source: w.source,
        lastActivityAt: w.lastActivityAt ?? w.spawnedAt,
        status: w.status,
        project: w.project,
        title: w.title,
        isLive: w.isLive,
      }
    })
  }, [spawnedByWorkers, execId])
  // Recently-completed workers — the subset of spawnedByWorkers whose
  // bindings are detached. The exec doesn't render in this list either.
  // Kept separate from `spawnedWorkers` so WorkersList can render an
  // explicit "Completed" section below the active rows.
  const completedSpawnedWorkers = React.useMemo<AgentListItem[]>(() => {
    if (!execId) return []
    const detached = spawnedByWorkers.filter(
      (w) => !w.active && w.agentId !== execId
    )
    // Most-recent first by spawnedAt (server-sorted ascending, so
    // reverse).
    detached.sort((a, b) => b.spawnedAt.localeCompare(a.spawnedAt))
    return detached.map((w) => {
      const kind: AgentKind =
        w.source === "tmux" || w.source === "claude" || w.source === "codex"
          ? w.source
          : "claude"
      // Same label preference as active workers.
      const preferredLabel =
        w.planStepTitle ??
        w.label ??
        w.agentId.split(":").slice(1).join(":").slice(0, 8)
      return {
        id: w.agentId as AgentCompositeId,
        kind,
        label: preferredLabel,
        source: w.source,
        lastActivityAt: w.lastActivityAt ?? w.spawnedAt,
        status: w.status,
        project: w.project,
        title: w.title,
        isLive: w.isLive,
      }
    })
  }, [spawnedByWorkers, execId])
  const workerSequenceByAgentId = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const w of spawnedByWorkers) m.set(w.agentId, w.sequence)
    return m
  }, [spawnedByWorkers])
  const reviewStatusByAgentId = React.useMemo(() => {
    const m = new Map<string, ReviewStatus>()
    for (const w of spawnedByWorkers) m.set(w.agentId, w.reviewStatus)
    return m
  }, [spawnedByWorkers])
  const worker = spawnedWorkers.find((a) => a.id === workerId) ?? null

  // ── Attention sounds: rest vs in-flight ──────────────────────────
  // Per David's spec, the sound must distinguish:
  //   `job_done`   — new activity arrived AND the thread is still
  //                  actively working (isLive=true). "FYI, still
  //                  going" — light, ambient awareness.
  //   `thread_rest`— new activity arrived AND the thread has come to
  //                  rest (isLive=false). "Tap me — done for now."
  //                  This is the "needs your eyes" cue.
  //
  // Scoped to in-lane agents only (exec + spawned workers). All other
  // recent agents in the workspace don't chime — keeps the noise
  // bounded to the active cockpit lane.
  //
  // Each agent's previous (lastActivityAt, isLive) is tracked in a
  // ref so we only fire on actual transitions, not on initial mount
  // or unrelated re-renders.
  const sound = useSound()
  const seenAgentState = React.useRef<
    Map<string, { lastActivityAt: string; isLive: boolean }>
  >(new Map())
  React.useEffect(() => {
    const inLane: AgentListItem[] = []
    if (exec) inLane.push(exec)
    for (const w of spawnedWorkers) inLane.push(w)

    for (const a of inLane) {
      const prev = seenAgentState.current.get(a.id)
      // First observation — record without firing.
      if (!prev) {
        seenAgentState.current.set(a.id, {
          lastActivityAt: a.lastActivityAt,
          isLive: a.isLive,
        })
        continue
      }
      if (a.lastActivityAt !== prev.lastActivityAt) {
        if (a.isLive) {
          sound.fire("job_done", `inflight:${a.id}:${a.lastActivityAt}`)
        } else {
          sound.fire("thread_rest", `rest:${a.id}:${a.lastActivityAt}`)
        }
        seenAgentState.current.set(a.id, {
          lastActivityAt: a.lastActivityAt,
          isLive: a.isLive,
        })
      } else if (a.isLive !== prev.isLive) {
        // No new activity but liveness flipped (e.g. went from
        // streaming to idle). If it just transitioned to rest,
        // chime — that's exactly the "tap me" moment.
        if (prev.isLive && !a.isLive) {
          sound.fire("thread_rest", `rest-only:${a.id}:${a.lastActivityAt}`)
        }
        seenAgentState.current.set(a.id, {
          lastActivityAt: a.lastActivityAt,
          isLive: a.isLive,
        })
      }
    }
  }, [exec, spawnedWorkers, sound])

  // ── Ready-for-review transition sound ─────────────────────────────
  // Fire `thread_rest` when a worker flips INTO ready-for-review from
  // any other state (live/idle). The first observation per worker is
  // recorded WITHOUT firing — opening the cockpit with already-pending
  // reviews shouldn't burst sound.
  const seenReviewStatus = React.useRef<Map<string, ReviewStatus>>(new Map())
  React.useEffect(() => {
    for (const w of spawnedByWorkers) {
      if (!w.active || w.agentId === execId) continue
      const prev = seenReviewStatus.current.get(w.agentId)
      if (prev === undefined) {
        seenReviewStatus.current.set(w.agentId, w.reviewStatus)
        continue
      }
      // Fire when the worker enters a tier that wants eyes — both
      // candidate-self-believed (needs Berthier) and berthier-reviewed
      // (needs David). Don't re-fire on transitions BETWEEN these
      // attention-wanting tiers; only on entry from live/idle.
      const wantsEyes =
        w.reviewStatus === "candidate-self-believed" ||
        w.reviewStatus === "awaiting-berthier-check" ||
        w.reviewStatus === "berthier-reviewed"
      const previouslyWantedEyes =
        prev === "candidate-self-believed" ||
        prev === "awaiting-berthier-check" ||
        prev === "berthier-reviewed"
      if (wantsEyes && !previouslyWantedEyes) {
        sound.fire("thread_rest", `wants-eyes:${w.reviewStatus}:${w.agentId}:${w.lastActivityAt ?? w.spawnedAt}`)
      }
      seenReviewStatus.current.set(w.agentId, w.reviewStatus)
    }
  }, [spawnedByWorkers, execId, sound])

  // ── Hot-mode actions (mirror BentoView exactly) ──
  // The hot-mode endpoint is a single POST switched on `action` in the
  // body — NOT a REST resource with verb routing. Sending DELETE or
  // PATCH returns "Unknown action" because the route only implements
  // GET + POST and POST switches on body.action.
  async function arm(pin: string, durationMs?: number) {
    const r = await fetch("/api/operator-studio/agents/hot-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "arm", pin, durationMs }),
    })
    const data = (await r.json().catch(() => ({}))) as HotModeStatus & {
      error?: string
    }
    if (!r.ok) throw new Error(data?.error ?? "Arm failed")
    setHotMode(data)
  }
  async function disarm() {
    await fetch("/api/operator-studio/agents/hot-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disarm" }),
    }).catch(() => null)
    setHotMode((p) => (p ? { ...p, armed: false, remainingMs: 0 } : p))
  }
  async function extend(extraMs: number) {
    const r = await fetch("/api/operator-studio/agents/hot-mode", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "extend", extraMs }),
    })
    const data = (await r.json().catch(() => ({}))) as HotModeStatus & {
      error?: string
    }
    if (!r.ok) throw new Error(data?.error ?? "Extend failed")
    setHotMode(data)
  }

  // Drop a stale maximize when the maximized agent is no longer one of
  // the rendered panes (exec changed, worker dismissed). Without this
  // the split branch could try to render a pane that's not on screen.
  React.useEffect(() => {
    if (!maximizedAgentId) return
    if (maximizedAgentId === execId) return
    if (maximizedAgentId === workerId) return
    setMaximizedAgentId(null)
  }, [maximizedAgentId, execId, workerId])

  async function pickExec(id: AgentCompositeId) {
    if (!activeLaneId) return
    setWorkerId(null)
    setExecCollapsed(false)
    // Persist per-lane in operator_work_lanes.exec_agent_id (backend
    // source of truth). Local lane list is then refreshed so execId
    // (derived from activeLane.execAgentId) flips immediately.
    const parsed = id.includes(":") ? id.split(":")[0] : "claude"
    try {
      await fetch(
        `/api/operator-studio/work-lanes/${encodeURIComponent(activeLaneId)}/exec`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId: id, agentKind: parsed }),
        }
      )
    } finally {
      await refreshLanes()
    }
  }

  // Spawn a fresh CLI chat as this lane's exec. The backend route
  // handles hot-mode gating, kickoff prompt construction
  // (buildBerthierKickoff), spawn + reconcile, and finally setLaneExec.
  // CLI-only as of 2026-05-12 — the prior Desktop AX path is gone.
  // `kind` chooses Claude (Opus 4.7) vs Codex; both spawn via their
  // respective CLI surface adapters.
  const [creatingFreshExec, setCreatingFreshExec] = React.useState(false)
  const [creatingError, setCreatingError] = React.useState<string | null>(null)
  const createFreshExec = React.useCallback(
    async (kind: "claude-cli" | "codex-cli") => {
      if (!activeLaneId) return
      setCreatingFreshExec(true)
      setCreatingError(null)
      try {
        const appKind = kind === "codex-cli" ? "codex" : "claude"
        const r = await fetch(
          `/api/operator-studio/work-lanes/${encodeURIComponent(activeLaneId)}/exec`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              create: true,
              appKind,
              ...(kind === "claude-cli" ? { model: "claude-opus-4-7" } : {}),
            }),
          }
        )
        const data = (await r.json().catch(() => ({}))) as { error?: string }
        if (!r.ok) {
          throw new Error(data?.error ?? `HTTP ${r.status}`)
        }
      } catch (e) {
        setCreatingError(e instanceof Error ? e.message : "create failed")
      } finally {
        setCreatingFreshExec(false)
        await refreshLanes()
      }
    },
    [activeLaneId, refreshLanes]
  )

  async function clearExec() {
    if (!activeLaneId) return
    setWorkerId(null)
    setExecCollapsed(false)
    try {
      await fetch(
        `/api/operator-studio/work-lanes/${encodeURIComponent(activeLaneId)}/exec`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ agentId: null }),
        }
      )
    } finally {
      await refreshLanes()
    }
  }

  // ── Render shell — same chassis as Bento focused-mobile ──
  //
  // Entry state: when no lane is open, render the full-screen lane
  // picker. This is the primary entry experience David sees on cold
  // reload (with no localStorage hint), on a new device, after a cache
  // clear, etc. No auto-route into "Default lane" — David decides.
  if (activeLaneId === null) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-stone-50 dark:bg-stone-950 overflow-hidden"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <LaneEntryView
          workspaceId={workspaceId}
          lanes={lanes}
          loaded={lanesLoaded}
          error={lanesError}
          onSelect={selectLane}
          onRefresh={refreshLanes}
        />
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-stone-50 dark:bg-stone-950 overflow-hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <TopRail
        exec={exec}
        laneName={activeLane?.name ?? null}
        workerActive={!!worker}
        execCollapsed={execCollapsed}
        onBackToLanes={backToLanes}
        onUnpinExec={clearExec}
        onBackToMain={() => {
          setWorkerId(null)
          setMaximizedAgentId(null)
        }}
        onToggleExecCollapsed={() => setExecCollapsed((v) => !v)}
        hotMode={hotMode}
        onArm={arm}
        onDisarm={disarm}
        onExtend={extend}
        onSetExec={pickExec}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        {!exec ? (
          // STATE A — no exec: full-screen pick list with the new
          // "+ Create fresh exec for this lane" CTA on top (Bug 3).
          <PickList
            title="Pick an executive"
            subtitle="Promote any recent chat to drive this lane, or spawn a fresh chat as the lane's executive."
            agents={agents}
            error={agentsError}
            onPick={pickExec}
            topAction={
              <CreateFreshExecCta
                busy={creatingFreshExec}
                error={creatingError}
                onCreate={createFreshExec}
                onDismissError={() => setCreatingError(null)}
              />
            }
          />
        ) : worker ? (
          // STATE D — worker open: 50/50 split, OR full viewport when one
          // pane has been maximized via the per-pane button.
          maximizedAgentId === exec.id ? (
            <Pane className="flex-1 min-h-0">
              <BentoPane
                key={`exec:${exec.id}`}
                agent={exec}
                active
                planSteps={[]}
                linkedStepId={null}
                onLinkStep={noop}
                homePrefix={HOME_PREFIX}
                planId={null}
                hotMode={hotMode?.armed === true}
                isPinned={false}
                onTogglePin={noop}
                mobileFocused
                isMaximized
                onToggleMaximize={() => setMaximizedAgentId(null)}
              />
            </Pane>
          ) : maximizedAgentId === worker.id ? (
            <Pane className="flex-1 min-h-0">
              <BentoPane
                key={`worker:${worker.id}`}
                agent={worker}
                active
                planSteps={[]}
                linkedStepId={null}
                onLinkStep={noop}
                homePrefix={HOME_PREFIX}
                planId={null}
                hotMode={hotMode?.armed === true}
                isPinned={false}
                onTogglePin={noop}
                mobileFocused
                isMaximized
                onToggleMaximize={() => setMaximizedAgentId(null)}
              />
            </Pane>
          ) : (
            <DraggableSplit
              top={
                <BentoPane
                  key={`exec:${exec.id}`}
                  agent={exec}
                  active
                  planSteps={[]}
                  linkedStepId={null}
                  onLinkStep={noop}
                  homePrefix={HOME_PREFIX}
                  planId={null}
                  hotMode={hotMode?.armed === true}
                  isPinned={false}
                  onTogglePin={noop}
                  mobileFocused
                  isMaximized={false}
                  onToggleMaximize={() => setMaximizedAgentId(exec.id)}
                />
              }
              bottom={
                <BentoPane
                  key={`worker:${worker.id}`}
                  agent={worker}
                  active
                  planSteps={[]}
                  linkedStepId={null}
                  onLinkStep={noop}
                  homePrefix={HOME_PREFIX}
                  planId={null}
                  hotMode={hotMode?.armed === true}
                  isPinned={false}
                  onTogglePin={noop}
                  mobileFocused
                  isMaximized={false}
                  onToggleMaximize={() => setMaximizedAgentId(worker.id)}
                />
              }
            />
          )
        ) : (
          // STATE B+C unified — exec set, no worker picked.
          // Always render the WorkersList rail (even with 0 workers)
          // so the "+ new worker" affordance is reachable. The rail's
          // height is owned by `useRailHeight` inside WorkersList; the
          // exec pane fills whatever remains. Maximize button on the
          // exec pane still hides the rail to grant full viewport.
          <>
            <Pane className="flex-1 min-h-0 border-b border-stone-200 dark:border-stone-800">
              <BentoPane
                key={`exec:${exec.id}`}
                agent={exec}
                active
                planSteps={[]}
                linkedStepId={null}
                onLinkStep={noop}
                homePrefix={HOME_PREFIX}
                planId={null}
                hotMode={hotMode?.armed === true}
                isPinned={false}
                onTogglePin={noop}
                mobileFocused
                isMaximized={maximizedAgentId === exec.id}
                onToggleMaximize={() =>
                  setMaximizedAgentId(
                    maximizedAgentId === exec.id ? null : exec.id
                  )
                }
              />
            </Pane>
            {maximizedAgentId !== exec.id && (
              <Pane className="shrink-0">
                <RailSwitcher
                  workers={spawnedWorkers}
                  completedWorkers={completedSpawnedWorkers}
                  workerSequenceByAgentId={workerSequenceByAgentId}
                  reviewStatusByAgentId={reviewStatusByAgentId}
                  onPickWorker={(id) => setWorkerId(id)}
                  onTapBerthierReviewedPill={(id) => setAckModalAgentId(id)}
                  laneId={activeLane?.id ?? null}
                  onSpawned={refreshLanes}
                  tasks={laneTasks}
                  laneCardStepId={laneCardStepId}
                  onTasksChanged={refreshTasks}
                  isDesktop={isDesktop}
                  marshalLaneId={activeLane?.id ?? null}
                  onOpenMarshalChat={(id) =>
                    setWorkerId(id as AgentCompositeId)
                  }
                />
              </Pane>
            )}
          </>
        )}
      </div>
      {ackModalAgentId && (
        <ReviewAckModal
          agentId={ackModalAgentId}
          onClose={() => setAckModalAgentId(null)}
        />
      )}
    </div>
  )
}

function ReviewAckModal({
  agentId,
  onClose,
}: {
  agentId: AgentCompositeId
  onClose: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  async function call(action: "human-approve" | "send-back", detach: boolean) {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch("/api/operator-studio/cockpit/review-tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, action, detach }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${r.status}`)
      }
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white dark:bg-stone-900 rounded-t-xl sm:rounded-xl border border-stone-200 dark:border-stone-700 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
          Berthier reviewed this — your turn
        </div>
        <div className="mt-1 text-[11.5px] text-stone-500">
          Berthier already looked. You haven&apos;t signed off yet. Mistakes
          only you can catch live in this gap.
        </div>
        {err && (
          <div className="mt-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
            {err}
          </div>
        )}
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => call("human-approve", true)}
            className="w-full inline-flex justify-center px-3 py-2 rounded text-[12.5px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve & retire worker
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => call("human-approve", false)}
            className="w-full inline-flex justify-center px-3 py-2 rounded text-[12.5px] font-semibold bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 disabled:opacity-50"
          >
            Approve, keep worker active
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => call("send-back", false)}
            className="w-full inline-flex justify-center px-3 py-2 rounded text-[12.5px] font-semibold bg-stone-100 text-stone-800 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 disabled:opacity-50"
          >
            Send back for revision
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="w-full inline-flex justify-center px-3 py-2 rounded text-[11.5px] text-stone-500 hover:text-stone-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Building blocks ──────────────────────────────────────────────────────

function noop() {
  /* placeholder */
}

function TopRail({
  exec,
  laneName,
  workerActive,
  execCollapsed,
  onBackToLanes,
  onUnpinExec,
  onBackToMain,
  onToggleExecCollapsed,
  hotMode,
  onArm,
  onDisarm,
  onExtend,
  onSetExec,
}: {
  exec: AgentListItem | null
  laneName: string | null
  workerActive: boolean
  execCollapsed: boolean
  onBackToLanes: () => void
  onUnpinExec: () => void
  onBackToMain: () => void
  onToggleExecCollapsed: () => void
  hotMode: HotModeStatus | null
  onArm: (pin: string, durationMs?: number) => Promise<void>
  onDisarm: () => Promise<void> | void
  onExtend: (extraMs: number) => Promise<void>
  onSetExec: (id: AgentCompositeId) => void | Promise<void>
}) {
  return (
    // Mirror the Bento focused-mobile rail exactly: `sticky top-0 z-30`.
    // The z-30 is load-bearing — it puts the rail (and its
    // HotModeSwitch popover descendant) into a higher stacking layer
    // than the relative `Pane` sibling below. Without it the Pane
    // paints over the popover via DOM order. Don't remove again.
    <div className="sticky top-0 z-30 shrink-0 flex items-center gap-2 px-3 h-11 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      <button
        type="button"
        onClick={onBackToLanes}
        className="inline-flex items-center gap-1 h-7 px-2 -ml-1 rounded text-[11px] font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
        title="Back to lanes"
        aria-label="Back to lanes"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Lanes
      </button>
      {laneName && (
        <span
          className="text-[11px] uppercase tracking-wider text-stone-500 truncate max-w-[40vw]"
          title={laneName}
        >
          {laneName}
        </span>
      )}
      {workerActive ? (
        <>
          <button
            type="button"
            onClick={onBackToMain}
            className="inline-flex items-center gap-1 h-8 px-2 -ml-1 rounded text-[12px] font-semibold text-stone-800 dark:text-stone-100 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700"
            aria-label="Back to main cockpit view"
            title="Back to main view (exec + workers list)"
          >
            <ArrowLeft className="h-4 w-4" />
            <Home className="h-3.5 w-3.5" />
            Cockpit
          </button>
          {exec && (
            <button
              type="button"
              onClick={onToggleExecCollapsed}
              className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
              title={
                execCollapsed
                  ? "Show executive thread above the worker"
                  : "Collapse executive — give the worker the full screen"
              }
            >
              {execCollapsed ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronUp className="h-3 w-3" />
              )}
              {execCollapsed ? "Show exec" : "Collapse exec"}
            </button>
          )}
        </>
      ) : (
        <LaneDropdown onSetExec={onSetExec} />
      )}
      {exec && !workerActive && (
        <button
          type="button"
          onClick={onUnpinExec}
          className="ml-1 inline-flex items-center justify-center h-7 w-7 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:text-stone-200 dark:hover:bg-stone-800"
          title="Unpin executive — back to picker"
          aria-label="Unpin executive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <span className="ml-auto flex items-center gap-1.5">
        <SoundToggle />
        <HotModeSwitch
          status={hotMode}
          onArm={onArm}
          onDisarm={onDisarm}
          onExtend={onExtend}
        />
      </span>
    </div>
  )
}

function Pane({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return (
    <section className={`relative flex flex-col overflow-hidden ${className}`}>
      {children}
    </section>
  )
}

function CreateFreshExecCta({
  busy,
  error,
  onCreate,
  onDismissError,
}: {
  busy: boolean
  error: string | null
  onCreate: (kind: "claude-cli" | "codex-cli") => void | Promise<void>
  onDismissError: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [kind, setKind] = React.useState<"claude-cli" | "codex-cli">("claude-cli")
  if (!expanded) {
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => setExpanded(true)}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {busy
            ? "Spawning fresh exec…"
            : "Create fresh exec for this lane"}
        </button>
        {error && (
          <div
            role="alert"
            className="mt-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300"
          >
            <div className="flex items-start gap-2">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={onDismissError}
                className="text-red-500 hover:text-red-700"
                aria-label="Dismiss error"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </>
    )
  }
  return (
    <div className="rounded-md border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 p-2">
      <div className="text-[11.5px] text-stone-600 dark:text-stone-300 mb-1.5">
        Spawn a fresh chat as this lane&apos;s executive. Hot mode must
        be armed.
      </div>
      <div className="flex items-center gap-1 mb-2">
        {(["claude-cli", "codex-cli"] as const).map((k) => (
          <button
            key={k}
            type="button"
            disabled={busy}
            onClick={() => setKind(k)}
            className={`px-2 py-1 rounded text-[11.5px] uppercase tracking-wider font-semibold ${
              kind === k
                ? "bg-emerald-600 text-white"
                : "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200"
            } disabled:opacity-50`}
          >
            {k === "claude-cli" ? "Claude CLI · Opus 4.7" : "Codex CLI"}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            await onCreate(kind)
            setExpanded(false)
          }}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12.5px] font-semibold disabled:opacity-50"
        >
          {busy ? "Spawning…" : `Spawn ${kind === "claude-cli" ? "Claude" : "Codex"} exec`}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setExpanded(false)}
          className="px-2 py-2 rounded-md text-[12px] text-stone-500 hover:text-stone-700"
        >
          Cancel
        </button>
      </div>
      {error && (
        <div className="mt-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  )
}

function PickList({
  title,
  subtitle,
  agents,
  error,
  onPick,
  topAction,
}: {
  title: string
  subtitle: string
  agents: AgentListItem[]
  error: string | null
  onPick: (id: AgentCompositeId) => void
  topAction?: React.ReactNode
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 pt-4 pb-2">
        <div className="text-[13px] font-semibold text-stone-800 dark:text-stone-200">
          {title}
        </div>
        <div className="mt-0.5 text-[11.5px] text-stone-500 dark:text-stone-500">
          {subtitle}
        </div>
      </div>
      {topAction ? <div className="px-3 pb-2">{topAction}</div> : null}
      {error ? (
        <div className="mx-3 mb-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
          Couldn't load agents: {error}
        </div>
      ) : null}
      {agents.length === 0 ? (
        <div className="px-3 py-6 text-center text-[12px] text-stone-500">
          {error ? "—" : "No recent chats yet."}
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {agents.map((a) => (
            <AgentRow key={a.id} agent={a} onPick={onPick} />
          ))}
        </ul>
      )}
    </div>
  )
}

type WorkersSortBy = "created" | "last-updated"
const WORKERS_SORT_KEY = "operator-studio:cockpit:workers-sort-by"

function readWorkersSortBy(): WorkersSortBy {
  try {
    const raw = window.localStorage.getItem(WORKERS_SORT_KEY)
    if (raw === "created" || raw === "last-updated") return raw
  } catch {
    /* ignore */
  }
  return "created"
}

// ─── Workers rail height (drag-to-resize) ─────────────────────────────────
//
// Mirrors `useSplitRatio` (1453): persists a number to localStorage,
// clamps within [min, max], doubleTap reset. Stored as a pixel value so
// the rail respects min-row-height across viewport sizes; the upper
// bound is computed from viewport height at apply time.
const RAIL_HEIGHT_KEY = "operator-studio:cockpit:workers-rail-height"
const RAIL_MIN_PX = 80
const RAIL_DEFAULT_PX = 220
function railMaxPx(): number {
  if (typeof window === "undefined") return 800
  return Math.max(RAIL_MIN_PX, Math.floor(window.innerHeight * 0.8))
}
function clampRailHeight(h: number): number {
  if (!Number.isFinite(h)) return RAIL_DEFAULT_PX
  return Math.min(railMaxPx(), Math.max(RAIL_MIN_PX, h))
}

function useRailHeight(): [number, (h: number) => void, () => void] {
  const [h, setHState] = React.useState<number>(RAIL_DEFAULT_PX)
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RAIL_HEIGHT_KEY)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) setHState(clampRailHeight(n))
      }
    } catch {
      /* ignore */
    }
  }, [])
  const setH = React.useCallback((next: number) => {
    const clamped = clampRailHeight(next)
    setHState(clamped)
    try {
      window.localStorage.setItem(RAIL_HEIGHT_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])
  const reset = React.useCallback(() => setH(RAIL_DEFAULT_PX), [setH])
  return [h, setH, reset]
}

function WorkersList({
  workers,
  completedWorkers,
  workerSequenceByAgentId,
  reviewStatusByAgentId,
  onPick,
  onTapBerthierReviewedPill,
  laneId,
  onSpawned,
  embedded,
  marshalLaneId,
  onOpenMarshalChat,
}: {
  workers: AgentListItem[]
  /** Workers whose bindings are detached. Rendered as a collapsible
   *  "Completed" section below the active rows, separated by a thin
   *  divider. Defaults to empty so older callers don't break. */
  completedWorkers?: AgentListItem[]
  workerSequenceByAgentId: Map<string, number>
  reviewStatusByAgentId?: Map<string, ReviewStatus>
  onPick: (id: AgentCompositeId) => void
  onTapBerthierReviewedPill?: (id: AgentCompositeId) => void
  /** When set, the "+ new worker" affordance is rendered. Tap opens an
   *  inline form; submit POSTs to /work-lanes/[id]/spawn-worker. */
  laneId?: string | null
  onSpawned?: () => void
  /** True when WorkersList is embedded in the desktop three-column
   *  layout. Disables its own height + drag handle (the parent
   *  RailSwitcher owns both at desktop). The internal rail header
   *  collapses to a thin "+ new worker" bar with no resize affordance. */
  embedded?: boolean
  /** When set, renders the MarshalRegion pinned sticky-top inside the
   *  workers scroll list — appears as the always-visible first item
   *  in the spawned drawer, scrolling workers tucking underneath it. */
  marshalLaneId?: string | null
  onOpenMarshalChat?: (agentId: string) => void
}) {
  // Sort posture: DESCENDING by chosen field (newest at top — the
  // most-recent spawn or most-recent activity is what David wants
  // to see first when scanning). Default sort field = 'created'
  // (stable spawn order via workerSequence; doesn't jump around as
  // workers grind). Toggle to 'last-updated' to see the most-
  // recently-active worker at the top. Persisted to localStorage.
  const [sortBy, setSortByState] = React.useState<WorkersSortBy>("created")
  React.useEffect(() => {
    setSortByState(readWorkersSortBy())
  }, [])
  const setSortBy = React.useCallback((next: WorkersSortBy) => {
    setSortByState(next)
    try {
      window.localStorage.setItem(WORKERS_SORT_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const sortedWorkers = React.useMemo(() => {
    const copy = [...workers]
    if (sortBy === "created") {
      copy.sort((a, b) => {
        // Descending by workerSequence (HIGHER = newer = top).
        // Workers without sequence sink to the bottom so the
        // sequenced ones stay chronological.
        const sa = workerSequenceByAgentId.get(a.id)
        const sb = workerSequenceByAgentId.get(b.id)
        if (sa === undefined && sb === undefined) {
          return b.lastActivityAt.localeCompare(a.lastActivityAt)
        }
        if (sa === undefined) return 1
        if (sb === undefined) return -1
        return sb - sa
      })
    } else {
      // Descending by last-activity timestamp (newest at top).
      copy.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    }
    return copy
  }, [workers, workerSequenceByAgentId, sortBy])

  // Spawn form state. Hidden until "+" is tapped. CLI-only as of
  // 2026-05-12 — the form chooses between Claude CLI (Opus 4.7) and
  // Codex CLI; the retired Desktop AX path is not reachable from here.
  const [spawnOpen, setSpawnOpen] = React.useState(false)
  const [spawnPrompt, setSpawnPrompt] = React.useState("")
  const [spawnAppKind, setSpawnAppKind] = React.useState<"claude" | "codex">(
    "claude"
  )
  const [spawnBusy, setSpawnBusy] = React.useState(false)
  const [spawnError, setSpawnError] = React.useState<string | null>(null)

  const submitSpawn = React.useCallback(async () => {
    if (!laneId) return
    const prompt = spawnPrompt.trim()
    if (!prompt) {
      setSpawnError("prompt required")
      return
    }
    setSpawnBusy(true)
    setSpawnError(null)
    try {
      const r = await fetch(
        `/api/operator-studio/work-lanes/${encodeURIComponent(laneId)}/spawn-worker`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt,
            appKind: spawnAppKind,
            ...(spawnAppKind === "claude"
              ? { model: "claude-opus-4-7" }
              : {}),
          }),
        }
      )
      const data = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        throw new Error(data?.error ?? `HTTP ${r.status}`)
      }
      setSpawnOpen(false)
      setSpawnPrompt("")
      onSpawned?.()
    } catch (e) {
      setSpawnError(e instanceof Error ? e.message : "spawn failed")
    } finally {
      setSpawnBusy(false)
    }
  }, [laneId, spawnPrompt, spawnAppKind, onSpawned])

  // Feature 1 — Drag-to-resize rail height. The header doubles as the
  // drag handle (sort buttons and "+" stop propagation so taps still
  // work). The container's height is owned here and persisted via
  // `useRailHeight`.
  const [railHeight, setRailHeight] = useRailHeight()
  const dragStateRef = React.useRef<{
    startClientY: number
    startHeight: number
    pointerId: number
  } | null>(null)
  const lastTapRef = React.useRef<number>(0)

  const onHeaderPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Don't initiate drag if the pointerdown was on a child button
      // (those stopPropagation themselves, but be defensive).
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      dragStateRef.current = {
        startClientY: e.clientY,
        startHeight: railHeight,
        pointerId: e.pointerId,
      }
    },
    [railHeight]
  )
  const onHeaderPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      // Drag UP on the header → rail grows (header is at top of rail).
      const delta = drag.startClientY - e.clientY
      setRailHeight(drag.startHeight + delta)
    },
    [setRailHeight]
  )
  const onHeaderPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
      dragStateRef.current = null
    },
    []
  )
  const onHeaderClick = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      setRailHeight(RAIL_DEFAULT_PX)
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
    }
  }, [setRailHeight])

  return (
    <div
      className={
        embedded
          ? "flex flex-col flex-1 min-h-0"
          : "flex flex-col"
      }
      style={
        embedded
          ? { touchAction: "none" }
          : { height: railHeight, touchAction: "none" }
      }
      data-testid="cockpit-workers-rail"
    >
      <div
        role={embedded ? undefined : "separator"}
        aria-orientation={embedded ? undefined : "horizontal"}
        aria-label={embedded ? undefined : "Drag to resize workers rail"}
        onPointerDown={embedded ? undefined : onHeaderPointerDown}
        onPointerMove={embedded ? undefined : onHeaderPointerMove}
        onPointerUp={embedded ? undefined : onHeaderPointerUp}
        onPointerCancel={embedded ? undefined : onHeaderPointerUp}
        onClick={embedded ? undefined : onHeaderClick}
        onDoubleClick={
          embedded ? undefined : () => setRailHeight(RAIL_DEFAULT_PX)
        }
        className={`sticky top-0 z-10 px-3 py-1 border-b border-stone-200 dark:border-stone-800 bg-stone-100/95 dark:bg-stone-900/95 backdrop-blur flex items-center gap-2 select-none ${
          embedded ? "" : "cursor-ns-resize"
        }`}
        data-workers-rail-header
        title={embedded ? undefined : "Drag to resize. Double-tap to reset."}
      >
        <span className="text-[10px] uppercase tracking-wider text-stone-500 pointer-events-none">
          {embedded ? "Spawned" : "Workers spawned by exec"}
        </span>
        {laneId && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setSpawnOpen((v) => !v)
            }}
            className="inline-flex items-center justify-center h-5 w-5 rounded border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800"
            aria-label={spawnOpen ? "Close new worker form" : "New worker"}
            title="Spawn a new worker (Berthier-bypass)"
            data-testid="cockpit-spawn-worker-button"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        <span
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-auto inline-flex rounded-md border border-stone-300 dark:border-stone-700 overflow-hidden text-[9.5px] uppercase tracking-wider"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSortBy("created")
            }}
            className={`px-2 py-0.5 ${
              sortBy === "created"
                ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-transparent text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
            }`}
            aria-pressed={sortBy === "created"}
            title="Sort by spawn order (descending — newest at top)"
          >
            Created
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSortBy("last-updated")
            }}
            className={`px-2 py-0.5 border-l border-stone-300 dark:border-stone-700 ${
              sortBy === "last-updated"
                ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-transparent text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
            }`}
            aria-pressed={sortBy === "last-updated"}
            title="Sort by last activity (descending — most-recently-active at top)"
          >
            Updated
          </button>
        </span>
      </div>
      {spawnOpen && laneId && (
        <div
          className="px-3 py-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 flex flex-col gap-2"
          data-testid="cockpit-spawn-worker-form"
        >
          <textarea
            value={spawnPrompt}
            onChange={(e) => setSpawnPrompt(e.target.value)}
            placeholder="Prompt for the new worker…"
            rows={3}
            className="w-full text-[12px] rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2 py-1 resize-y"
            disabled={spawnBusy}
          />
          <div className="flex items-center gap-2">
            <label className="text-[10px] uppercase tracking-wider text-stone-500">
              App
              <select
                value={spawnAppKind}
                onChange={(e) =>
                  setSpawnAppKind(
                    e.target.value === "codex" ? "codex" : "claude"
                  )
                }
                disabled={spawnBusy}
                className="ml-1 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px] px-1 py-0.5 normal-case tracking-normal"
              >
                <option value="claude">Claude</option>
                <option value="codex">Codex</option>
              </select>
            </label>
            <button
              type="button"
              onClick={submitSpawn}
              disabled={spawnBusy || spawnPrompt.trim().length === 0}
              className="ml-auto rounded bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 text-[11px] px-2 py-1 disabled:opacity-50"
            >
              {spawnBusy ? "Spawning…" : "Spawn"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSpawnOpen(false)
                setSpawnError(null)
              }}
              disabled={spawnBusy}
              className="rounded border border-stone-300 dark:border-stone-700 text-[11px] px-2 py-1 text-stone-600 dark:text-stone-300"
            >
              Cancel
            </button>
          </div>
          {spawnError && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              {spawnError}
            </p>
          )}
        </div>
      )}
      {sortedWorkers.length === 0 && !marshalLaneId ? (
        <div
          className="px-3 py-4 text-[12px] text-stone-500 dark:text-stone-400 text-center"
          data-testid="cockpit-workers-empty"
        >
          {laneId
            ? "No workers yet — tap + to spawn one."
            : "No workers yet."}
        </div>
      ) : (
      <div className="flex-1 min-h-0 overflow-y-auto">
        {marshalLaneId && (
          <div
            className="sticky top-0 z-10 shadow-md"
            data-testid="marshal-pinned-top"
          >
            <MarshalRegion
              laneId={marshalLaneId}
              onOpenChat={onOpenMarshalChat}
            />
          </div>
        )}
        {sortedWorkers.length === 0 ? (
          <div
            className="px-3 py-4 text-[12px] text-stone-500 dark:text-stone-400 text-center"
            data-testid="cockpit-workers-empty"
          >
            {laneId
              ? "No workers yet — tap + to spawn one."
              : "No workers yet."}
          </div>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {sortedWorkers.map((a) => {
              const tier = reviewStatusByAgentId?.get(a.id) ?? null
              return (
                <AgentRow
                  key={a.id}
                  agent={a}
                  workerSequence={workerSequenceByAgentId.get(a.id) ?? null}
                  reviewStatus={tier}
                  onPick={onPick}
                  onTapPill={
                    tier === "berthier-reviewed" && onTapBerthierReviewedPill
                      ? onTapBerthierReviewedPill
                      : undefined
                  }
                />
              )
            })}
          </ul>
        )}
      </div>
      )}
      {completedWorkers && completedWorkers.length > 0 && (
        <CompletedWorkersSection
          workers={completedWorkers}
          workerSequenceByAgentId={workerSequenceByAgentId}
          onPick={onPick}
        />
      )}
    </div>
  )
}

// ─── CompletedWorkersSection ──────────────────────────────────────────────
// Collapsible "recently completed" rail tail. Surfaces workers whose
// bindings have been detached (marked done / auto-detached) so David
// can scan what shipped without losing them from the rail entirely.
// Default collapsed at mobile, expanded at desktop where there's room.
function CompletedWorkersSection({
  workers,
  workerSequenceByAgentId,
  onPick,
}: {
  workers: AgentListItem[]
  workerSequenceByAgentId: Map<string, number>
  onPick: (id: AgentCompositeId) => void
}) {
  const [open, setOpen] = React.useState<boolean>(false)
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(
        "operator-studio:cockpit:completed-workers-open"
      )
      if (stored === "1") setOpen(true)
    } catch {
      /* ignore */
    }
  }, [])
  const toggle = React.useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(
          "operator-studio:cockpit:completed-workers-open",
          next ? "1" : "0"
        )
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])
  return (
    <div
      className="border-t-2 border-stone-200 dark:border-stone-800 bg-stone-50/60 dark:bg-stone-950/40"
      data-testid="cockpit-completed-workers"
    >
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800/60"
        aria-expanded={open}
      >
        <span>
          Completed{" "}
          <span className="text-stone-400 dark:text-stone-500">
            ({workers.length})
          </span>
        </span>
        <span aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {workers.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              workerSequence={workerSequenceByAgentId.get(a.id) ?? null}
              reviewStatus={null}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Rail switcher (mobile) ───────────────────────────────────────────────
// Wraps WorkersList and TasksList in a tab-strip header so the bottom
// drawer can host either rail. Defaults to "workers" (preserves the
// current UX). On the planned desktop layout (sibling card
// `step-cockpit-desktop-resolution-sidebar`) this component will be
// bypassed entirely — both rails will render side-by-side instead.
function RailSwitcher({
  workers,
  completedWorkers,
  workerSequenceByAgentId,
  reviewStatusByAgentId,
  onPickWorker,
  onTapBerthierReviewedPill,
  laneId,
  onSpawned,
  tasks,
  laneCardStepId,
  onTasksChanged,
  isDesktop,
  marshalLaneId,
  onOpenMarshalChat,
}: {
  workers: AgentListItem[]
  /** Workers spawned by this exec whose bindings have been detached
   *  (marked done / auto-detached). Rendered as a "Completed" section
   *  inside WorkersList. */
  completedWorkers: AgentListItem[]
  workerSequenceByAgentId: Map<string, number>
  reviewStatusByAgentId?: Map<string, ReviewStatus>
  onPickWorker: (id: AgentCompositeId) => void
  onTapBerthierReviewedPill?: (id: AgentCompositeId) => void
  laneId?: string | null
  onSpawned?: () => void
  tasks: LaneTaskCard[]
  laneCardStepId: string | null
  onTasksChanged: () => void
  /** When true (viewport >= ~1024px), render all three panels side-by-
   *  side instead of behind a tab switcher. Sibling cards:
   *  `step-cockpit-desktop-resolution-sidebar`,
   *  `step-cockpit-horizontal-timeline-view`. */
  isDesktop?: boolean
  /** Plumbing for the pinned Marshal region inside WorkersList. Sticky-
   *  top inside the workers scroll container so the Marshal stays
   *  visible regardless of scroll position in the workers list. */
  marshalLaneId?: string | null
  onOpenMarshalChat?: (agentId: string) => void
}) {
  const [rail, setRailState] = React.useState<CockpitRail>("workers")
  const handleJumpToStep = React.useCallback((stepId: string) => {
    const ev = new CustomEvent("cockpit:jump-to-step", {
      detail: { stepId },
    })
    window.dispatchEvent(ev)
  }, [])

  // Desktop layout owns the rail-row height — at desktop the three
  // columns each have their own internal scroll, but the row itself
  // resizes via a single drag handle here. Same useRailHeight key
  // (`operator-studio:cockpit:workers-rail-height`) as the mobile rails
  // so the resize state is shared across layouts.
  const [desktopRailHeight, setDesktopRailHeight] = useRailHeight()
  const dragStateRef = React.useRef<{
    startClientY: number
    startHeight: number
    pointerId: number
  } | null>(null)
  const lastTapRef = React.useRef<number>(0)
  const onDragPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      dragStateRef.current = {
        startClientY: e.clientY,
        startHeight: desktopRailHeight,
        pointerId: e.pointerId,
      }
    },
    [desktopRailHeight]
  )
  const onDragPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const delta = drag.startClientY - e.clientY
      setDesktopRailHeight(drag.startHeight + delta)
    },
    [setDesktopRailHeight]
  )
  const onDragPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
      dragStateRef.current = null
    },
    []
  )
  const onDragClick = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      setDesktopRailHeight(RAIL_DEFAULT_PX)
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
    }
  }, [setDesktopRailHeight])
  React.useEffect(() => {
    setRailState(readCockpitRail())
  }, [])
  const setRail = React.useCallback((next: CockpitRail) => {
    setRailState(next)
    try {
      window.localStorage.setItem(COCKPIT_RAIL_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  // At desktop resolution (>= 1024px) all three panels render side-by-
  // side so the operator sees workers AND tasks AND the lane activity
  // at a glance. The mobile/narrow experience stays exactly the same:
  // a single panel behind a tab switcher.
  if (isDesktop) {
    return (
      <div
        className="flex flex-col"
        style={{ height: desktopRailHeight, touchAction: "none" }}
        data-testid="cockpit-rail-switcher"
        data-rail-layout="desktop-side-by-side"
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize the rail (workers / tasks / activity)"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
          onClick={onDragClick}
          onDoubleClick={() => setDesktopRailHeight(RAIL_DEFAULT_PX)}
          className="shrink-0 h-2 border-b border-stone-300 dark:border-stone-700 bg-stone-200/70 dark:bg-stone-800/70 hover:bg-stone-300 dark:hover:bg-stone-700 cursor-ns-resize select-none flex items-center justify-center"
          title="Drag to resize the rail. Double-tap to reset."
        >
          <span className="block w-10 h-0.5 bg-stone-400 dark:bg-stone-500 rounded" aria-hidden />
        </div>
        <div className="flex flex-row flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 min-h-0 border-r border-stone-200 dark:border-stone-800 flex flex-col">
            <WorkersList
              workers={workers}
              completedWorkers={completedWorkers}
              workerSequenceByAgentId={workerSequenceByAgentId}
              reviewStatusByAgentId={reviewStatusByAgentId}
              onPick={onPickWorker}
              onTapBerthierReviewedPill={onTapBerthierReviewedPill}
              laneId={laneId}
              onSpawned={onSpawned}
              embedded
              marshalLaneId={marshalLaneId}
              onOpenMarshalChat={onOpenMarshalChat}
            />
          </div>
          <div className="flex-1 min-w-0 min-h-0 border-r border-stone-200 dark:border-stone-800 flex flex-col">
            <TasksList
              tasks={tasks}
              laneId={laneId ?? null}
              laneCardStepId={laneCardStepId}
              onChanged={onTasksChanged}
              embedded
            />
          </div>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col">
            <div className="px-3 py-1 border-b border-stone-200 dark:border-stone-800 bg-stone-100/95 dark:bg-stone-900/95">
              <span className="text-[10px] uppercase tracking-wider text-stone-500">
                Artifacts
              </span>
            </div>
            <ArtifactsList laneId={laneId ?? null} onJumpToStep={handleJumpToStep} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col" data-testid="cockpit-rail-switcher">
      <div className="px-2 py-1 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setRail("workers")}
          className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${
            rail === "workers"
              ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
              : "text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
          }`}
          aria-pressed={rail === "workers"}
          data-testid="cockpit-rail-switch-workers"
        >
          Workers
        </button>
        <button
          type="button"
          onClick={() => setRail("tasks")}
          className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${
            rail === "tasks"
              ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
              : "text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
          }`}
          aria-pressed={rail === "tasks"}
          data-testid="cockpit-rail-switch-tasks"
        >
          Tasks
        </button>
        <button
          type="button"
          onClick={() => setRail("artifacts")}
          className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${
            rail === "artifacts"
              ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900"
              : "text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
          }`}
          aria-pressed={rail === "artifacts"}
          data-testid="cockpit-rail-switch-artifacts"
        >
          Artifacts
        </button>
      </div>
      {rail === "workers" ? (
        <WorkersList
          workers={workers}
          completedWorkers={completedWorkers}
          workerSequenceByAgentId={workerSequenceByAgentId}
          reviewStatusByAgentId={reviewStatusByAgentId}
          onPick={onPickWorker}
          onTapBerthierReviewedPill={onTapBerthierReviewedPill}
          laneId={laneId}
          onSpawned={onSpawned}
          marshalLaneId={marshalLaneId}
          onOpenMarshalChat={onOpenMarshalChat}
        />
      ) : rail === "tasks" ? (
        <TasksList
          tasks={tasks}
          laneId={laneId ?? null}
          laneCardStepId={laneCardStepId}
          onChanged={onTasksChanged}
        />
      ) : (
        <ArtifactsList laneId={laneId ?? null} onJumpToStep={handleJumpToStep} />
      )}
    </div>
  )
}

// ─── TasksList ────────────────────────────────────────────────────────────
// Mirror of WorkersList for plan-card tasks. Same drag-resize header,
// same sort toggle (created / last-updated), same inline "+" create
// form pattern. Status flips via PATCH `/tasks`.
//
// MODAL-EXTRACTION NOTE (surprise discovered while wiring this in): the
// brief said to reuse the "plan-page card-create modal". There isn't
// one — `app/2/v2/components/plan-view.tsx#addCard` just inserts a
// placeholder "New step" inline via `persistSteps`. The closest
// existing pattern is the cockpit's inline spawn form (WorkersList
// above). Building a modal here would be an invention, not a reuse, so
// we mirror the inline-form pattern instead. If a real card-create
// modal lands later, both rails should adopt it together.
type TasksSortBy = "created" | "last-updated"
const TASKS_SORT_KEY = "operator-studio:cockpit:tasks-sort-by"
function readTasksSortBy(): TasksSortBy {
  try {
    const raw = window.localStorage.getItem(TASKS_SORT_KEY)
    if (raw === "created" || raw === "last-updated") return raw
  } catch {
    /* ignore */
  }
  return "last-updated"
}

const TASK_STATUS_RANK: Record<LaneTaskStatusClient, number> = {
  open: 0,
  "in-motion": 1,
  covered: 2,
  skipped: 3,
}

function statusPillClass(s: LaneTaskStatusClient): string {
  switch (s) {
    case "open":
      return "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
    case "in-motion":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
    case "covered":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
    case "skipped":
      return "bg-stone-100 text-stone-400 dark:bg-stone-900 dark:text-stone-500"
  }
}

function TasksList({
  tasks,
  laneId,
  laneCardStepId,
  onChanged,
  embedded,
}: {
  tasks: LaneTaskCard[]
  laneId: string | null
  laneCardStepId: string | null
  onChanged: () => void
  /** True when TasksList is embedded in the desktop three-column
   *  layout. Disables its own height + drag handle (the parent
   *  RailSwitcher owns both at desktop). */
  embedded?: boolean
}) {
  const [sortBy, setSortByState] = React.useState<TasksSortBy>("last-updated")
  React.useEffect(() => {
    setSortByState(readTasksSortBy())
  }, [])
  const setSortBy = React.useCallback((next: TasksSortBy) => {
    setSortByState(next)
    try {
      window.localStorage.setItem(TASKS_SORT_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const sortedTasks = React.useMemo(() => {
    const copy = [...tasks]
    copy.sort((a, b) => {
      // Open/in-motion float above covered/skipped regardless of sort.
      const rDelta = TASK_STATUS_RANK[a.status] - TASK_STATUS_RANK[b.status]
      if (rDelta !== 0) return rDelta
      const aKey = sortBy === "created" ? a.createdAt : a.updatedAt
      const bKey = sortBy === "created" ? b.createdAt : b.updatedAt
      return bKey.localeCompare(aKey)
    })
    return copy
  }, [tasks, sortBy])

  const [addOpen, setAddOpen] = React.useState(false)
  const [addTitle, setAddTitle] = React.useState("")
  const [addDesc, setAddDesc] = React.useState("")
  const [addBusy, setAddBusy] = React.useState(false)
  const [addError, setAddError] = React.useState<string | null>(null)

  const submitAdd = React.useCallback(async () => {
    if (!laneId) return
    const title = addTitle.trim()
    if (!title) {
      setAddError("title required")
      return
    }
    setAddBusy(true)
    setAddError(null)
    try {
      const r = await fetch(
        `/api/operator-studio/work-lanes/${encodeURIComponent(laneId)}/add-task`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, description: addDesc.trim() || undefined }),
        }
      )
      const data = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`)
      setAddOpen(false)
      setAddTitle("")
      setAddDesc("")
      onChanged()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "add-task failed")
    } finally {
      setAddBusy(false)
    }
  }, [laneId, addTitle, addDesc, onChanged])

  const [railHeight, setRailHeight] = useRailHeight()
  const dragStateRef = React.useRef<{
    startClientY: number
    startHeight: number
    pointerId: number
  } | null>(null)
  const lastTapRef = React.useRef<number>(0)
  const onHeaderPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      dragStateRef.current = {
        startClientY: e.clientY,
        startHeight: railHeight,
        pointerId: e.pointerId,
      }
    },
    [railHeight]
  )
  const onHeaderPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      const delta = drag.startClientY - e.clientY
      setRailHeight(drag.startHeight + delta)
    },
    [setRailHeight]
  )
  const onHeaderPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
      dragStateRef.current = null
    },
    []
  )
  const onHeaderClick = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      setRailHeight(RAIL_DEFAULT_PX)
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
    }
  }, [setRailHeight])

  const canAdd = !!laneId && !!laneCardStepId

  return (
    <div
      className={
        embedded ? "flex flex-col flex-1 min-h-0" : "flex flex-col"
      }
      style={
        embedded
          ? { touchAction: "none" }
          : { height: railHeight, touchAction: "none" }
      }
      data-testid="cockpit-tasks-rail"
    >
      <div
        role={embedded ? undefined : "separator"}
        aria-orientation={embedded ? undefined : "horizontal"}
        aria-label={embedded ? undefined : "Drag to resize tasks rail"}
        onPointerDown={embedded ? undefined : onHeaderPointerDown}
        onPointerMove={embedded ? undefined : onHeaderPointerMove}
        onPointerUp={embedded ? undefined : onHeaderPointerUp}
        onPointerCancel={embedded ? undefined : onHeaderPointerUp}
        onClick={embedded ? undefined : onHeaderClick}
        onDoubleClick={
          embedded ? undefined : () => setRailHeight(RAIL_DEFAULT_PX)
        }
        className={`sticky top-0 z-10 px-3 py-1 border-b border-stone-200 dark:border-stone-800 bg-stone-100/95 dark:bg-stone-900/95 backdrop-blur flex items-center gap-2 select-none ${
          embedded ? "" : "cursor-ns-resize"
        }`}
        data-tasks-rail-header
        title={embedded ? undefined : "Drag to resize. Double-tap to reset."}
      >
        <span className="text-[10px] uppercase tracking-wider text-stone-500 pointer-events-none">
          {embedded ? "Lane tasks" : "Tasks for this lane"}
        </span>
        {canAdd && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setAddOpen((v) => !v)
            }}
            className="inline-flex items-center justify-center h-5 w-5 rounded border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-800"
            aria-label={addOpen ? "Close new task form" : "Add task"}
            title="Add a new task to this lane"
            data-testid="cockpit-add-task-button"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        <span
          onPointerDown={(e) => e.stopPropagation()}
          className="ml-auto inline-flex rounded-md border border-stone-300 dark:border-stone-700 overflow-hidden text-[9.5px] uppercase tracking-wider"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSortBy("created")
            }}
            className={`px-2 py-0.5 ${
              sortBy === "created"
                ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-transparent text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
            }`}
            aria-pressed={sortBy === "created"}
            title="Sort by creation time (descending)"
          >
            Created
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSortBy("last-updated")
            }}
            className={`px-2 py-0.5 border-l border-stone-300 dark:border-stone-700 ${
              sortBy === "last-updated"
                ? "bg-stone-700 text-white dark:bg-stone-200 dark:text-stone-900"
                : "bg-transparent text-stone-500 hover:bg-stone-200 dark:hover:bg-stone-800"
            }`}
            aria-pressed={sortBy === "last-updated"}
            title="Sort by last activity (descending)"
          >
            Updated
          </button>
        </span>
      </div>
      {addOpen && canAdd && (
        <div
          className="px-3 py-2 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950 flex flex-col gap-2"
          data-testid="cockpit-add-task-form"
        >
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="Task title"
            className="w-full text-[12px] rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2 py-1"
            disabled={addBusy}
          />
          <textarea
            value={addDesc}
            onChange={(e) => setAddDesc(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            className="w-full text-[12px] rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 px-2 py-1 resize-y"
            disabled={addBusy}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitAdd}
              disabled={addBusy || addTitle.trim().length === 0}
              className="ml-auto rounded bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900 text-[11px] px-2 py-1 disabled:opacity-50"
            >
              {addBusy ? "Adding…" : "Add task"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddOpen(false)
                setAddError(null)
              }}
              disabled={addBusy}
              className="rounded border border-stone-300 dark:border-stone-700 text-[11px] px-2 py-1 text-stone-600 dark:text-stone-300"
            >
              Cancel
            </button>
          </div>
          {addError && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              {addError}
            </p>
          )}
        </div>
      )}
      {sortedTasks.length === 0 ? (
        <div
          className="px-3 py-4 text-[12px] text-stone-500 dark:text-stone-400 text-center"
          data-testid="cockpit-tasks-empty"
        >
          {canAdd
            ? "No tasks yet — tap + to add one."
            : "No tasks yet."}
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800 flex-1 min-h-0 overflow-y-auto">
          {sortedTasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              laneId={laneId}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TaskRow({
  task,
  laneId,
  onChanged,
}: {
  task: LaneTaskCard
  laneId: string | null
  onChanged: () => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const setStatus = React.useCallback(
    async (next: LaneTaskStatusClient) => {
      if (!laneId || busy) return
      setBusy(true)
      try {
        const r = await fetch(
          `/api/operator-studio/work-lanes/${encodeURIComponent(laneId)}/tasks`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ stepId: task.id, status: next }),
          }
        )
        if (r.ok) onChanged()
      } finally {
        setBusy(false)
      }
    },
    [laneId, busy, task.id, onChanged]
  )
  const nextStatuses: LaneTaskStatusClient[] = [
    "open",
    "in-motion",
    "covered",
  ]
  return (
    <li className="px-3 py-2" data-testid="cockpit-task-row">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${statusPillClass(task.status)}`}
          data-testid="cockpit-task-status-pill"
        >
          {task.status}
        </span>
        <span className="text-[12px] flex-1 truncate">{task.title}</span>
        {expanded ? (
          <ChevronUp className="h-3 w-3 text-stone-400" />
        ) : (
          <ChevronDown className="h-3 w-3 text-stone-400" />
        )}
      </button>
      {expanded && (
        <div className="mt-2 flex flex-col gap-2">
          {task.description && (
            <p className="text-[11px] text-stone-600 dark:text-stone-400 whitespace-pre-wrap">
              {task.description}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {nextStatuses.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                disabled={busy || s === task.status}
                className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  s === task.status
                    ? "border-stone-400 text-stone-500"
                    : "border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
                } disabled:opacity-50`}
                data-testid={`cockpit-task-status-${s}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  )
}

function AgentRow({
  agent,
  workerSequence,
  reviewStatus,
  onPick,
  onTapPill,
}: {
  agent: AgentListItem
  workerSequence?: number | null
  reviewStatus?: ReviewStatus | null
  onPick: (id: AgentCompositeId) => void
  onTapPill?: (id: AgentCompositeId) => void
}) {
  const tier: ReviewStatus = reviewStatus ?? "live"
  const isAwaitingBerthier =
    tier === "candidate-self-believed" || tier === "awaiting-berthier-check"
  const isBerthierReviewed = tier === "berthier-reviewed"
  const isHumanApproved = tier === "human-approved"
  const isIdle = tier === "idle"
  // Distinct visual treatment per multi-tier reviewStatus (0034):
  //   awaiting-berthier-check  → yellow band + pill (needs Berthier's eyes)
  //   berthier-reviewed        → amber band + pill (needs YOUR eyes)
  //   human-approved           → muted green check, dim
  //   live                     → existing pulsing dot
  //   idle                     → muted
  const rowBg = isAwaitingBerthier
    ? "bg-yellow-50 dark:bg-yellow-950/40 ring-1 ring-yellow-300 dark:ring-yellow-700"
    : isBerthierReviewed
    ? "bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-300 dark:ring-amber-700"
    : isHumanApproved
    ? "opacity-60"
    : ""
  const dotClass = isAwaitingBerthier
    ? "bg-yellow-500"
    : isBerthierReviewed
    ? "bg-amber-500"
    : isHumanApproved
    ? "bg-emerald-600"
    : isIdle
    ? "bg-stone-300 dark:bg-stone-600"
    : agent.isLive
    ? "bg-emerald-500 animate-pulse"
    : "bg-stone-400"
  const titleDim =
    isIdle || isHumanApproved
      ? "text-stone-500 dark:text-stone-500"
      : "text-stone-900 dark:text-stone-100"
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(agent.id)}
        className={`w-full text-left px-3 py-2.5 active:bg-stone-100 dark:active:bg-stone-800 ${rowBg}`}
      >
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`}
            aria-hidden
          />
          <span
            className="text-[10px] uppercase tracking-wider text-stone-500"
            title={agent.id}
          >
            {agent.source}
            {typeof workerSequence === "number"
              ? ` · Worker ${workerSequence}`
              : ""}
          </span>
          {isAwaitingBerthier && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-yellow-200 dark:bg-yellow-900/60 text-[9.5px] font-semibold uppercase tracking-wider text-yellow-900 dark:text-yellow-200">
              needs Berthier&apos;s eyes
            </span>
          )}
          {isBerthierReviewed && (
            <span
              role={onTapPill ? "button" : undefined}
              onClick={
                onTapPill
                  ? (e) => {
                      e.stopPropagation()
                      onTapPill(agent.id)
                    }
                  : undefined
              }
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-200 dark:bg-amber-900/60 text-[9.5px] font-semibold uppercase tracking-wider text-amber-900 dark:text-amber-200 ${onTapPill ? "cursor-pointer hover:bg-amber-300 dark:hover:bg-amber-800" : ""}`}
            >
              needs your eyes — Berthier looked
            </span>
          )}
          {isHumanApproved && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-[9.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              ✓ approved
            </span>
          )}
          <span className="ml-auto text-[10px] text-stone-500">
            {formatRelative(agent.lastActivityAt)}
          </span>
        </div>
        <div className={`mt-0.5 text-[12.5px] font-medium line-clamp-2 ${titleDim}`}>
          {agent.title ?? agent.label}
        </div>
        {agent.project && (
          <div className="mt-0.5 text-[10.5px] text-stone-500 truncate">
            {agent.project}
          </div>
        )}
      </button>
    </li>
  )
}

// ─── Draggable splitter (cockpit lane management MVP) ─────────────────────
//
// Vertical drag handle between exec (top) and worker (bottom). Persists
// the ratio to localStorage and resets to 50/50 on double-tap. Min/max
// 15%/85% per side.

const SPLIT_RATIO_KEY = "operator-studio:cockpit:split-ratio"
const SPLIT_MIN = 0.15
const SPLIT_MAX = 0.85
const SPLIT_DEFAULT = 0.5

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return SPLIT_DEFAULT
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r))
}

function useSplitRatio(): [number, (r: number) => void, () => void] {
  const [ratio, setRatioState] = React.useState<number>(SPLIT_DEFAULT)
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SPLIT_RATIO_KEY)
      if (raw) {
        const n = Number(raw)
        if (Number.isFinite(n)) setRatioState(clampRatio(n))
      }
    } catch {
      /* ignore */
    }
  }, [])
  const setRatio = React.useCallback((r: number) => {
    const next = clampRatio(r)
    setRatioState(next)
    try {
      window.localStorage.setItem(SPLIT_RATIO_KEY, String(next))
    } catch {
      /* ignore */
    }
  }, [])
  const reset = React.useCallback(() => setRatio(SPLIT_DEFAULT), [setRatio])
  return [ratio, setRatio, reset]
}

function DraggableSplit({
  top,
  bottom,
}: {
  top: React.ReactNode
  bottom: React.ReactNode
}) {
  const [ratio, setRatio, reset] = useSplitRatio()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const draggingRef = React.useRef(false)
  const lastTapRef = React.useRef<number>(0)

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    draggingRef.current = true
  }, [])

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.height <= 0) return
      const next = (e.clientY - rect.top) / rect.height
      setRatio(next)
    },
    [setRatio]
  )

  const onPointerUp = React.useCallback((e: React.PointerEvent) => {
    draggingRef.current = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }, [])

  const onClick = React.useCallback(() => {
    const now = Date.now()
    if (now - lastTapRef.current < 350) {
      reset()
      lastTapRef.current = 0
    } else {
      lastTapRef.current = now
    }
  }, [reset])

  const topGrow = ratio
  const bottomGrow = 1 - ratio

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 flex flex-col"
      style={{ touchAction: "none" }}
    >
      <section
        className="relative flex flex-col overflow-hidden min-h-0"
        style={{ flexGrow: topGrow, flexShrink: 1, flexBasis: 0 }}
      >
        {top}
      </section>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize split"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={reset}
        onClick={onClick}
        className="relative h-3 shrink-0 cursor-row-resize bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 active:bg-stone-300 dark:active:bg-stone-600 border-y border-stone-200 dark:border-stone-700 select-none"
        title="Drag to resize. Double-tap to reset."
      >
        <span
          aria-hidden
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-0.5 w-8 rounded-full bg-stone-400 dark:bg-stone-500"
        />
      </div>
      <section
        className="relative flex flex-col overflow-hidden min-h-0"
        style={{ flexGrow: bottomGrow, flexShrink: 1, flexBasis: 0 }}
      >
        {bottom}
      </section>
    </div>
  )
}

// ─── Lane dropdown (workspace + exec picker) ──────────────────────────────

interface ThreadCandidate {
  id: string
  label: string
  source: string
  title: string | null
  project: string | null
  isLive: boolean
  roleStatus: "exec" | "worker" | "available"
  lastActivityAt: string
}

function LaneDropdown({
  onSetExec,
}: {
  onSetExec: (agentId: AgentCompositeId) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [workspaces, setWorkspaces] = React.useState<
    Array<{ id: string; label: string; createdAt: string }>
  >([])
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<string>("global")
  const [threads, setThreads] = React.useState<ThreadCandidate[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const popoverRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!open) return
    let alive = true
    async function load() {
      try {
        const wsRes = await fetch("/api/workspaces", { cache: "no-store" })
        const wsData = (await wsRes.json().catch(() => ({}))) as {
          workspaces?: Array<{ id: string; label: string; createdAt: string }>
        }
        if (alive && Array.isArray(wsData.workspaces)) {
          setWorkspaces(wsData.workspaces)
        }

        const tRes = await fetch(
          `/api/operator-studio/cockpit/threads?workspaceId=${encodeURIComponent(
            activeWorkspaceId
          )}&appLimit=20`,
          { cache: "no-store" }
        )
        const tData = (await tRes.json().catch(() => ({}))) as {
          threads?: ThreadCandidate[]
        }
        if (alive && Array.isArray(tData.threads)) {
          setThreads(tData.threads)
        }
      } catch (e) {
        if (alive)
          setError(e instanceof Error ? e.message : "load failed")
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [open, activeWorkspaceId])

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!popoverRef.current) return
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDocClick)
    return () => window.removeEventListener("mousedown", onDocClick)
  }, [open])

  async function createWorkspace() {
    const label = window.prompt("New workspace name:")?.trim()
    if (!label) return
    const id = label
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
    if (!id) return
    setBusy(true)
    try {
      const r = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, label }),
      })
      const data = (await r.json().catch(() => ({}))) as {
        workspace?: { id: string; label: string; createdAt: string }
        error?: string
      }
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      if (data.workspace) {
        setWorkspaces((prev) => [...prev, data.workspace!])
        setActiveWorkspaceId(data.workspace.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed")
    } finally {
      setBusy(false)
    }
  }

  async function pickExec(t: ThreadCandidate) {
    if (t.roleStatus !== "available" && t.roleStatus !== "exec") return
    setBusy(true)
    try {
      const r = await fetch("/api/operator-studio/cockpit/exec", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          agentId: t.id,
          agentKind: t.source,
        }),
      })
      const data = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      onSetExec(t.id as AgentCompositeId)
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "set-exec failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 h-8 px-2 -ml-1 rounded text-[12px] font-semibold text-stone-800 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-800"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace or executive thread"
      >
        <span className="text-[10px] uppercase tracking-wider text-stone-500">
          Lane
        </span>
        <span className="ml-1">Cockpit</span>
        <ChevronDown className="h-3 w-3 ml-0.5 text-stone-400" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-40 w-80 max-h-[70vh] overflow-y-auto rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 shadow-lg"
        >
          {error && (
            <div className="m-2 p-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-[11px] text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-stone-500">
            Workspace
          </div>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setActiveWorkspaceId(w.id)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-stone-50 dark:hover:bg-stone-800 ${
                    w.id === activeWorkspaceId
                      ? "bg-stone-100 dark:bg-stone-800 font-semibold"
                      : ""
                  }`}
                >
                  {w.label}
                  <span className="ml-1 text-[10px] text-stone-400">
                    {w.id}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={createWorkspace}
            className="w-full text-left px-3 py-1.5 text-[12px] text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Create new workspace
          </button>

          <div className="border-t border-stone-200 dark:border-stone-800 mt-1" />

          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-stone-500">
            Executive thread
          </div>
          {threads.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-stone-500">
              No candidates yet.
            </div>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {threads.slice(0, 12).map((t) => {
                const disabled = t.roleStatus === "worker"
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => pickExec(t)}
                      title={
                        disabled
                          ? "currently a worker for an active plan card"
                          : t.roleStatus === "exec"
                            ? "already this lane's exec"
                            : "Set as exec"
                      }
                      className={`w-full text-left px-3 py-1.5 text-[12px] ${
                        disabled
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-stone-50 dark:hover:bg-stone-800"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            t.isLive ? "bg-emerald-500" : "bg-stone-400"
                          }`}
                          aria-hidden
                        />
                        <span className="text-[10px] uppercase tracking-wider text-stone-500">
                          {t.source}
                        </span>
                        {t.roleStatus !== "available" && (
                          <span
                            className={`text-[9px] uppercase tracking-wider rounded px-1 ${
                              t.roleStatus === "exec"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                            }`}
                          >
                            {t.roleStatus}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate">
                        {t.title ?? t.label}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ""
  const m = Math.round(ms / 60_000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// ─── useIsDesktop hook ────────────────────────────────────────────────────
// True when the viewport is at least the given breakpoint wide. Used by
// the desktop-resolution reveal layer (sibling card
// `step-cockpit-desktop-resolution-sidebar`) to show workers + tasks
// side-by-side instead of behind a tab switcher.
function useIsDesktop(breakpoint = 1024) {
  const [isDesktop, setIsDesktop] = React.useState(false)
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    setIsDesktop(mq.matches)
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [breakpoint])
  return isDesktop
}

// ─── ArtifactsList (renamed from ActivityList 2026-05-12) ─────────────────
// Vertical chronological log of the lane's artifacts — every card pulled
// in, every status flip, every field note, every worker session. Lives
// as the "Artifacts" tab in the rail switcher (David 2026-05-12: "It's
// going to be kind of your little sort of timeline of artifacts as
// they're created").
//
// Doctrine: `memory/feedback_cockpit_is_execution_layer.md`. Schema
// evolution to support arbitrary artifact_kinds tracked in plan card
// `step-lane-artifacts-arbitrary-types`.
//
// Visual design notes:
// - **Timestamps don't compress dangerously.** "1 day ago" loses
//   resolution — you can't tell if two same-day events were 3 min apart
//   or 3 hr apart. Recent events show relative ("3m ago"); older
//   events switch to absolute ("May 12 · 2:14p") so the eye can read
//   the actual time-of-day.
// - **Jagged-tear gap indicator.** Between consecutive events whose
//   delta exceeds GAP_THRESHOLD_MS, render a thin torn-paper divider
//   row with the gap duration. Conveys "time passed here" without
//   compressing the events themselves.
interface TimelineEvent {
  id: string
  laneId: string
  planStepId: string
  eventKind: string
  at: string
  actorAgentId: string | null
  note: string | null
  cardTitle: string | null
  cardStatus: string | null
  /** Present only on synthetic `chat-burst` rows — counts of turns that
   *  happened in the window between adjacent real artifact events. */
  chatBurst?: {
    fromAt: string
    toAt: string
    turnCount: number
    userCount: number
    assistantCount: number
    toolUseCount: number
    thinkingCount: number
  }
}

const TIMELINE_GLYPH: Record<string, string> = {
  pulled_in: "↘",
  created_in_lane: "✦",
  started: "▶",
  marked_in_motion: "◆",
  covered: "✓",
  skipped: "—",
  removed_from_lane: "✗",
  note: "·",
}

function timelineDayBucket(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return "Today"
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const sameYest =
    d.getFullYear() === yest.getFullYear() &&
    d.getMonth() === yest.getMonth() &&
    d.getDate() === yest.getDate()
  if (sameYest) return "Yesterday"
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (diffDays < 7) return "This week"
  if (diffDays < 14) return "Last week"
  return "Older"
}

// Gap threshold: when consecutive events are more than this far apart
// in time, draw a jagged-tear divider between them with the duration
// of the gap. 20 minutes is the threshold David's eye starts to feel
// "wait, what happened in between."
const GAP_THRESHOLD_MS = 20 * 60_000

// Family-grouping window: consecutive same-kind events within the same
// day-bucket and within this window collapse into one expressive row.
// 5 min matches the rhythm of a single agentic burst — long enough to
// catch a worker landing 6 cards in a row, short enough that genuinely
// separate beats stay separate.
const FAMILY_WINDOW_MS = 5 * 60_000

// LocalStorage prefix for per-group expand state. Group id is derived
// deterministically from lane_id + first member's event id so the open
// state survives a refresh without depending on the volatile members.
const ARTIFACT_GROUP_LS_PREFIX = "cockpit:artifact-group:"

function formatGapDuration(ms: number): string {
  if (ms < 60_000) return ""
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min later`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} hr later`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? "" : "s"} later`
}

// Granular timestamp that preserves resolution at older ages instead
// of collapsing to "1d ago". Returns relative for things in the last
// 6 hours; switches to weekday + time for the past week; absolute date
// + time beyond that. Mirrors the "don't compress useful signal" rule
// David called out.
function formatArtifactTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ""
  const now = Date.now()
  const ms = now - d.getTime()
  if (ms < 0) return "just now"
  if (ms < 60_000) return "just now"
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 6 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`
  // Past 6 hours — show wall-clock time so 3-min-apart and 3-hr-apart
  // stop looking the same. Within 7 days, prepend weekday.
  const time = d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(/\s?(AM|PM)/i, (_m, ap: string) => ap.toLowerCase().slice(0, 1))
  const within7Days = ms < 7 * 24 * 60 * 60_000
  if (within7Days) {
    const weekday = d.toLocaleDateString(undefined, { weekday: "short" })
    return `${weekday} ${time}`
  }
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  return `${date} · ${time}`
}

function ArtifactsList({
  laneId,
  onJumpToStep,
}: {
  laneId: string | null
  onJumpToStep?: (stepId: string) => void
}) {
  const [events, setEvents] = React.useState<TimelineEvent[]>([])
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!laneId) {
      setEvents([])
      return
    }
    let alive = true
    async function poll() {
      try {
        const r = await fetch(
          `/api/operator-studio/work-lanes/${encodeURIComponent(laneId!)}/events`,
          { cache: "no-store" }
        )
        if (!r.ok) return
        const data = (await r.json()) as { events?: TimelineEvent[] }
        if (alive) setEvents(Array.isArray(data.events) ? data.events : [])
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "events fetch failed")
      }
    }
    poll()
    const id = window.setInterval(poll, 6_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [laneId])

  // Render-ready item list with bucket headers, jagged-tear gaps,
  // singleton events, and family groups. Logic lives in
  // `lib/operator-studio/cockpit-artifact-grouping.ts` so the
  // acceptance script can drive it without React.
  const items = buildArtifactItems(events, {
    familyWindowMs: FAMILY_WINDOW_MS,
    gapThresholdMs: GAP_THRESHOLD_MS,
    bucketOf: timelineDayBucket,
  })

  if (!laneId) return null
  return (
    <div
      className="flex flex-col flex-1 min-h-0 bg-white dark:bg-stone-900"
      data-testid="cockpit-artifacts-list"
    >
      {err && (
        <div className="px-3 py-1 text-[11px] text-red-500 border-b border-stone-200 dark:border-stone-800">
          {err}
        </div>
      )}
      <div className="overflow-y-auto flex-1">
        {events.length === 0 ? (
          <div className="text-[11px] text-stone-400 dark:text-stone-500 p-3">
            Nothing here yet — pull a card in or create one and the
            artifact will appear.
          </div>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {items.map((it, i) =>
              it.kind === "bucket" ? (
                <li
                  key={`bucket-${i}`}
                  className="px-3 py-1 bg-stone-50 dark:bg-stone-950/60 text-[9px] uppercase tracking-wider text-stone-500 dark:text-stone-400 sticky top-0 z-10"
                >
                  {it.label}
                </li>
              ) : it.kind === "gap" ? (
                <li
                  key={`gap-${i}`}
                  className="relative bg-stone-50/40 dark:bg-stone-950/30 py-1"
                  aria-hidden
                  data-testid="cockpit-artifacts-gap"
                >
                  <span
                    className="absolute left-0 right-0 top-0 h-1.5"
                    style={{
                      background:
                        "linear-gradient(45deg, transparent 33%, currentColor 33%, currentColor 50%, transparent 50%, transparent 83%, currentColor 83%, currentColor 100%)",
                      backgroundSize: "8px 100%",
                      color: "rgb(168 162 158 / 0.5)",
                    }}
                  />
                  <div className="text-center text-[9px] uppercase tracking-wider text-stone-400 dark:text-stone-500 pt-1">
                    {formatGapDuration(it.ms)}
                  </div>
                </li>
              ) : it.kind === "group" ? (
                <ArtifactGroupRow
                  key={it.groupId}
                  groupId={it.groupId}
                  events={it.events}
                  onJumpToStep={onJumpToStep}
                />
              ) : it.event.eventKind === "chat-burst" && it.event.chatBurst ? (
                <ChatBurstRow key={it.event.id} event={it.event} />
              ) : (
                <SingleArtifactRow
                  key={it.event.id}
                  event={it.event}
                  onJumpToStep={onJumpToStep}
                />
              )
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

// Tailwind colorway per event_kind. Extracted from the original inline
// ternary so SingleArtifactRow and the group expanded rows share one
// vocabulary — same kind, same chip color, every surface.
function glyphChipClass(eventKind: string): string {
  switch (eventKind) {
    case "covered":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
    case "skipped":
      return "bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400"
    case "marked_in_motion":
    case "started":
      return "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
    case "removed_from_lane":
      return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
    default:
      return "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
  }
}

function SingleArtifactRow({
  event,
  onJumpToStep,
}: {
  event: TimelineEvent
  onJumpToStep?: (stepId: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onJumpToStep?.(event.planStepId)}
        className="w-full text-left px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/40 focus:bg-stone-100 dark:focus:bg-stone-800/60"
        title={`${event.eventKind} · ${formatArtifactTime(event.at)}${
          event.note ? `\n\n${event.note}` : ""
        }`}
        data-jump-to-step={event.planStepId}
      >
        <div className="flex items-start gap-2">
          <span
            className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-mono ${glyphChipClass(event.eventKind)}`}
            aria-hidden
          >
            {TIMELINE_GLYPH[event.eventKind] ?? "·"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 truncate">
                {event.eventKind}
              </span>
              <span
                className="text-[9px] text-stone-400 dark:text-stone-500 shrink-0 tabular-nums"
                title={new Date(event.at).toLocaleString()}
              >
                {formatArtifactTime(event.at)}
              </span>
            </div>
            <div className="text-[12px] text-stone-800 dark:text-stone-200 truncate">
              {event.cardTitle ?? event.planStepId}
            </div>
            {event.note && (
              <div className="text-[10px] text-stone-500 dark:text-stone-400 truncate italic">
                {event.note}
              </div>
            )}
          </div>
        </div>
      </button>
    </li>
  )
}

/**
 * Synthetic chat-burst row — collapses every user/assistant/tool turn
 * that happened in the gap between two adjacent real artifact events
 * into one expandable pill. Tap to reveal the per-role breakdown and
 * the burst's wall-clock span. Doctrine: David 2026-05-12 — "reflect
 * chat turns themselves in the artifact log, batched and grouped under
 * one element type to show the count of stuff that happened in between
 * the creation of artifacts."
 */
function ChatBurstRow({ event }: { event: TimelineEvent }) {
  const b = event.chatBurst
  const [expanded, setExpanded] = React.useState(false)
  if (!b) return null
  const spanMs =
    new Date(b.toAt).getTime() - new Date(b.fromAt).getTime()
  const spanLabel =
    spanMs < 60_000
      ? `${Math.max(1, Math.round(spanMs / 1000))}s span`
      : spanMs < 60 * 60_000
        ? `${Math.round(spanMs / 60_000)}m span`
        : `${Math.round(spanMs / (60 * 60_000))}h span`
  return (
    <li data-testid="cockpit-artifact-chat-burst">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/40 focus:bg-stone-100 dark:focus:bg-stone-800/60"
        aria-expanded={expanded}
        data-testid="cockpit-artifact-chat-burst-toggle"
      >
        <div className="flex items-start gap-2">
          <span
            className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-mono bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
            aria-hidden
          >
            ↻
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 truncate flex items-center gap-1.5">
                <span>chat</span>
                <span
                  className="text-[10px] font-mono tracking-normal text-stone-400 dark:text-stone-500"
                  data-testid="cockpit-artifact-chat-burst-count"
                >
                  × {b.turnCount} turn{b.turnCount === 1 ? "" : "s"}
                </span>
              </span>
              <span
                className="text-[9px] text-stone-400 dark:text-stone-500 shrink-0 tabular-nums flex items-center gap-1"
                title={`${new Date(b.fromAt).toLocaleString()} → ${new Date(b.toAt).toLocaleString()}`}
              >
                <span>{formatArtifactTime(b.toAt)}</span>
                <ChevronRight
                  className={`h-3 w-3 transition-transform duration-150 ${
                    expanded ? "rotate-90" : ""
                  }`}
                  aria-hidden
                />
              </span>
            </div>
            <div className="text-[11px] text-stone-600 dark:text-stone-300 truncate">
              {b.userCount} you · {b.assistantCount} agent
              {b.toolUseCount > 0 ? ` · ${b.toolUseCount} tool` : ""} ·{" "}
              {spanLabel}
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <div
          className="pl-10 pr-3 py-2 bg-stone-50/60 dark:bg-stone-950/40 text-[11px] text-stone-600 dark:text-stone-300"
          data-testid="cockpit-artifact-chat-burst-expanded"
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>You</span>
            <span className="tabular-nums text-right">{b.userCount}</span>
            <span>Agent</span>
            <span className="tabular-nums text-right">
              {b.assistantCount}
            </span>
            <span>Tool calls</span>
            <span className="tabular-nums text-right">{b.toolUseCount}</span>
            <span>Thinking</span>
            <span className="tabular-nums text-right">
              {b.thinkingCount}
            </span>
          </div>
          <div className="mt-1.5 text-[10px] text-stone-400 dark:text-stone-500">
            {new Date(b.fromAt).toLocaleString()} →{" "}
            {new Date(b.toAt).toLocaleString()}
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Family group row — ≥2 consecutive same-kind events within the same
 * day-bucket and within FAMILY_WINDOW_MS. Collapsed: glyph + kind +
 * "× N" + most-recent member's title as the preview line + caret.
 * Tap expands inline into individual `SingleArtifactRow` rows so every
 * event remains tappable and the audit trail stays intact. Expand
 * state persists per group in localStorage.
 */
function ArtifactGroupRow({
  groupId,
  events,
  onJumpToStep,
}: {
  groupId: string
  events: TimelineEvent[]
  onJumpToStep?: (stepId: string) => void
}) {
  const lsKey = ARTIFACT_GROUP_LS_PREFIX + groupId
  const [expanded, setExpanded] = React.useState<boolean>(false)
  React.useEffect(() => {
    if (typeof window === "undefined") return
    try {
      if (window.localStorage.getItem(lsKey) === "1") setExpanded(true)
    } catch {
      /* ignore */
    }
  }, [lsKey])
  const toggle = React.useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      try {
        if (typeof window !== "undefined") {
          if (next) window.localStorage.setItem(lsKey, "1")
          else window.localStorage.removeItem(lsKey)
        }
      } catch {
        /* ignore */
      }
      return next
    })
  }, [lsKey])
  // events list is most-recent-first, so events[0] is the most recent
  // and its cardTitle is the natural preview ("what just happened in
  // this burst"). Time-range label spans newest → oldest.
  const head = events[0]
  const tail = events[events.length - 1]
  const kind = head.eventKind
  const count = events.length
  return (
    <li data-testid="cockpit-artifact-group">
      <button
        type="button"
        onClick={toggle}
        className="w-full text-left px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/40 focus:bg-stone-100 dark:focus:bg-stone-800/60"
        aria-expanded={expanded}
        data-testid="cockpit-artifact-group-toggle"
        data-group-id={groupId}
      >
        <div className="flex items-start gap-2">
          <span
            className={`shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-mono ${glyphChipClass(kind)}`}
            aria-hidden
          >
            {TIMELINE_GLYPH[kind] ?? "·"}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 dark:text-stone-400 truncate flex items-center gap-1.5">
                <span>{kind}</span>
                <span
                  className="text-[10px] font-mono tracking-normal text-stone-400 dark:text-stone-500"
                  data-testid="cockpit-artifact-group-count"
                >
                  × {count}
                </span>
              </span>
              <span
                className="text-[9px] text-stone-400 dark:text-stone-500 shrink-0 tabular-nums flex items-center gap-1"
                title={`${new Date(tail.at).toLocaleString()} → ${new Date(head.at).toLocaleString()}`}
              >
                <span>{formatArtifactTime(head.at)}</span>
                <ChevronRight
                  className={`h-3 w-3 transition-transform duration-150 ${
                    expanded ? "rotate-90" : ""
                  }`}
                  aria-hidden
                  data-testid="cockpit-artifact-group-caret"
                />
              </span>
            </div>
            <div className="text-[12px] text-stone-800 dark:text-stone-200 truncate">
              {head.cardTitle ?? head.planStepId}
            </div>
          </div>
        </div>
      </button>
      {expanded && (
        <ul
          className="pl-4 border-l-2 border-stone-200/60 dark:border-stone-800/60 ml-3 divide-y divide-stone-100 dark:divide-stone-800"
          data-testid="cockpit-artifact-group-expanded"
        >
          {events.map((e) => (
            <SingleArtifactRow
              key={e.id}
              event={e}
              onJumpToStep={onJumpToStep}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
