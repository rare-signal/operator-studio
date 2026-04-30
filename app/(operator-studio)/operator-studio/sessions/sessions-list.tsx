"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Clock,
  Eye,
  GitBranch,
  Layers,
  MessageSquare,
  Target,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { defaultSessionLabel } from "@/lib/operator-studio/sessions"
import type { OperatorSession } from "@/lib/operator-studio/types"
import { IMPORTER_SOURCE_IDS } from "@/lib/operator-studio/types"

interface WatcherStatus {
  enabled: boolean
  watching: boolean
  roots: Array<{ source: string; root: string }>
}

interface TopThread {
  threadId: string
  title: string | null
  messageCount: number
}

interface DailyActivity {
  date: string // YYYY-MM-DD
  messageCount: number
}

interface SessionsListProps {
  sessions: OperatorSession[]
  activity: DailyActivity[]
  topThreads: Record<string, TopThread[]>
}

// A session is "current" if activity landed within the last 3h — the
// same gap threshold segmentation uses, so the hero card represents
// "what you're in right now."
function isCurrent(session: OperatorSession): boolean {
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
  return new Date(session.endedAt).getTime() >= threeHoursAgo
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })
}

function formatDuration(
  startedAt: string,
  endedAt: string | null = null
): string {
  const start = new Date(startedAt).getTime()
  const end = endedAt ? new Date(endedAt).getTime() : Date.now()
  const minutes = Math.max(1, Math.round((end - start) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`
}

/** "Today", "Yesterday", "Mon Apr 14", "Sun Mar 9" */
function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const ymd = (x: Date) =>
    `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const today = ymd(now)
  const yest = ymd(new Date(now.getTime() - 24 * 60 * 60 * 1000))
  const target = ymd(d)
  if (target === today) return "Today"
  if (target === yest) return "Yesterday"
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

export function SessionsList({
  sessions,
  activity,
  topThreads,
}: SessionsListProps) {
  const router = useRouter()
  const [watcher, setWatcher] = React.useState<WatcherStatus | null>(null)
  const [syncing, setSyncing] = React.useState(false)
  const [syncedAt, setSyncedAt] = React.useState<Date | null>(null)
  // Per-source count of on-disk sessions that were SKIPPED as
  // historical during the first-run silent sync. Populated from the
  // POST /discover response. Non-zero means "we saw files on disk
  // we're not touching without your say-so" — surface as a banner.
  const [historicalBySource, setHistoricalBySource] = React.useState<
    Record<string, number>
  >({})
  const [importingHistorical, setImportingHistorical] = React.useState<
    string | null
  >(null)

  React.useEffect(() => {
    let cancelled = false
    fetch("/api/operator-studio/watcher-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setWatcher(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Kick a silent ingest sync on page load. The watcher handles
  // in-the-moment changes, but a user who just fired up the server
  // or bounced in from a different surface might have turns that
  // landed on disk while nothing was listening. This closes the gap:
  // on load, sweep both sources, let ingestSession's append-on-grow
  // pick up any new turns in ongoing conversations. router.refresh()
  // re-fetches the page with the freshly-appended turns.
  React.useEffect(() => {
    let cancelled = false
    async function syncBoth() {
      setSyncing(true)
      try {
        // Driven from the importer registry so adding a new source
        // (OpenCode etc.) auto-participates in the on-mount sync sweep.
        const sources = IMPORTER_SOURCE_IDS
        const results = await Promise.all(
          sources.map((source) =>
            fetch("/api/operator-studio/discover", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source, mode: "sync" }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        )
        if (cancelled) return
        // Capture per-source historical counts so we can surface the
        // "Found N on-disk sessions, import them?" banner.
        const byHistorical: Record<string, number> = {}
        sources.forEach((source, i) => {
          const r = results[i]
          if (r?.skippedAsHistorical > 0) {
            byHistorical[source] = r.skippedAsHistorical
          }
        })
        setHistoricalBySource(byHistorical)
        // Only bother refreshing the page if something actually
        // changed — otherwise we're just thrashing.
        const changed = results.some(
          (r) =>
            r &&
            ((r.imported ?? 0) > 0 ||
              (r.appended ?? 0) > 0 ||
              (r.appendedMessages ?? 0) > 0)
        )
        setSyncedAt(new Date())
        if (changed) router.refresh()
      } finally {
        if (!cancelled) setSyncing(false)
      }
    }
    syncBoth()
    return () => {
      cancelled = true
    }
  }, [router])

  const current = sessions.find(isCurrent) ?? null
  const past = sessions.filter((s) => s !== current)

  // Group past sessions by day for the visual rhythm.
  const groups = React.useMemo(() => {
    const byDay = new Map<string, OperatorSession[]>()
    for (const s of past) {
      const key = new Date(s.startedAt).toDateString()
      const bucket = byDay.get(key) ?? []
      bucket.push(s)
      byDay.set(key, bucket)
    }
    return Array.from(byDay.entries()).map(([, sessions]) => ({
      // Preserve original session ordering (descending startedAt).
      sessions,
    }))
  }, [past])

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">
            Session Spaces
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your working sessions, segmented by natural idle gaps.
          </p>
        </header>
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-20 text-center">
          <Layers className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground max-w-sm">
            Nothing to show yet. Import or capture some activity from
            Claude Code or Codex — your sessions will show up here.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 p-6 pb-24 max-w-5xl">
      {/* Page header */}
      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Session Spaces
          </h1>
          {watcher?.watching && <LivePill />}
        </div>
        <p className="text-sm text-muted-foreground">
          {sessions.length} session{sessions.length === 1 ? "" : "s"} across
          the last 90 days. Segmented by 3+ hour idle gaps.
          {watcher?.watching && (
            <>
              {" "}
              <Eye className="inline h-3 w-3 mb-0.5" /> Live —{" "}
              {watcher.roots.length} source root
              {watcher.roots.length === 1 ? "" : "s"} watched.
            </>
          )}
          {syncing && (
            <span className="ml-2 text-[11px] text-muted-foreground/70">
              · syncing from disk…
            </span>
          )}
          {!syncing && syncedAt && (
            <span className="ml-2 text-[11px] text-muted-foreground/50">
              · synced at {formatTime(syncedAt.toISOString())}
            </span>
          )}
        </p>
      </header>

      {/* Activity sparkline — 30-day temporal shape */}
      <ActivityStrip activity={activity} />

      {/* On-disk historical callout — "we saw N on-disk sessions for X
          that we're holding back behind first-run gate, want to import?" */}
      {Object.keys(historicalBySource).length > 0 && (
        <HistoricalCallout
          counts={historicalBySource}
          busyFor={importingHistorical}
          onImport={async (source) => {
            setImportingHistorical(source)
            try {
              const res = await fetch("/api/operator-studio/discover", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  source,
                  mode: "sync",
                  importHistorical: true,
                }),
              })
              if (res.ok) {
                setHistoricalBySource((prev) => {
                  const next = { ...prev }
                  delete next[source]
                  return next
                })
                router.refresh()
              } else {
                const data = await res.json().catch(() => ({}))
                window.alert(
                  `Import failed: ${data.error ?? "unknown error"}`
                )
              }
            } finally {
              setImportingHistorical(null)
            }
          }}
          onDismiss={() => setHistoricalBySource({})}
        />
      )}

      {/* Hero: current session */}
      {current && (
        <CurrentSessionHero
          session={current}
          topThreads={topThreads[current.id] ?? []}
          onOpen={() =>
            router.push(`/operator-studio/sessions/${current.id}`)
          }
        />
      )}

      {/* Past sessions grouped by day */}
      {groups.length > 0 && (
        <section className="space-y-6">
          {groups.map(({ sessions }, groupIdx) => {
            const ageDays = groupAgeDays(sessions[0].startedAt)
            const dim =
              ageDays >= 7
                ? "opacity-70"
                : ageDays >= 3
                  ? "opacity-85"
                  : ""
            return (
              <div key={groupIdx} className={`space-y-2 ${dim}`}>
                <div className="flex items-center gap-3 px-1">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                    {dayLabel(sessions[0].startedAt)}
                  </h2>
                  <div className="flex-1 border-t border-border/60" />
                  <span className="text-[10px] text-muted-foreground/60">
                    {sessions.length} session
                    {sessions.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {sessions.map((session) => (
                    <PastSessionRow
                      key={session.id}
                      session={session}
                      topThreads={topThreads[session.id] ?? []}
                      onOpen={() =>
                        router.push(
                          `/operator-studio/sessions/${session.id}`
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

function groupAgeDays(iso: string): number {
  const then = new Date(iso).getTime()
  const now = Date.now()
  return Math.floor((now - then) / (24 * 60 * 60 * 1000))
}

// ─── Pieces ────────────────────────────────────────────────────────────────

function LivePill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
      </span>
      live
    </span>
  )
}

/**
 * 30-day message-volume bars. Gives the user the instant-at-a-glance
 * answer to "what does my last month of work look like?" Today's bar
 * gets an accent ring. Empty days are rendered as tiny stubs so the
 * rhythm of your work (busy days, quiet days) reads clearly.
 */
function ActivityStrip({ activity }: { activity: DailyActivity[] }) {
  // Fill in zero-days so the strip is exactly 30 bars wide and no
  // visual gaps mislead the eye.
  const days = 30
  const now = new Date()
  const byDate = new Map<string, number>()
  for (const a of activity) byDate.set(a.date, a.messageCount)
  const bars: Array<{ date: string; count: number; isToday: boolean }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    bars.push({
      date: iso,
      count: byDate.get(iso) ?? 0,
      isToday: i === 0,
    })
  }

  const max = Math.max(1, ...bars.map((b) => b.count))
  const total = bars.reduce((s, b) => s + b.count, 0)

  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Activity · last 30 days
          </p>
          <p className="text-xs text-muted-foreground/80 mt-0.5">
            {total.toLocaleString()} turn{total === 1 ? "" : "s"} across{" "}
            {bars.filter((b) => b.count > 0).length} active day
            {bars.filter((b) => b.count > 0).length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="flex items-end gap-[3px] h-16">
        {bars.map((bar) => {
          const h = bar.count === 0 ? 2 : Math.max(4, (bar.count / max) * 60)
          return (
            <div
              key={bar.date}
              title={`${bar.date}: ${bar.count} turn${bar.count === 1 ? "" : "s"}`}
              className="flex-1 flex items-end"
            >
              <div
                className={`w-full rounded-[2px] transition-colors ${
                  bar.isToday
                    ? "bg-emerald-500 ring-2 ring-emerald-500/30"
                    : bar.count === 0
                      ? "bg-muted-foreground/15"
                      : "bg-foreground/40 hover:bg-foreground/60"
                }`}
                style={{ height: `${h}px` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-1">
        <span>{bars[0].date.slice(5)}</span>
        <span>{bars[bars.length - 1].date.slice(5)}</span>
      </div>
    </div>
  )
}

/**
 * The hero card — "you're in this session right now." Large, visually
 * distinct, full of context so the user can orient in one glance.
 */
function CurrentSessionHero({
  session,
  topThreads,
  onOpen,
}: {
  session: OperatorSession
  topThreads: TopThread[]
  onOpen: () => void
}) {
  const label =
    session.label ??
    defaultSessionLabel(
      new Date(session.startedAt),
      new Date(session.endedAt)
    )
  const fulfilledSteps = 0 // Hero card doesn't load fulfillments yet.
  // The plan progress we CAN derive without fulfillments is just the
  // step count — the UI mostly matters when there IS a plan.

  return (
    <button
      onClick={onOpen}
      className="group relative w-full overflow-hidden rounded-2xl border-2 border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-card to-card p-6 text-left shadow-lg shadow-emerald-500/5 transition-all hover:border-emerald-500/60 hover:shadow-emerald-500/10"
    >
      {/* subtle corner accent */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="relative space-y-5">
        {/* Eyebrow */}
        <div className="flex items-center gap-2">
          <LivePill />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Current session
          </span>
        </div>

        {/* Label + time */}
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">{label}</h2>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Running for {formatDuration(session.startedAt)}
            </span>
            <span>started at {formatTime(session.startedAt)}</span>
          </div>
        </div>

        {/* Big stats */}
        <div className="flex gap-8">
          <Stat
            label="threads"
            value={session.threadCount.toString()}
            icon={<GitBranch className="h-3.5 w-3.5" />}
          />
          <Stat
            label="turns"
            value={session.messageCount.toLocaleString()}
            icon={<MessageSquare className="h-3.5 w-3.5" />}
          />
          {session.planSteps.length > 0 && (
            <Stat
              label="plan steps"
              value={`${fulfilledSteps} / ${session.planSteps.length}`}
              icon={<Target className="h-3.5 w-3.5" />}
            />
          )}
        </div>

        {/* Top threads teaser */}
        {topThreads.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Top threads in this session
            </p>
            <ul className="space-y-1">
              {topThreads.map((t) => (
                <li
                  key={t.threadId}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="text-muted-foreground/50">→</span>
                  <span className="truncate">
                    {t.title ?? "Untitled thread"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">
                    {t.messageCount} turn
                    {t.messageCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CTA */}
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300 pt-1">
          Jump in
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  )
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
    </div>
  )
}

/**
 * Compact row for a past session. Denser than the hero but still gives
 * the eye a foothold: label + time on the left, big turn number + top
 * thread teaser on the right.
 */
function PastSessionRow({
  session,
  topThreads,
  onOpen,
}: {
  session: OperatorSession
  topThreads: TopThread[]
  onOpen: () => void
}) {
  const label =
    session.label ??
    defaultSessionLabel(
      new Date(session.startedAt),
      new Date(session.endedAt)
    )
  const hasPlan = session.planSteps.length > 0
  const topThread = topThreads[0]

  return (
    <button
      onClick={onOpen}
      className="group w-full rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-left transition-all hover:border-border hover:bg-card hover:shadow-sm"
    >
      <div className="flex items-center gap-4">
        {/* Time column */}
        <div className="w-20 shrink-0 text-right">
          <div className="text-xs font-medium tabular-nums">
            {formatTime(session.startedAt)}
          </div>
          <div className="text-[10px] text-muted-foreground/70">
            {formatDuration(session.startedAt, session.endedAt)}
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-border/60 shrink-0" />

        {/* Main */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium group-hover:text-foreground">
              {label}
            </p>
            {hasPlan && (
              <Badge
                variant="outline"
                className="h-4 px-1.5 py-0 text-[9px] font-normal shrink-0"
              >
                <Target className="h-2.5 w-2.5 mr-0.5" />
                {session.planSteps.length}-step plan
              </Badge>
            )}
          </div>
          {topThread && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              <span className="text-muted-foreground/50">top:</span>{" "}
              {topThread.title ?? "Untitled thread"}
              {topThreads.length > 1 && (
                <span className="text-muted-foreground/50">
                  {" "}
                  + {topThreads.length - 1} more
                </span>
              )}
            </p>
          )}
        </div>

        {/* Stats column */}
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">
            {session.messageCount.toLocaleString()}
          </div>
          <div className="text-[10px] text-muted-foreground/70">
            turn{session.messageCount === 1 ? "" : "s"}
          </div>
        </div>

        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 transition-all group-hover:text-muted-foreground group-hover:translate-x-0.5" />
      </div>
    </button>
  )
}

// ─── HistoricalCallout: offer to import held-back historical sessions ─────

const SOURCE_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
}

/**
 * Callout shown when the silent sync found on-disk sessions for a
 * source the workspace has never imported before, and those sessions
 * are older than the 48h "recent activity" window. Lets the user
 * one-click import the full history for that source.
 */
function HistoricalCallout({
  counts,
  busyFor,
  onImport,
  onDismiss,
}: {
  counts: Record<string, number>
  busyFor: string | null
  onImport: (source: string) => Promise<void>
  onDismiss: () => void
}) {
  const sources = Object.keys(counts)
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Layers className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Found on-disk sessions we haven&apos;t imported yet
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Recent (last 48h) activity already synced. Historical
            conversations are held back so we don&apos;t surprise-import
            years of chats — click to opt in per source.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {sources.map((source) => {
              const label = SOURCE_LABELS[source] ?? source
              const n = counts[source]
              const busy = busyFor === source
              return (
                <Button
                  key={source}
                  size="sm"
                  variant="outline"
                  onClick={() => onImport(source)}
                  disabled={busy}
                  className="border-amber-500/40 text-xs hover:bg-amber-500/10"
                >
                  {busy ? (
                    "Importing…"
                  ) : (
                    <>
                      Import {n} historical {label} session
                      {n === 1 ? "" : "s"}
                    </>
                  )}
                </Button>
              )
            })}
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              className="text-xs text-muted-foreground"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
