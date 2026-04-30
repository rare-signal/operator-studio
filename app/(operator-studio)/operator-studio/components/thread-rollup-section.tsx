"use client"

import * as React from "react"
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import { cn } from "@/lib/utils"
import type { ThreadEnrichmentRow } from "@/lib/operator-studio/wayseer/queries"
import type {
  RollupBeat,
  RollupCitation,
  ThreadRollup,
} from "@/lib/operator-studio/wayseer/contracts/thread-rollup"
import type {
  OperatorSourceApp,
  OperatorThreadMessage,
} from "@/lib/operator-studio/types"
import { SOURCE_APP_LABELS } from "@/lib/operator-studio/types"

interface Props {
  threadId: string
  sourceApp: OperatorSourceApp
  /** Indexed message map keyed by turnIndex for cheap citation hydration. */
  messagesByTurnIndex: Map<number, OperatorThreadMessage>
}

/**
 * The opinionated thread-rollup surface ported from AIDA Observatory.
 * Three colored hero panels (what happened / need-to-know / vibe), a
 * numbered serif timeline of story beats, expandable beat rows that
 * reveal citations.
 *
 * Phase 1: hydrated from a fixture via POST to the rollup endpoint.
 * Phase 2: backed by a live planner→writer pipeline driven off pulse
 * ticks.
 */
