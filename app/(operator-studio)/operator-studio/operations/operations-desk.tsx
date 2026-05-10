"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Compass,
  Edit3,
  ExternalLink,
  FileWarning,
  Gamepad2,
  Layers,
  MessagesSquare,
  Moon,
  Pencil,
  Play,
  RotateCw,
  Send,
  Sparkles,
  Target,
  Workflow,
  Zap,
} from "lucide-react"

import type { ActivePlan } from "@/app/v3/data/mock"
import type {
  ControlLoopStatus,
  LaneIcon,
  OperationsCard,
  OperationsControlLoopView,
  OperationsEvidence,
  OperationsLane,
  OperationsRecommendation,
  OperationsWorker,
} from "@/lib/operator-studio/operations"
import type {
  LaunchWaveLedger,
  LaunchWaveRecord,
} from "@/lib/operator-studio/launch-waves"

/**
 * Operations — executive control loop.
 *
 * NOT a chat-pane grid (Bento already does that). NOT a plan editor
 * (Plan does that). This is the typed surface that answers:
 *
 *   - what is happening right now?
 *   - what needs David?
 *   - what is fallow / blocked?
 *   - what should launch / tap / close next?
 *
 * Every value on this page comes from `/api/operator-studio/operations`,
 * which calls shared server derivation. `pnpm os:operations` must
 * mirror this same contract, not invent a sibling report. The screen
 * itself is still provisional; lockstep means shared truth while the
 * command surface evolves, not that today's layout is final.
 */

const POLL_MS = 6_000
const PLAN_LINK_KEY = "operatorStudio.bento.planLinks.v1"
const OPERATION_GOAL_KEY = "operatorStudio.operations.goal.v1"

interface KbEntryLite {
  id: string
  title: string
  summary: string
  tags: string[]
}

export interface OperationsDeskProps {
  activePlan: ActivePlan | null
  initialKb?: KbEntryLite[]
}

