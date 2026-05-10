"use client"

import * as React from "react"
import { ArrowLeft, ChevronDown, ChevronUp, Home, Plus, X } from "lucide-react"

import {
  BentoPane,
  HotModeSwitch,
  type HotModeStatus,
} from "@/app/2/v2/components/bento-view"
import { SoundToggle } from "../components/sound-toggle"
import { useSound } from "../components/sound-context"
import type {
  AgentListItem,
  AgentCompositeId,
  AgentKind,
} from "@/lib/server/agent-bridge/types"
import type { AppStatus } from "@/lib/server/agent-bridge/app-sessions"

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
  getStoredActiveLaneId,
  setStoredActiveLaneId,
} from "./lane-picker"

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

  // First-load: fetch lanes; if localStorage hint matches a live lane,
  // open it. Otherwise stay in the picker view. (No auto-route into the
  // first lane — that's the bug we're fixing.)
  const didInitRef = React.useRef(false)
  React.useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    ;(async () => {
      const list = await refreshLanes()
      const hint = getStoredActiveLaneId(workspaceId)
      if (hint && Array.isArray(list) && list.some((l) => l.id === hint)) {
        setActiveLaneId(hint)
      }
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
    },
    [workspaceId]
  )
  const backToLanes = React.useCallback(() => {
    setActiveLaneId(null)
    setStoredActiveLaneId(workspaceId, null)
  }, [workspaceId])

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

  const exec = React.useMemo(
    () => agents.find((a) => a.id === execId) ?? null,
    [agents, execId]
  )
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
      return {
        id: w.agentId as AgentCompositeId,
        kind,
        label: w.label ?? w.agentId.split(":").slice(1).join(":").slice(0, 8),
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
          // STATE A — no exec: full-screen pick list.
          <PickList
            title="Pick an executive"
            subtitle="Promote any recent chat to drive this lane. Once picked it gets the full viewport until you spawn a worker from inside it."
            agents={agents}
            error={agentsError}
            onPick={pickExec}
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
        ) : spawnedWorkers.length === 0 ? (
          // STATE B — exec set, no spawned workers: exec fills screen.
          // (Workers slot stays hidden until the spawn-linkage lift
          //  lands and `spawnedWorkers` becomes authoritative.)
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
            />
          </Pane>
        ) : (
          // STATE C — exec set, N workers, none picked: exec on top
          // (filling whatever the workers list doesn't take), workers
          // list on bottom auto-sized but capped at 50% via max-h.
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
              />
            </Pane>
            <Pane className="shrink-0 max-h-1/2 overflow-y-auto">
              <WorkersList
                workers={spawnedWorkers}
                workerSequenceByAgentId={workerSequenceByAgentId}
                reviewStatusByAgentId={reviewStatusByAgentId}
                onPick={(id) => setWorkerId(id)}
                onTapBerthierReviewedPill={(id) => setAckModalAgentId(id)}
              />
            </Pane>
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

function PickList({
  title,
  subtitle,
  agents,
  error,
  onPick,
}: {
  title: string
  subtitle: string
  agents: AgentListItem[]
  error: string | null
  onPick: (id: AgentCompositeId) => void
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

function WorkersList({
  workers,
  workerSequenceByAgentId,
  reviewStatusByAgentId,
  onPick,
  onTapBerthierReviewedPill,
}: {
  workers: AgentListItem[]
  workerSequenceByAgentId: Map<string, number>
  reviewStatusByAgentId?: Map<string, ReviewStatus>
  onPick: (id: AgentCompositeId) => void
  onTapBerthierReviewedPill?: (id: AgentCompositeId) => void
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 px-3 py-1 border-b border-stone-200 dark:border-stone-800 bg-stone-100/95 dark:bg-stone-900/95 backdrop-blur text-[10px] uppercase tracking-wider text-stone-500">
        Workers spawned by exec
      </div>
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {workers.map((a) => {
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
    </div>
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