export function ThreadRollupSection({
  threadId,
  sourceApp,
  messagesByTurnIndex,
}: Props) {
  const [rollup, setRollup] = React.useState<ThreadRollup | null>(null)
  const [status, setStatus] = React.useState<
    "loading" | "empty" | "running" | "completed" | "failed"
  >("loading")
  const [error, setError] = React.useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = React.useState<string | null>(null)
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Apply an enrichment row to local state and decide whether we
   *  need to keep polling. Centralized so initial load and refresh
   *  agree on the state machine. */
  const applyEnrichment = React.useCallback(
    (e: ThreadEnrichmentRow<ThreadRollup> | null) => {
      if (!e) {
        setStatus("empty")
        setRollup(null)
        return false
      }
      if (e.status === "completed" && e.resultPayload) {
        setRollup(e.resultPayload)
        setUpdatedAt(e.completedAt ?? e.updatedAt)
        setStatus("completed")
        setError(null)
        return false
      }
      if (e.status === "failed") {
        setStatus("failed")
        setError(e.errorMessage ?? "Rollup failed")
        return false
      }
      // running / pending — keep what we had and signal the caller to poll.
      setStatus("running")
      return true
    },
    []
  )

  const load = React.useCallback(async (): Promise<boolean> => {
    try {
      const r = await fetch(
        `/api/operator-studio/wayseer/threads/${threadId}/rollup`,
        { cache: "no-store" }
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data: { enrichment: ThreadEnrichmentRow<ThreadRollup> | null } =
        await r.json()
      return applyEnrichment(data.enrichment)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rollup")
      setStatus("failed")
      return false
    }
  }, [threadId, applyEnrichment])

  // Initial load + polling while running. The pipeline is two LLM
  // calls; against a small local model (qwen 9b) on a fast box, each
  // typically completes in 5–15s. We poll every 2s; this is single-
  // user infra so we don't bother with backoff.
  React.useEffect(() => {
    let cancelled = false
    async function loop() {
      const keepPolling = await load()
      if (cancelled || !keepPolling) return
      pollTimer.current = setTimeout(loop, 2000)
    }
    void loop()
    return () => {
      cancelled = true
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [load])

  const refresh = React.useCallback(
    async (force: boolean) => {
      setError(null)
      setStatus("running")
      try {
        const qs = force ? "?force=1" : ""
        const r = await fetch(
          `/api/operator-studio/wayseer/threads/${threadId}/rollup${qs}`,
          { method: "POST" }
        )
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data: {
          enrichment: ThreadEnrichmentRow<ThreadRollup> | null
          reused?: boolean
        } = await r.json()
        const stillRunning = applyEnrichment(data.enrichment)
        if (stillRunning && !pollTimer.current) {
          pollTimer.current = setTimeout(async function poll() {
            const keep = await load()
            if (keep) pollTimer.current = setTimeout(poll, 2000)
            else pollTimer.current = null
          }, 2000)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to refresh rollup")
        setStatus("failed")
      }
    },
    [threadId, applyEnrichment, load]
  )

  if (status === "loading") {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/20 px-4 py-6 text-center text-xs text-muted-foreground">
        <Loader2 className="mx-auto mb-1.5 h-4 w-4 animate-spin" />
        Loading Wayseer rollup…
      </div>
    )
  }

  if (status === "empty") {
    return (
      <RollupEmptyState onGenerate={() => refresh(false)} loading={false} />
    )
  }

  if (status === "running" && !rollup) {
    return <RollupRunningState />
  }

  if (status === "failed" && !rollup) {
    return (
      <RollupFailedState
        error={error}
        onRetry={() => refresh(true)}
      />
    )
  }

  if (!rollup) {
    // Defensive fallback — shouldn't be reachable.
    return <RollupEmptyState onGenerate={() => refresh(false)} loading={false} />
  }

  // Rolldown cascade: when the user navigates to a thread with an
  // existing rollup, the wrapper mounts fresh and each section
  // unfurls from the top with a small stagger. Refreshing in place
  // doesn't remount these wrappers, so the animation only fires on
  // arrival — that's the "click on a thread that has enrichment"
  // delight moment we're after.
  return (
    <div className="space-y-4">
      <Rolldown delayMs={0}>
        <RollupHeader
          rollup={rollup}
          updatedAt={updatedAt}
          running={status === "running"}
          onRefresh={() => refresh(true)}
          error={error}
        />
      </Rolldown>
      <RollupHeroPanels rollup={rollup} />
      <Rolldown delayMs={300}>
        <RollupTimeline
          beats={rollup.beats}
          sourceApp={sourceApp}
          messagesByTurnIndex={messagesByTurnIndex}
        />
      </Rolldown>
    </div>
  )
}

/**
 * Wrapper that runs the AIDA-style "rolldown" entry animation on
 * mount. Slides in from the top with a small fade — the panels
 * appear to unfurl into place. `[animation-fill-mode:both]` is what
 * keeps the element invisible during its delay; without it, late-
 * cascading panels would briefly flash in their final state before
 * sliding.
 */
function Rolldown({
  children,
  delayMs,
  fromY = 3,
  durationMs = 600,
  className,
}: {
  children: React.ReactNode
  delayMs: number
  fromY?: 2 | 3 | 4 | 5
  durationMs?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        "animate-in fade-in-0 [animation-fill-mode:both]",
        fromY === 2 && "slide-in-from-top-2",
        fromY === 3 && "slide-in-from-top-3",
        fromY === 4 && "slide-in-from-top-4",
        fromY === 5 && "slide-in-from-top-5",
        className
      )}
      style={{
        animationDelay: `${delayMs}ms`,
        animationDuration: `${durationMs}ms`,
      }}
    >
      {children}
    </div>
  )
}

// ─── Running / failed full-card states ─────────────────────────────────────

function RollupRunningState() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-violet-500/20 bg-slate-950 px-5 py-5 text-slate-100">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse at 15% 20%, rgba(168, 85, 247, 0.30), transparent 55%)",
            "radial-gradient(ellipse at 85% 70%, rgba(236, 72, 153, 0.22), transparent 55%)",
          ].join(", "),
        }}
      />
      <div className="relative flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
          <Loader2 className="size-5 animate-spin text-white drop-shadow-[0_0_8px_rgba(236,72,153,0.9)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">Generating rollup…</div>
          <div className="mt-0.5 text-xs text-violet-100/70">
            Planning chronology, then writing — usually 10–30 seconds against a
            local model.
          </div>
        </div>
      </div>
    </div>
  )
}

function RollupFailedState({
  error,
  onRetry,
}: {
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3.5 text-sm">
      <div className="font-semibold text-destructive">Rollup failed</div>
      <div className="mt-0.5 text-xs text-muted-foreground">
        {error ?? "The pipeline returned an error."}
      </div>
      <div className="mt-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-7 text-xs"
        >
          <RefreshCw className="mr-1 size-3" />
          Retry
        </Button>
      </div>
    </div>
  )
}

// ─── Empty / first-run state ────────────────────────────────────────────────