export function OperationsDesk({
  activePlan,
  initialKb = [],
}: OperationsDeskProps) {
  const [view, setView] = React.useState<OperationsControlLoopView | null>(null)
  const [launchWaveLedger, setLaunchWaveLedger] =
    React.useState<LaunchWaveLedger | null>(null)
  const [pollAt, setPollAt] = React.useState<string | null>(null)
  const [pollError, setPollError] = React.useState<string | null>(null)
  const [manualLinks, setManualLinks] = React.useState<Record<string, string>>(
    {}
  )

  // Verbalized operation-plan goal — localStorage today; durable
  // schema is the next step.
  const [goal, setGoalState] = React.useState<string>("")
  const [goalEditing, setGoalEditing] = React.useState(false)
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(OPERATION_GOAL_KEY)
      if (raw) setGoalState(raw)
    } catch {
      /* ignore */
    }
  }, [])
  const setGoal = React.useCallback((next: string) => {
    setGoalState(next)
    try {
      window.localStorage.setItem(OPERATION_GOAL_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  // Bento manual binding map (localStorage). Forwarded to the API so
  // server-side derivation can include it in precedence.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PLAN_LINK_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed && typeof parsed === "object") setManualLinks(parsed)
      }
    } catch {
      /* ignore */
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== PLAN_LINK_KEY) return
      try {
        const parsed = e.newValue
          ? (JSON.parse(e.newValue) as Record<string, string>)
          : {}
        setManualLinks(parsed)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  // Poll the unified Operations endpoint.
  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function tick() {
      try {
        const params = new URLSearchParams()
        if (Object.keys(manualLinks).length > 0) {
          params.set("manualLinks", JSON.stringify(manualLinks))
        }
        if (activePlan?.id) params.set("planId", activePlan.id)
        const res = await fetch(
          `/api/operator-studio/operations${params.toString() ? `?${params}` : ""}`,
          { cache: "no-store" }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as {
          view: OperationsControlLoopView
          launchWaveLedger?: LaunchWaveLedger
        }
        if (cancelled) return
        setView(data.view)
        setLaunchWaveLedger(data.launchWaveLedger ?? null)
        setPollAt(new Date().toISOString())
        setPollError(null)
      } catch (e) {
        if (cancelled) return
        setPollError(e instanceof Error ? e.message : "fetch failed")
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [manualLinks, activePlan?.id])

  // Per-lane KB matching, client-side. (KB tags rarely change; the
  // server derive function intentionally leaves this to the renderer.)
  const kbByLane = React.useMemo(() => {
    if (!view) return new Map<string, KbEntryLite[]>()
    const out = new Map<string, KbEntryLite[]>()
    for (const lane of view.lanes) {
      const tagSet = new Set(lane.kbTags)
      const matches = initialKb.filter((entry) =>
        (entry.tags ?? []).some((t) => tagSet.has(t))
      )
      out.set(lane.key, matches.slice(0, 4))
    }
    return out
  }, [view, initialKb])

  const planTitle = view?.planTitle ?? activePlan?.title ?? null
  const planId = view?.planId ?? activePlan?.id ?? null
  const totals = view?.totals
  const liveCount = totals?.actioning ?? 0
  const onDeskCount = view
    ? view.lanes.reduce((n, l) => n + l.cards.length, 0)
    : 0

  return (
    <div className="flex flex-col">
      <Header
        planTitle={planTitle}
        planId={planId}
        pollAt={pollAt}
        pollError={pollError}
        liveCount={liveCount}
        totalCards={onDeskCount}
        needsAttention={view?.needsAttentionCount ?? 0}
        goal={goal}
        goalEditing={goalEditing}
        onGoalEdit={() => setGoalEditing(true)}
        onGoalSave={(v) => {
          setGoal(v)
          setGoalEditing(false)
        }}
        onGoalCancel={() => setGoalEditing(false)}
      />

      <div className="px-3 sm:px-4 lg:px-6 pb-12 flex flex-col gap-4">
        {view && view.nextActions.length > 0 && (
          <NextActions actions={view.nextActions} planId={planId} />
        )}

        {view ? (
          view.lanes.map((lane) => (
            <Lane
              key={lane.key}
              lane={lane}
              kb={kbByLane.get(lane.key) ?? []}
              planId={planId}
            />
          ))
        ) : (
          <LoadingShell error={pollError} />
        )}

        {view && view.unboundWorkers.length > 0 && (
          <UnboundLane workers={view.unboundWorkers} />
        )}

        {launchWaveLedger && <LaunchWaveSection ledger={launchWaveLedger} />}

        {view && view.floatingRecommendations.length > 0 && (
          <FloatingRecs recs={view.floatingRecommendations} />
        )}

        {view && <Provenance notes={view.notes} />}
      </div>
    </div>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({
  planTitle,
  planId,
  pollAt,
  pollError,
  liveCount,
  totalCards,
  needsAttention,
  goal,
  goalEditing,
  onGoalEdit,
  onGoalSave,
  onGoalCancel,
}: {
  planTitle: string | null
  planId: string | null
  pollAt: string | null
  pollError: string | null
  liveCount: number
  totalCards: number
  needsAttention: number
  goal: string
  goalEditing: boolean
  onGoalEdit: () => void
  onGoalSave: (next: string) => void
  onGoalCancel: () => void
}) {
  const [draft, setDraft] = React.useState(goal)
  React.useEffect(() => {
    if (goalEditing) setDraft(goal)
  }, [goalEditing, goal])

  return (
    <header className="px-4 lg:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-stone-200 dark:border-stone-800">
      <div className="flex flex-col gap-3">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-stone-500 dark:text-stone-400">
              <Target className="h-3 w-3" />
              Control loop
              <span className="text-stone-300 dark:text-stone-700">·</span>
              <Link
                href={
                  planId
                    ? `/operator-studio/plan?planId=${planId}`
                    : "/operator-studio/plan"
                }
                className="underline decoration-dotted hover:decoration-solid"
              >
                {planTitle ?? "no active plan"}
              </Link>
            </div>
            <h1 className="mt-1 text-xl sm:text-2xl font-semibold tracking-tight">
              Operations
            </h1>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-stone-500 dark:text-stone-400 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  liveCount > 0
                    ? "bg-emerald-500 animate-pulse"
                    : "bg-stone-300 dark:bg-stone-700"
                }`}
              />
              <span className="tabular-nums">{liveCount}</span> live
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="tabular-nums">{totalCards}</span> on desk
            </span>
            {needsAttention > 0 && (
              <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-300">
                <AlertCircle className="h-3 w-3" />
                <span className="tabular-nums">{needsAttention}</span> need you
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <RotateCw
                className={`h-3 w-3 ${pollError ? "text-amber-500" : ""}`}
              />
              {pollError
                ? pollError.slice(0, 32)
                : pollAt
                  ? new Date(pollAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                      second: "2-digit",
                    })
                  : "…"}
            </span>
          </div>
        </div>

        <GoalBlock
          goal={goal}
          editing={goalEditing}
          draft={draft}
          setDraft={setDraft}
          onEdit={onGoalEdit}
          onSave={() => onGoalSave(draft.trim())}
          onCancel={onGoalCancel}
        />
      </div>
    </header>
  )
}

function GoalBlock({
  goal,
  editing,
  draft,
  setDraft,
  onEdit,
  onSave,
  onCancel,
}: {
  goal: string
  editing: boolean
  draft: string
  setDraft: (v: string) => void
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
}) {
  if (editing) {
    return (
      <div className="rounded-md border border-stone-300 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-900/30 p-3">
        <label className="block text-[10px] uppercase tracking-widest text-stone-500 dark:text-stone-400 mb-1">
          What are you trying to get done now / today?
        </label>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Verbalize the tactical goal for this operation plan…"
          className="w-full bg-transparent text-sm leading-snug outline-none resize-none placeholder:text-stone-400 dark:placeholder:text-stone-600"
        />
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px]">
          <button
            type="button"
            onClick={onCancel}
            className="px-2 py-0.5 rounded text-stone-500 hover:text-stone-700 dark:hover:text-stone-300"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="px-2 py-0.5 rounded bg-stone-900 dark:bg-stone-100 text-stone-100 dark:text-stone-900"
          >
            save
          </button>
        </div>
      </div>
    )
  }

  if (!goal) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md border border-dashed border-stone-300 dark:border-stone-700 px-3 py-2.5 text-left text-[12.5px] text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 hover:border-stone-400 dark:hover:border-stone-600"
      >
        <span className="inline-flex items-center gap-1.5">
          <Edit3 className="h-3 w-3" />
          Verbalize the operation plan — what are you trying to get done now /
          today?
        </span>
      </button>
    )
  }

  return (
    <div className="group rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/30 p-3">
      <div className="flex items-start gap-2">
        <Compass className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-500" />
        <p className="flex-1 text-sm leading-snug text-stone-800 dark:text-stone-200 whitespace-pre-wrap">
          {goal}
        </p>
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit operation goal"
          className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Next actions stripe ────────────────────────────────────────────────────

function NextActions({
  actions,
  planId,
}: {
  actions: OperationsRecommendation[]
  planId: string | null
}) {
  return (
    <section className="rounded-md border border-emerald-300/60 dark:border-emerald-700/50 bg-emerald-50/40 dark:bg-emerald-500/[0.06] p-3 sm:p-4">
      <header className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
        <h2 className="text-[13px] font-semibold tracking-tight text-emerald-900 dark:text-emerald-200">
          Next actions
        </h2>
        <span className="text-[10.5px] text-emerald-700/80 dark:text-emerald-300/80">
          ranked by kind · risk · recency
        </span>
        <Link
          href="/operator-studio/inbox"
          className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-emerald-800 dark:text-emerald-200 hover:underline"
        >
          all recommendations <ArrowUpRight className="h-3 w-3" />
        </Link>
      </header>
      <ul className="space-y-1.5">
        {actions.map((a) => (
          <RecommendationRow key={a.id} rec={a} planId={planId} />
        ))}
      </ul>
    </section>
  )
}

function RecommendationRow({
  rec,
  planId,
  compact = false,
}: {
  rec: OperationsRecommendation
  planId: string | null
  compact?: boolean
}) {
  const planHref = planId
    ? `/operator-studio/plan?planId=${planId}${rec.planStepId ? `#${rec.planStepId}` : ""}`
    : null
  const KindIcon =
    rec.kind === "launch_worker"
      ? Play
      : rec.kind === "continue_worker"
        ? Send
        : rec.kind === "request_review"
          ? AlertCircle
          : rec.kind === "mark_covered"
            ? Compass
            : Edit3
  const riskTint =
    rec.risk === "high"
      ? "text-rose-700 dark:text-rose-300"
      : rec.risk === "medium"
        ? "text-amber-700 dark:text-amber-300"
        : "text-stone-500 dark:text-stone-400"

  return (
    <li className="flex items-start gap-2">
      <KindIcon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${riskTint}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-medium text-stone-900 dark:text-stone-100">
            {rec.title}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider ${riskTint} bg-stone-100 dark:bg-stone-800/60`}
          >
            {rec.kind.replace(/_/g, " ")} · {rec.risk}
          </span>
          {rec.status === "approved" && (
            <span className="rounded bg-emerald-100 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider">
              approved
            </span>
          )}
        </div>
        {!compact && rec.rationale && (
          <p className="mt-0.5 text-[11.5px] text-stone-600 dark:text-stone-400 line-clamp-2">
            {rec.rationale}
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-stone-500 dark:text-stone-400">
          {planHref && rec.planStepId && (
            <Link
              href={planHref}
              className="inline-flex items-center gap-0.5 hover:text-stone-800 dark:hover:text-stone-200"
            >
              card <ArrowUpRight className="h-2.5 w-2.5" />
            </Link>
          )}
          <Link
            href={`/operator-studio/inbox?id=${rec.id}`}
            className="inline-flex items-center gap-0.5 hover:text-stone-800 dark:hover:text-stone-200"
          >
            decide <ExternalLink className="h-2.5 w-2.5" />
          </Link>
          <Link
            href="/operator-studio/plan?tab=bento"
            className="inline-flex items-center gap-0.5 hover:text-stone-800 dark:hover:text-stone-200"
          >
            <Zap className="h-2.5 w-2.5" /> Bento
          </Link>
        </div>
      </div>
    </li>
  )
}

// ─── Lane ───────────────────────────────────────────────────────────────────

const LANE_ICONS: Record<LaneIcon, React.ComponentType<{ className?: string }>> =
  {
    workflow: Workflow,
    gamepad: Gamepad2,
    layers: Layers,
    compass: Compass,
    target: Target,
    sparkles: Sparkles,
    wrench: Edit3,
  }

function Lane({
  lane,
  kb,
  planId,
}: {
  lane: OperationsLane
  kb: KbEntryLite[]
  planId: string | null
}) {
  const [open, setOpen] = React.useState(true)
  const Icon = LANE_ICONS[lane.icon] ?? Layers

  if (lane.cards.length === 0 && kb.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-stone-200 dark:border-stone-800 bg-transparent">
        <header className="px-3 py-2 flex items-center gap-2 text-stone-400 dark:text-stone-600">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[13px] font-medium">{lane.title}</span>
          <span className="text-[11px]">— quiet</span>
        </header>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-stone-950/40">
      <header className="px-3 sm:px-4 py-2.5 flex items-center gap-2 flex-wrap border-b border-stone-200 dark:border-stone-800">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse lane" : "Expand lane"}
          className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <div className="text-stone-700 dark:text-stone-200">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-[14px] font-semibold tracking-tight">
          {lane.title}
        </h2>
        <p className="text-[11.5px] text-stone-500 dark:text-stone-400 hidden sm:block">
          {lane.blurb}
        </p>
        <div className="ml-auto flex items-center gap-1.5 text-[10.5px] flex-wrap">
          {lane.counts.actioning > 0 && (
            <CountChip color="emerald" label="live">
              {lane.counts.actioning}
            </CountChip>
          )}
          {lane.counts.fallow > 0 && (
            <CountChip color="amber" label="fallow">
              {lane.counts.fallow}
            </CountChip>
          )}
          {lane.counts.blocked > 0 && (
            <CountChip color="rose" label="blocked">
              {lane.counts.blocked}
            </CountChip>
          )}
          {lane.counts.arming > 0 && (
            <CountChip color="sky" label="arming">
              {lane.counts.arming}
            </CountChip>
          )}
          {lane.counts.review > 0 && (
            <CountChip color="violet" label="review">
              {lane.counts.review}
            </CountChip>
          )}
          <Link
            href="/operator-studio/plan?tab=bento"
            className="ml-1 inline-flex items-center gap-1 text-[10.5px] text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            title="Open Bento for live chats"
          >
            <Zap className="h-3 w-3" /> Bento
          </Link>
        </div>
      </header>

      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr,18rem] gap-0">
          <div className="divide-y divide-stone-100 dark:divide-stone-900">
            {lane.cards.map((card) => (
              <CardRowView key={card.stepId} card={card} planId={planId} />
            ))}
            {lane.cards.length === 0 && (
              <div className="px-4 py-3 text-[12px] text-stone-500 dark:text-stone-400">
                No cards in motion in this lane.
              </div>
            )}
          </div>

          <aside className="lg:border-l border-stone-200 dark:border-stone-800 px-3 sm:px-4 py-3 bg-stone-50/40 dark:bg-stone-900/20">
            <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-stone-500 dark:text-stone-400 mb-2">
              <BookOpen className="h-3 w-3" /> Knowledge / context
            </h3>
            {kb.length === 0 ? (
              <p className="text-[11.5px] text-stone-400 dark:text-stone-600">
                No KB entries tagged for this lane yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {kb.map((entry) => (
                  <li key={entry.id} className="text-[12px] leading-snug">
                    <Link
                      href={`/operator-studio/knowledge/${entry.id}`}
                      className="text-stone-800 dark:text-stone-200 underline decoration-dotted hover:decoration-solid"
                    >
                      {entry.title}
                    </Link>
                    {entry.summary && (
                      <p className="mt-0.5 text-[11.5px] text-stone-500 dark:text-stone-400 line-clamp-2">
                        {entry.summary}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}

// ─── Card row ───────────────────────────────────────────────────────────────

function CardRowView({
  card,
  planId,
}: {
  card: OperationsCard
  planId: string | null
}) {
  const planHref = planId
    ? `/operator-studio/plan?planId=${planId}#${card.stepId}`
    : `/operator-studio/plan#${card.stepId}`
  const bentoHref = `/operator-studio/plan?tab=bento`
  return (
    <article
      className={`px-3 sm:px-4 py-3 ${
        card.needsAttention
          ? "bg-rose-50/30 dark:bg-rose-500/[0.04]"
          : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <StatusDot status={card.controlLoopStatus} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={planHref}
              className="text-[13.5px] font-medium tracking-tight text-stone-900 dark:text-stone-100 underline decoration-dotted hover:decoration-solid"
            >
              <span className="text-stone-400 dark:text-stone-600 mr-1 tabular-nums">
                {card.n}.
              </span>
              {card.title}
            </Link>
            <PlanStatusPill status={card.planStatus} />
            <OpsStatusPill status={card.controlLoopStatus} />
            <span className="text-[10.5px] text-stone-500 dark:text-stone-400">
              {card.reason}
            </span>
          </div>

          {card.description && (
            <p className="mt-1 text-[11.5px] leading-snug text-stone-500 dark:text-stone-400 line-clamp-2">
              {card.description}
            </p>
          )}

          {card.workers.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {card.workers.map((w) => (
                <WorkerChip key={w.agentId} worker={w} bentoHref={bentoHref} />
              ))}
            </ul>
          )}

          {card.recommendations.length > 0 && (
            <ul className="mt-2 space-y-1 rounded border border-stone-200/60 dark:border-stone-800/60 bg-stone-50/40 dark:bg-stone-900/30 px-2 py-1.5">
              {card.recommendations.map((r) => (
                <RecommendationRow
                  key={r.id}
                  rec={r}
                  planId={planId}
                  compact
                />
              ))}
            </ul>
          )}

          {card.evidence.length > 0 && (
            <ul className="mt-2 space-y-1">
              {card.evidence.slice(0, 3).map((e) => (
                <EvidenceChip key={e.reviewItemId} ev={e} />
              ))}
              {card.evidence.length > 3 && (
                <li className="text-[10.5px] text-stone-500 dark:text-stone-400 pl-4">
                  + {card.evidence.length - 3} more
                </li>
              )}
            </ul>
          )}

          {card.evidenceSnippet && card.controlLoopStatus === "review" && (
            <p className="mt-2 text-[11.5px] text-violet-700 dark:text-violet-300 italic line-clamp-2">
              ⟶ {card.evidenceSnippet}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0 text-[10.5px]">
          <Link
            href={planHref}
            className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
          >
            Plan card <ArrowUpRight className="h-3 w-3" />
          </Link>
          <Link
            href={bentoHref}
            className="inline-flex items-center gap-1 text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            title="Open Bento — bridge to focused chat"
          >
            <Zap className="h-3 w-3" /> Bento
          </Link>
        </div>
      </div>
    </article>
  )
}

function WorkerChip({
  worker,
  bentoHref,
}: {
  worker: OperationsWorker
  bentoHref: string
}) {
  const sourceTint =
    worker.source === "claude"
      ? "text-orange-700 dark:text-orange-300 bg-orange-100/60 dark:bg-orange-500/10"
      : worker.source === "codex"
        ? "text-violet-700 dark:text-violet-300 bg-violet-100/60 dark:bg-violet-500/10"
        : "text-stone-700 dark:text-stone-300 bg-stone-200/60 dark:bg-stone-700/30"
  return (
    <li className="flex items-start gap-2">
      <span
        className={`shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceTint}`}
      >
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            worker.isLive ? "bg-emerald-500 animate-pulse" : "bg-stone-400"
          }`}
        />
        {worker.source}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] leading-snug text-stone-800 dark:text-stone-200 line-clamp-2">
          {worker.headline}
        </p>
        {worker.toolHint && (
          <p className="text-[10.5px] leading-snug text-stone-500 dark:text-stone-400 line-clamp-1">
            {worker.toolHint}
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-stone-400 dark:text-stone-500">
          <span>{formatAge(worker.ageMs)}</span>
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <BindingSourcePill source={worker.bindingSource} />
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <Link
            href={bentoHref}
            className="inline-flex items-center gap-0.5 hover:text-stone-700 dark:hover:text-stone-200"
            title="Open in Bento"
          >
            open <ExternalLink className="h-2.5 w-2.5" />
          </Link>
        </div>
      </div>
    </li>
  )
}

function EvidenceChip({ ev }: { ev: OperationsEvidence }) {
  return (
    <li className="flex items-start gap-2 text-[11px] leading-snug">
      <FileWarning className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/operator-studio/inbox?id=${ev.reviewItemId}`}
          className="text-stone-800 dark:text-stone-200 underline decoration-dotted hover:decoration-solid"
        >
          {ev.title}
        </Link>
        <span className="ml-1.5 text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-600">
          {ev.sourceLabel ?? ev.sourceType} · {ev.state}
        </span>
        {ev.summary && (
          <p className="text-[10.5px] text-stone-500 dark:text-stone-400 line-clamp-1">
            {ev.summary}
          </p>
        )}
      </div>
    </li>
  )
}

// ─── Status indicators ──────────────────────────────────────────────────────

const STATUS_RING: Record<ControlLoopStatus, string> = {
  actioning: "bg-emerald-500",
  fallow: "bg-amber-400",
  arming: "bg-sky-400",
  review: "bg-violet-500",
  blocked: "bg-rose-500",
  landed: "bg-stone-400",
  queued: "bg-stone-300 dark:bg-stone-700",
}

function StatusDot({ status }: { status: ControlLoopStatus }) {
  return (
    <span
      className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_RING[status]} ${
        status === "actioning" ? "animate-pulse" : ""
      }`}
    />
  )
}

function OpsStatusPill({ status }: { status: ControlLoopStatus }) {
  const tints: Record<ControlLoopStatus, string> = {
    actioning:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    fallow:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    arming: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    review:
      "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    blocked:
      "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
    landed:
      "bg-stone-100 text-stone-700 dark:bg-stone-800/60 dark:text-stone-400",
    queued:
      "bg-stone-100 text-stone-600 dark:bg-stone-800/40 dark:text-stone-500",
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider ${tints[status]}`}
    >
      {status === "fallow" && <Moon className="h-2.5 w-2.5" />}
      {status === "blocked" && <AlertCircle className="h-2.5 w-2.5" />}
      {status === "review" && <MessagesSquare className="h-2.5 w-2.5" />}
      {status}
    </span>
  )
}

function PlanStatusPill({
  status,
}: {
  status: OperationsCard["planStatus"]
}) {
  const tints: Record<OperationsCard["planStatus"], string> = {
    "in-motion":
      "bg-stone-200/70 text-stone-800 dark:bg-stone-800/70 dark:text-stone-200",
    drifting:
      "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    covered:
      "bg-stone-100 text-stone-700 dark:bg-stone-800/40 dark:text-stone-300",
    open: "bg-stone-50 text-stone-600 dark:bg-stone-900/40 dark:text-stone-500",
    skipped:
      "bg-stone-50 text-stone-400 line-through dark:bg-stone-900/40 dark:text-stone-600",
  }
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider ${tints[status]}`}
    >
      plan: {status}
    </span>
  )
}

function CountChip({
  color,
  label,
  children,
}: {
  color: "emerald" | "amber" | "sky" | "violet" | "rose"
  label: string
  children: React.ReactNode
}) {
  const map: Record<typeof color, string> = {
    emerald:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
    violet:
      "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${map[color]}`}
    >
      <span className="tabular-nums font-medium">{children}</span>
      <span className="opacity-80">{label}</span>
    </span>
  )
}

function BindingSourcePill({
  source,
}: {
  source: OperationsWorker["bindingSource"]
}) {
  const label =
    source === "durable"
      ? "bound"
      : source === "manual"
        ? "linked"
        : source === "launch"
          ? "launched"
          : source === "scheduled"
            ? "scheduled"
            : "sniffed"
  const tint =
    source === "durable"
      ? "text-stone-600 dark:text-stone-400"
      : source === "manual" || source === "launch"
        ? "text-stone-500 dark:text-stone-500"
        : "text-stone-400 dark:text-stone-600 italic"
  return <span className={tint}>{label}</span>
}

function formatAge(ms: number): string {
  if (!Number.isFinite(ms)) return "—"
  if (ms < 60_000) return "just now"
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// ─── Loading + secondary sections ───────────────────────────────────────────

function LoadingShell({ error }: { error: string | null }) {
  return (
    <div className="rounded-md border border-stone-200 dark:border-stone-800 p-4 text-[12px] text-stone-500 dark:text-stone-400">
      {error ? (
        <span className="text-amber-600 dark:text-amber-400">
          Failed to load: {error}
        </span>
      ) : (
        "Loading control-loop view…"
      )}
    </div>
  )
}

function UnboundLane({ workers }: { workers: OperationsWorker[] }) {
  return (
    <section className="rounded-md border border-dashed border-amber-300 dark:border-amber-700/40 bg-amber-50/30 dark:bg-amber-500/5 p-3 sm:p-4">
      <header className="flex items-center gap-2 mb-2 flex-wrap">
        <AlertCircle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
        <h2 className="text-[13px] font-semibold tracking-tight text-amber-900 dark:text-amber-200">
          Unbound workers
        </h2>
        <span className="text-[10.5px] text-amber-700 dark:text-amber-300/80">
          {workers.length} worker{workers.length === 1 ? "" : "s"} running
          outside the active plan · link in Bento or via a recommendation
        </span>
        <Link
          href="/operator-studio/plan?tab=bento"
          className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-amber-800 dark:text-amber-200 hover:underline"
        >
          <Zap className="h-3 w-3" /> Open Bento
        </Link>
      </header>
      <ul className="space-y-1.5">
        {workers.map((w) => (
          <WorkerChip
            key={w.agentId}
            worker={w}
            bentoHref="/operator-studio/plan?tab=bento"
          />
        ))}
      </ul>
    </section>
  )
}

function LaunchWaveSection({ ledger }: { ledger: LaunchWaveLedger }) {
  const sourceSummary =
    ledger.totals.sourceCounts.length > 0
      ? ledger.totals.sourceCounts
          .map((s) => `${s.source} ${s.count}${s.active ? `/${s.active} live` : ""}`)
          .join(" · ")
      : "no sources yet"
  return (
    <section className="rounded-md border border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-stone-950/40 p-3 sm:p-4">
      <header className="flex items-center gap-2 mb-2 flex-wrap">
        <Workflow className="h-3.5 w-3.5 text-stone-500" />
        <h2 className="text-[13px] font-semibold tracking-tight">
          Launch waves
        </h2>
        <span className="text-[10.5px] text-stone-500 dark:text-stone-400">
          {ledger.totals.waves} wave{ledger.totals.waves === 1 ? "" : "s"} ·{" "}
          {ledger.totals.launches} launch fact
          {ledger.totals.launches === 1 ? "" : "s"} · {sourceSummary}
        </span>
      </header>

      {ledger.emptyState ? (
        <p className="text-[12px] text-stone-500 dark:text-stone-400">
          <span className="font-medium text-stone-700 dark:text-stone-300">
            {ledger.emptyState.title}.
          </span>{" "}
          {ledger.emptyState.body}
        </p>
      ) : (
        <ul className="space-y-2">
          {ledger.waves.slice(0, 6).map((wave) => (
            <LaunchWaveRow key={wave.id} wave={wave} />
          ))}
        </ul>
      )}
      {!ledger.emptyState && ledger.waves.length > 6 && (
        <p className="mt-2 text-[10.5px] text-stone-500 dark:text-stone-400">
          + {ledger.waves.length - 6} more wave
          {ledger.waves.length - 6 === 1 ? "" : "s"} in the shared operations
          payload.
        </p>
      )}
    </section>
  )
}

function LaunchWaveRow({ wave }: { wave: LaunchWaveRecord }) {
  const sources = wave.sourceCounts
    .map((s) => `${s.source} ${s.count}${s.active ? `/${s.active} live` : ""}`)
    .join(" · ")
  const statuses = Object.entries(wave.statuses)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status} ${count}`)
    .join(" · ")
  return (
    <li className="rounded-md border border-stone-200/70 dark:border-stone-800/70 bg-stone-50/40 dark:bg-stone-900/30 px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-medium text-stone-900 dark:text-stone-100">
          {wave.id}
        </span>
        <span className="text-[10.5px] text-stone-500 dark:text-stone-400">
          {sources || "no sources"} {statuses ? `· ${statuses}` : ""}
        </span>
      </div>
      {wave.boundCards.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {wave.boundCards.slice(0, 3).map((card) => (
            <li
              key={card.planStepId}
              className="text-[11.5px] text-stone-600 dark:text-stone-400 truncate"
            >
              <span className="font-mono text-[10.5px] text-stone-400 dark:text-stone-600">
                {card.planStepId}
              </span>
              {card.planStepTitle ? ` — ${card.planStepTitle}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[11.5px] text-stone-400 dark:text-stone-600">
          No bound cards in this wave yet.
        </p>
      )}
    </li>
  )
}

function FloatingRecs({ recs }: { recs: OperationsRecommendation[] }) {
  return (
    <section className="rounded-md border border-stone-200 dark:border-stone-800 bg-white/40 dark:bg-stone-950/40 p-3 sm:p-4">
      <header className="flex items-center gap-2 mb-2">
        <Sparkles className="h-3.5 w-3.5 text-stone-500" />
        <h2 className="text-[13px] font-semibold tracking-tight">
          Floating recommendations
        </h2>
        <span className="text-[10.5px] text-stone-500 dark:text-stone-400">
          not anchored to a card in this plan
        </span>
      </header>
      <ul className="space-y-1.5">
        {recs.map((r) => (
          <RecommendationRow key={r.id} rec={r} planId={null} />
        ))}
      </ul>
    </section>
  )
}

function Provenance({ notes }: { notes: string[] }) {
  return (
    <footer className="px-1 pt-2 text-[10.5px] leading-relaxed text-stone-500 dark:text-stone-500">
      <p className="mb-1">
        <span className="font-medium text-stone-600 dark:text-stone-400">
          Object model:
        </span>{" "}
        plan → lane → card → worker · evidence · recommendation. Same
        view served from{" "}
        <code>/api/operator-studio/operations</code> for Codex / future
        CLI.
      </p>
      <ul className="space-y-0.5">
        {notes.map((n, i) => (
          <li key={i}>· {n}</li>
        ))}
      </ul>
    </footer>
  )
}
