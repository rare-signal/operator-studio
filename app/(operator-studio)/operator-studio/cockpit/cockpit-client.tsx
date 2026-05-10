"use client"

import * as React from "react"
import { ArrowLeft, ChevronDown, ChevronUp, X } from "lucide-react"

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
} from "@/lib/server/agent-bridge/types"

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

interface CockpitClientProps {
  initialExecAgentId: string | null
}

export default function CockpitClient({ initialExecAgentId }: CockpitClientProps) {
  const [agents, setAgents] = React.useState<AgentListItem[]>([])
  const [agentsError, setAgentsError] = React.useState<string | null>(null)
  const [execId, setExecId] = React.useState<AgentCompositeId | null>(
    (initialExecAgentId as AgentCompositeId | null) ?? null
  )
  const [workerId, setWorkerId] = React.useState<AgentCompositeId | null>(null)
  const [execCollapsed, setExecCollapsed] = React.useState(false)
  // Maximize-pane state for the 50/50 split. Holds the agent id of the
  // pane the user wants to view full-viewport. null = normal split. Cleared
  // automatically when the underlying agent goes away (worker dismissed,
  // exec swapped) so we never get stuck rendering nothing.
  const [maximizedAgentId, setMaximizedAgentId] =
    React.useState<AgentCompositeId | null>(null)
  const [hotMode, setHotMode] = React.useState<HotModeStatus | null>(null)

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

  // Recent-agents polling (same endpoint + shape as BentoView).
  React.useEffect(() => {
    let alive = true
    async function poll() {
      try {
        const r = await fetch("/api/operator-studio/agents", {
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
  const [spawnedAgentIds, setSpawnedAgentIds] = React.useState<Set<string>>(
    new Set()
  )
  const [workerSequenceByAgentId, setWorkerSequenceByAgentId] = React.useState<
    Map<string, number>
  >(new Map())
  React.useEffect(() => {
    if (!execId) {
      setSpawnedAgentIds(new Set())
      setWorkerSequenceByAgentId(new Map())
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
          workers?: Array<{ agentId: string; sequence: number }>
        }
        const ids = Array.isArray(data?.agentIds) ? data.agentIds : []
        const seqMap = new Map<string, number>()
        if (Array.isArray(data?.workers)) {
          for (const w of data.workers) {
            if (typeof w?.agentId === "string" && typeof w?.sequence === "number") {
              seqMap.set(w.agentId, w.sequence)
            }
          }
        }
        if (alive) {
          setSpawnedAgentIds(new Set(ids))
          setWorkerSequenceByAgentId(seqMap)
        }
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
  const spawnedWorkers = React.useMemo(
    () =>
      execId
        ? agents.filter((a) => a.id !== execId && spawnedAgentIds.has(a.id))
        : [],
    [agents, execId, spawnedAgentIds]
  )
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

  function pickExec(id: AgentCompositeId) {
    setExecId(id)
    setWorkerId(null)
    setExecCollapsed(false)
    const url = new URL(window.location.href)
    url.searchParams.set("exec", id)
    window.history.replaceState({}, "", url.toString())
  }

  function clearExec() {
    setExecId(null)
    setWorkerId(null)
    setExecCollapsed(false)
    const url = new URL(window.location.href)
    url.searchParams.delete("exec")
    window.history.replaceState({}, "", url.toString())
  }

  // ── Render shell — same chassis as Bento focused-mobile ──
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
        workerActive={!!worker}
        execCollapsed={execCollapsed}
        onUnpinExec={clearExec}
        onBackToWorkers={() => setWorkerId(null)}
        onToggleExecCollapsed={() => setExecCollapsed((v) => !v)}
        hotMode={hotMode}
        onArm={arm}
        onDisarm={disarm}
        onExtend={extend}
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
            <>
              <Pane className="h-1/2 border-b border-stone-200 dark:border-stone-800">
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
              </Pane>
              <Pane className="h-1/2">
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
              </Pane>
            </>
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
                onPick={(id) => setWorkerId(id)}
              />
            </Pane>
          </>
        )}
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
  workerActive,
  execCollapsed,
  onUnpinExec,
  onBackToWorkers,
  onToggleExecCollapsed,
  hotMode,
  onArm,
  onDisarm,
  onExtend,
}: {
  exec: AgentListItem | null
  workerActive: boolean
  execCollapsed: boolean
  onUnpinExec: () => void
  onBackToWorkers: () => void
  onToggleExecCollapsed: () => void
  hotMode: HotModeStatus | null
  onArm: (pin: string, durationMs?: number) => Promise<void>
  onDisarm: () => Promise<void> | void
  onExtend: (extraMs: number) => Promise<void>
}) {
  return (
    // Mirror the Bento focused-mobile rail exactly: `sticky top-0 z-30`.
    // The z-30 is load-bearing — it puts the rail (and its
    // HotModeSwitch popover descendant) into a higher stacking layer
    // than the relative `Pane` sibling below. Without it the Pane
    // paints over the popover via DOM order. Don't remove again.
    <div className="sticky top-0 z-30 shrink-0 flex items-center gap-2 px-3 h-11 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
      {workerActive ? (
        <>
          <button
            type="button"
            onClick={onBackToWorkers}
            className="inline-flex items-center gap-1 h-8 px-2 -ml-1 rounded text-[12px] font-medium text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Workers
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
        <>
          <span className="text-[10px] uppercase tracking-wider text-stone-500">
            Lane
          </span>
          <span className="text-[12px] font-medium text-stone-800 dark:text-stone-200 truncate">
            Cockpit
          </span>
        </>
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
  onPick,
}: {
  workers: AgentListItem[]
  workerSequenceByAgentId: Map<string, number>
  onPick: (id: AgentCompositeId) => void
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 px-3 py-1 border-b border-stone-200 dark:border-stone-800 bg-stone-100/95 dark:bg-stone-900/95 backdrop-blur text-[10px] uppercase tracking-wider text-stone-500">
        Workers spawned by exec
      </div>
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {workers.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            workerSequence={workerSequenceByAgentId.get(a.id) ?? null}
            onPick={onPick}
          />
        ))}
      </ul>
    </div>
  )
}

function AgentRow({
  agent,
  workerSequence,
  onPick,
}: {
  agent: AgentListItem
  workerSequence?: number | null
  onPick: (id: AgentCompositeId) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(agent.id)}
        className="w-full text-left px-3 py-2.5 active:bg-stone-100 dark:active:bg-stone-800"
      >
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              agent.isLive ? "bg-emerald-500 animate-pulse" : "bg-stone-400"
            }`}
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
          <span className="ml-auto text-[10px] text-stone-500">
            {formatRelative(agent.lastActivityAt)}
          </span>
        </div>
        <div className="mt-0.5 text-[12.5px] font-medium text-stone-900 dark:text-stone-100 line-clamp-2">
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