function RollupEmptyState({
  onGenerate,
  loading,
}: {
  onGenerate: () => void
  loading: boolean
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-violet-500/20 bg-slate-950 px-5 py-5 text-slate-100">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse at 15% 20%, rgba(168, 85, 247, 0.30), transparent 55%)",
            "radial-gradient(ellipse at 85% 70%, rgba(236, 72, 153, 0.22), transparent 55%)",
            "radial-gradient(ellipse at 50% 50%, rgba(99, 102, 241, 0.22), transparent 60%)",
          ].join(", "),
        }}
      />
      <div className="relative flex items-center gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
          <Sparkles className="size-5 text-white drop-shadow-[0_0_8px_rgba(236,72,153,0.9)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">No rollup yet</div>
          <div className="mt-0.5 text-xs text-violet-100/70">
            Wayseer can summarize this thread into a headline, key moments, and a
            citation-backed timeline.
          </div>
        </div>
        <Button
          type="button"
          onClick={onGenerate}
          disabled={loading}
          className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow-[0_0_18px_rgba(168,85,247,0.45)] hover:from-violet-400 hover:to-fuchsia-400"
        >
          {loading ? (
            <>
              <Loader2 className="mr-1.5 size-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 size-4" />
              Generate rollup
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ─── Header ────────────────────────────────────────────────────────────────

function RollupHeader({
  rollup,
  updatedAt,
  running,
  onRefresh,
  error,
}: {
  rollup: ThreadRollup
  updatedAt: string | null
  running: boolean
  onRefresh: () => void
  error: string | null
}) {
  const isFixture = rollup.signalsUsed.generationMode === "fixture"
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <Sparkles className="size-3 text-violet-500" />
          Wayseer rollup
          {isFixture && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
              fixture
            </span>
          )}
          {updatedAt && (
            <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
              · {formatRelative(updatedAt)}
            </span>
          )}
        </div>
        <h2 className="mt-1 text-xl font-semibold leading-tight tracking-tight">
          {rollup.headline}
        </h2>
      </div>
      {running && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          Refreshing…
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRefresh}
        disabled={running}
        className="h-7 shrink-0 px-2 text-xs"
      >
        <RefreshCw className="mr-1 size-3" />
        Refresh
      </Button>
      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

// ─── Hero panels (what happened / need-to-know / vibe) ─────────────────────

function RollupHeroPanels({ rollup }: { rollup: ThreadRollup }) {
  return (
    <div className="grid gap-3 md:grid-cols-12">
      <Rolldown
        delayMs={80}
        fromY={3}
        durationMs={650}
        className="md:col-span-12"
      >
        <Panel tone="rose" eyebrow="Here's what happened.">
          <p className="text-[13.5px] leading-relaxed">{rollup.whatHappened}</p>
        </Panel>
      </Rolldown>
      <Rolldown
        delayMs={170}
        fromY={4}
        durationMs={650}
        className="md:col-span-7"
      >
        <Panel tone="emerald" eyebrow="Here's the need-to-know.">
          <ul className="space-y-1.5 text-[13px] leading-relaxed">
            {rollup.needToKnow.map((bullet, i) => (
              <li key={i} className="flex gap-2">
                <span
                  aria-hidden
                  className="mt-[7px] size-1 shrink-0 rounded-full bg-emerald-700/70 dark:bg-emerald-300/70"
                />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </Rolldown>
      <Rolldown
        delayMs={220}
        fromY={4}
        durationMs={650}
        className="md:col-span-5"
      >
        <Panel tone="sky" eyebrow="Here's what the vibe was.">
          <p className="text-[13px] leading-relaxed">{rollup.vibe}</p>
        </Panel>
      </Rolldown>
    </div>
  )
}

const PANEL_TONES = {
  rose: {
    bg: "bg-[#fdf3f1] dark:bg-rose-950/25",
    border: "border-[#f1d8d4] dark:border-rose-900/40",
    eyebrow: "text-[#8c4a45] dark:text-rose-200/80",
    body: "text-[#3a1f1c] dark:text-rose-50",
  },
  emerald: {
    bg: "bg-[#f0f5ee] dark:bg-emerald-950/25",
    border: "border-[#d3e3cd] dark:border-emerald-900/40",
    eyebrow: "text-[#3f6b3f] dark:text-emerald-200/80",
    body: "text-[#1f3a26] dark:text-emerald-50",
  },
  sky: {
    bg: "bg-[#eff3f8] dark:bg-sky-950/25",
    border: "border-[#d2dde9] dark:border-sky-900/40",
    eyebrow: "text-[#3a5a7a] dark:text-sky-200/80",
    body: "text-[#1d2c40] dark:text-sky-50",
  },
} as const
type PanelTone = keyof typeof PANEL_TONES

function Panel({
  tone,
  eyebrow,
  children,
  className,
}: {
  tone: PanelTone
  eyebrow: string
  children: React.ReactNode
  className?: string
}) {
  const t = PANEL_TONES[tone]
  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-3.5",
        t.bg,
        t.border,
        className
      )}
    >
      <div
        className={cn(
          "mb-1.5 text-[11px] font-medium tracking-tight",
          t.eyebrow
        )}
      >
        {eyebrow}
      </div>
      <div className={t.body}>{children}</div>
    </section>
  )
}

// ─── Timeline of beats ─────────────────────────────────────────────────────

function RollupTimeline({
  beats,
  sourceApp,
  messagesByTurnIndex,
}: {
  beats: RollupBeat[]
  sourceApp: OperatorSourceApp
  messagesByTurnIndex: Map<number, OperatorThreadMessage>
}) {
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold tracking-tight">
          Here's the timeline of what happened.
        </h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {beats.length} {beats.length === 1 ? "beat" : "beats"}
        </span>
      </div>
      <ol className="divide-y">
        {beats.map((beat, i) => (
          <Beat
            key={beat.id}
            beat={beat}
            sourceApp={sourceApp}
            messagesByTurnIndex={messagesByTurnIndex}
            rolldownDelayMs={400 + i * 70}
          />
        ))}
      </ol>
    </section>
  )
}

function Beat({
  beat,
  sourceApp,
  messagesByTurnIndex,
  rolldownDelayMs,
}: {
  beat: RollupBeat
  sourceApp: OperatorSourceApp
  messagesByTurnIndex: Map<number, OperatorThreadMessage>
  rolldownDelayMs?: number
}) {
  const [expanded, setExpanded] = React.useState(false)
  const hasRefs = beat.refs.length > 0
  const expandable = hasRefs
  const indexLabel = String(beat.index).padStart(2, "0")
  return (
    <li
      className={cn(
        rolldownDelayMs !== undefined &&
          "animate-in fade-in-0 slide-in-from-top-2 [animation-fill-mode:both]"
      )}
      style={
        rolldownDelayMs !== undefined
          ? {
              animationDelay: `${rolldownDelayMs}ms`,
              animationDuration: "500ms",
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => expandable && setExpanded((s) => !s)}
        disabled={!expandable}
        className={cn(
          "flex w-full items-start gap-4 px-4 py-4 text-left",
          expandable && "hover:bg-muted/40 transition-colors",
          !expandable && "cursor-default"
        )}
      >
        <span
          aria-hidden
          className="mt-0.5 shrink-0 font-serif text-[28px] font-bold leading-none tabular-nums text-[#7a2a2a] dark:text-rose-300/80"
        >
          {indexLabel}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold leading-snug">
            {beat.title}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {beat.summary}
          </p>
          <div className="mt-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground/60">
            Turns {beat.startTurnIndex + 1}–{beat.endTurnIndex + 1}
            {hasRefs && (
              <>
                {" · "}
                {beat.refs.length}{" "}
                {beat.refs.length === 1 ? "citation" : "citations"}
              </>
            )}
          </div>
        </div>
        {expandable && (
          <span
            aria-hidden
            className="mt-1 shrink-0 text-muted-foreground/60"
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </span>
        )}
      </button>
      {expanded && hasRefs && (
        <div className="space-y-2 border-t bg-muted/20 px-4 py-3 pl-[60px]">
          {beat.refs.map((ref, i) => (
            <Citation
              key={i}
              ref_={ref}
              sourceApp={sourceApp}
              message={messagesByTurnIndex.get(ref.turnIndex)}
            />
          ))}
        </div>
      )}
    </li>
  )
}

function Citation({
  ref_,
  sourceApp,
  message,
}: {
  ref_: RollupCitation
  sourceApp: OperatorSourceApp
  message: OperatorThreadMessage | undefined
}) {
  const sourceLabel = SOURCE_APP_LABELS[sourceApp] ?? sourceApp
  return (
    <div className="rounded border bg-background px-3 py-2 text-[12.5px]">
      <div className="mb-1 flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-muted-foreground/70">
        <span className="font-semibold text-muted-foreground">
          {sourceLabel}
        </span>
        <span>·</span>
        <span>
          {ref_.role} #{ref_.turnIndex + 1}
        </span>
      </div>
      <p className="leading-relaxed">
        {message?.content ? excerpt(message.content, 320) : ref_.excerpt}
      </p>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function excerpt(text: string, max: number): string {
  const stripped = text.replace(/\s+/g, " ").trim()
  return stripped.length <= max ? stripped : stripped.slice(0, max - 1) + "…"
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
