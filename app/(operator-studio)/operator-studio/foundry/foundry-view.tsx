"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Activity,
  ArrowUpRight,
  Atom,
  Beaker,
  CircleDot,
  Crosshair,
  Dna,
  Flame,
  GaugeCircle,
  GitFork,
  Gavel,
  Hash,
  Layers,
  PieChart,
  Quote,
  Radar,
  Sparkles,
  Star,
  Sun,
  TerminalSquare,
  Trophy,
  Users,
  Zap,
} from "lucide-react"

import type { GoldCandidate } from "@/lib/operator-studio/gold-extractor"
import type { DecisionMoment } from "@/lib/operator-studio/decision-extractor"
import type { ThemeTerm } from "@/lib/operator-studio/theme-extractor"
import type { ConstellationGraph } from "@/lib/operator-studio/theme-graph"
import type {
  OperatorDashboardStats,
  OperatorSession,
} from "@/lib/operator-studio/types"
import { defaultSessionLabel } from "@/lib/operator-studio/sessions"
import { SessionCanvas } from "./session-canvas"

// ─── Types ─────────────────────────────────────────────────────────────────

interface DailyActivity {
  date: string
  messageCount: number
}

interface PromotionVelocity {
  date: string
  threadPromotions: number
  messagePromotions: number
  forks: number
}

interface SourceCount {
  sourceApp: string
  threadCount: number
  messageCount: number
}

interface FoundryEvent {
  kind: "imported" | "promoted" | "forked"
  at: string
  threadId: string
  threadTitle: string | null
  actor: string | null
}

interface TopThread {
  threadId: string
  title: string | null
  messageCount: number
}

interface CircadianCell {
  dow: number
  hour: number
  count: number
}

interface ActorRow {
  actor: string
  threadsImported: number
  threadsPromoted: number
  messagesPromoted: number
  score: number
}

interface HotThread {
  threadId: string
  title: string | null
  sourceApp: string
  recentMessages: number
  totalMessages: number
  lastMessageAt: string
}

interface ThreadGenome {
  threadId: string
  title: string | null
  sourceApp: string
  totalTurns: number
  turns: Array<{ role: string; length: number; promotedAt: string | null }>
}

interface BreakthroughStats {
  recentTurns: number
  recentInsights: number
  baselineTurns: number
  baselineInsights: number
  recentDensity: number
  baselineDensity: number
  deltaPercent: number
}

interface CanvasThreadMeta {
  id: string
  title: string | null
  sourceApp: string
  reviewState: string
  messageCount: number
  parentThreadId: string | null
  createdAt: string
}

interface CanvasBookend {
  id: string
  content: string
  turnIndex: number
  createdAt: string
}

interface CanvasThreadData {
  threadId: string
  firstUser: CanvasBookend | null
  firstAssistant: CanvasBookend | null
  lastUser: CanvasBookend | null
  lastAssistant: CanvasBookend | null
  signature: Array<{ role: string; length: number; turnIndex: number }>
}

interface FoundryViewProps {
  workspaceLabel: string
  stats: OperatorDashboardStats | null
  sessions: OperatorSession[]
  activity: DailyActivity[]
  promotionVelocity: PromotionVelocity[]
  sourceBreakdown: SourceCount[]
  events: FoundryEvent[]
  gold: GoldCandidate[]
  themes: ThemeTerm[]
  topThreads: Record<string, TopThread[]>
  circadian: CircadianCell[]
  topActors: ActorRow[]
  hotThreads: HotThread[]
  genomes: ThreadGenome[]
  decisions: DecisionMoment[]
  constellation: ConstellationGraph
  signalMix: Record<string, number>
  breakthrough: BreakthroughStats
  /** The session the canvas is rendering for — current live one if
   *  available, else the latest past session. Null when workspace has
   *  no sessions yet. */
  canvasSession: OperatorSession | null
  /** Thread metadata for the canvas, ordered by message count desc,
   *  capped to 8. */
  canvasThreads: CanvasThreadMeta[]
  /** Per-thread bookend messages + signature, aligned by threadId. */
  canvasData: CanvasThreadData[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function isCurrentSession(s: OperatorSession): boolean {
  return new Date(s.endedAt).getTime() >= Date.now() - 3 * 60 * 60 * 1000
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Math.max(0, Date.now() - then)
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// ─── Main view ─────────────────────────────────────────────────────────────

export function FoundryView({
  workspaceLabel,
  stats,
  sessions,
  activity,
  promotionVelocity,
  sourceBreakdown,
  events,
  gold,
  themes,
  topThreads,
  circadian,
  topActors,
  hotThreads,
  genomes,
  decisions,
  constellation,
  signalMix,
  breakthrough,
  canvasSession,
  canvasThreads,
  canvasData,
}: FoundryViewProps) {
  const [now, setNow] = React.useState<Date | null>(null)
  React.useEffect(() => {
    setNow(new Date())
    const t = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  const currentSession = sessions.find(isCurrentSession) ?? null

  // KPI numbers — surface the big six.
  const totals = React.useMemo(() => {
    const last7DaysActivity = activity
      .filter((d) => {
        const t = new Date(d.date).getTime()
        return t >= Date.now() - 7 * 24 * 60 * 60 * 1000
      })
      .reduce((s, d) => s + d.messageCount, 0)
    const totalMessages = activity.reduce((s, d) => s + d.messageCount, 0)
    const sessionsToday = sessions.filter((s) => {
      const t = new Date(s.startedAt).getTime()
      return t >= Date.now() - 24 * 60 * 60 * 1000
    }).length
    const promoted7d = promotionVelocity
      .filter(
        (p) => new Date(p.date).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000
      )
      .reduce(
        (s, p) =>
          s + p.threadPromotions + p.messagePromotions + p.forks,
        0
      )
    return {
      last7DaysActivity,
      totalMessages,
      sessionsToday,
      promoted7d,
    }
  }, [activity, sessions, promotionVelocity])

  return (
    <div className="min-h-screen bg-[#08090c] text-zinc-200 font-mono">
      <div className="mx-auto max-w-[1500px] px-6 py-5 space-y-5">
        {/* ── Status header ── */}
        <header className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">
              <Beaker className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
                  operator studio · skunk works
                </span>
                <span className="text-[10px] text-amber-500">●</span>
                <span className="text-[10px] uppercase tracking-[0.25em] text-amber-400">
                  the foundry
                </span>
              </div>
              <h1 className="text-lg font-semibold tracking-wide text-zinc-50">
                workspace · {workspaceLabel}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-zinc-500">
            <span className="flex items-center gap-1.5">
              <CircleDot className="h-2.5 w-2.5 text-emerald-500" />
              live
            </span>
            <span className="tabular-nums text-zinc-300">
              {now
                ? now.toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })
                : "—"}
            </span>
            <span className="tabular-nums text-zinc-500">
              {now
                ? now.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })
                : "—"}
            </span>
          </div>
        </header>

        {/* ── Session Canvas — hero visualization above the KPIs ── */}
        {canvasSession && canvasThreads.length > 0 && (
          <SessionCanvas
            session={canvasSession}
            threads={canvasThreads}
            data={canvasData}
          />
        )}

        {/* ── KPI strip ── */}
        <KpiStrip
          tiles={[
            {
              label: "turns · last 7d",
              value: totals.last7DaysActivity.toLocaleString(),
              icon: <Zap className="h-3 w-3" />,
              tone: "cyan",
            },
            {
              label: "sessions · 24h",
              value: totals.sessionsToday.toString(),
              icon: <Layers className="h-3 w-3" />,
              tone: "neutral",
            },
            {
              label: "promotions · 7d",
              value: totals.promoted7d.toString(),
              icon: <Star className="h-3 w-3" />,
              tone: "amber",
            },
            {
              label: "in review",
              value: (stats?.inReview ?? 0).toString(),
              icon: <Crosshair className="h-3 w-3" />,
              tone: "neutral",
            },
            {
              label: "promoted total",
              value: (stats?.promoted ?? 0).toString(),
              icon: <Flame className="h-3 w-3" />,
              tone: "emerald",
            },
            {
              label: "highlights",
              value: gold.length.toString(),
              icon: <Sparkles className="h-3 w-3" />,
              tone: "amber",
            },
          ]}
        />

        {/* ── Time spine ── */}
        <TimeSpine activity={activity} sessions={sessions} />

        {/* ── Session ribbon ── */}
        <Panel
          title="recent sessions · 30d"
          icon={<Layers className="h-3 w-3 text-cyan-400" />}
          subtitle="click a session to open it"
        >
          <SessionRibbon sessions={sessions} />
        </Panel>

        {/* ── Mosaic gallery ── */}
        {/*
          12-column grid; each panel sets its own col-span. Each tile
          is a distinct visualization — different mental model, different
          accent color, different aesthetic move. The layout mixes wide
          and narrow tiles to break the "uniform stats page" feeling.
        */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Breakthrough meter — small, top-left, attention-grabbing */}
          <div className="lg:col-span-3">
            <Panel
              title="insight rate"
              icon={<GaugeCircle className="h-3 w-3 text-amber-400" />}
              subtitle="last 24h vs 7-day average"
            >
              <BreakthroughMeter stats={breakthrough} />
            </Panel>
          </div>

          {/* Quote wall — wide, masonry of high-score gold */}
          <div className="lg:col-span-6">
            <Panel
              title="quote wall"
              icon={<Quote className="h-3 w-3 text-amber-400" />}
              subtitle={`top ${Math.min(gold.length, 6)} excerpts by score`}
            >
              <QuoteWall gold={gold.slice(0, 6)} />
            </Panel>
          </div>

          {/* Signal mix pie/bar */}
          <div className="lg:col-span-3">
            <Panel
              title="highlight types"
              icon={<PieChart className="h-3 w-3 text-amber-400" />}
              subtitle="breakdown by category"
            >
              <SignalMix mix={signalMix} />
            </Panel>
          </div>

          {/* Constellation — medium, the centerpiece visual */}
          <div className="lg:col-span-7">
            <Panel
              title="theme map"
              icon={<Atom className="h-3 w-3 text-cyan-400" />}
              subtitle={`${constellation.nodes.length} themes · ${constellation.edges.length} connections`}
            >
              <ConstellationGraphView graph={constellation} />
            </Panel>
          </div>

          {/* Decisions — medium */}
          <div className="lg:col-span-5">
            <Panel
              title="decisions log"
              icon={<Gavel className="h-3 w-3 text-emerald-400" />}
              subtitle={`${decisions.length} extracted decision moment${decisions.length === 1 ? "" : "s"}`}
            >
              <DecisionsLog decisions={decisions} />
            </Panel>
          </div>

          {/* Genome strip — full width, multiple thread DNAs stacked */}
          <div className="lg:col-span-12">
            <Panel
              title="thread shape"
              icon={<Dna className="h-3 w-3 text-violet-400" />}
              subtitle="per-turn structure of the workspace's largest threads"
            >
              <GenomeStrip genomes={genomes} />
            </Panel>
          </div>

          {/* Gold queue — taller column on the left */}
          <div className="lg:col-span-5 lg:row-span-2">
            <Panel
              title="highlight queue"
              icon={<Sparkles className="h-3 w-3 text-amber-400" />}
              subtitle={`${gold.length} candidate${gold.length === 1 ? "" : "s"} from last 14 days`}
            >
              <GoldQueue gold={gold} />
            </Panel>
          </div>

          {/* Themes flat list (companion to constellation) */}
          <div className="lg:col-span-4">
            <Panel
              title="top themes"
              icon={<Atom className="h-3 w-3 text-cyan-400" />}
              subtitle={`${themes.length} recurring terms`}
            >
              <ThemeConstellation themes={themes} />
            </Panel>
          </div>

          {/* Velocity */}
          <div className="lg:col-span-3">
            <Panel
              title="promotion velocity"
              icon={<Activity className="h-3 w-3 text-emerald-400" />}
              subtitle="rolling 30 days"
            >
              <PromotionVelocityChart velocity={promotionVelocity} />
            </Panel>
          </div>

          {/* Hot threads */}
          <div className="lg:col-span-4">
            <Panel
              title="hot threads · last hour"
              icon={<Flame className="h-3 w-3 text-rose-400" />}
              subtitle={
                hotThreads.length > 0
                  ? `${hotThreads.length} receiving turns now`
                  : "no activity in the last hour"
              }
            >
              <HotThreadsList hot={hotThreads} />
            </Panel>
          </div>

          {/* Current session */}
          <div className="lg:col-span-3">
            <Panel
              title="current session"
              icon={<Radar className="h-3 w-3 text-emerald-400" />}
              subtitle={currentSession ? "live · active" : "idle"}
            >
              <CurrentSessionPanel
                session={currentSession}
                topThreads={
                  currentSession ? topThreads[currentSession.id] ?? [] : []
                }
              />
            </Panel>
          </div>

          {/* Top actors */}
          <div className="lg:col-span-4">
            <Panel
              title="top actors · last 30d"
              icon={<Trophy className="h-3 w-3 text-amber-400" />}
              subtitle={`${topActors.length} contributor${topActors.length === 1 ? "" : "s"}`}
            >
              <ActorLeaderboard actors={topActors} />
            </Panel>
          </div>

          {/* Circadian */}
          <div className="lg:col-span-4">
            <Panel
              title="circadian · last 14d"
              icon={<Sun className="h-3 w-3 text-cyan-400" />}
              subtitle="when do you work?"
            >
              <CircadianHeatmap circadian={circadian} />
            </Panel>
          </div>

          {/* Live feed */}
          <div className="lg:col-span-4">
            <Panel
              title="live feed"
              icon={<TerminalSquare className="h-3 w-3 text-zinc-400" />}
              subtitle={`${events.length} most recent events`}
            >
              <LiveFeed events={events} />
            </Panel>
          </div>

          {/* Sources */}
          <div className="lg:col-span-12">
            <Panel
              title="sources"
              icon={<GitFork className="h-3 w-3 text-zinc-400" />}
              subtitle="thread origin distribution across the workspace"
            >
              <SourceBar sources={sourceBreakdown} />
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Panel chrome ──────────────────────────────────────────────────────────

function Panel({
  title,
  icon,
  subtitle,
  children,
}: {
  title: string
  icon?: React.ReactNode
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-sm border border-zinc-800/80 bg-zinc-950/40">
      <header className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-300">
            {title}
          </span>
        </div>
        {subtitle && (
          <span className="text-[9px] uppercase tracking-widest text-zinc-600">
            {subtitle}
          </span>
        )}
      </header>
      <div className="p-3">{children}</div>
    </section>
  )
}

// ─── KPI Strip ─────────────────────────────────────────────────────────────

const TONE_RING: Record<string, string> = {
  cyan: "ring-cyan-500/30",
  amber: "ring-amber-500/30",
  emerald: "ring-emerald-500/30",
  neutral: "ring-zinc-700",
}
const TONE_TEXT: Record<string, string> = {
  cyan: "text-cyan-400",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
  neutral: "text-zinc-400",
}

function KpiStrip({
  tiles,
}: {
  tiles: Array<{
    label: string
    value: string
    icon: React.ReactNode
    tone: string
  }>
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-zinc-800/60 rounded-sm overflow-hidden border border-zinc-800/80">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={`bg-[#0c0e13] px-3 py-2.5 ring-1 ring-inset ${
            TONE_RING[tile.tone] ?? "ring-zinc-800"
          }`}
        >
          <div
            className={`flex items-center gap-1 text-[9px] uppercase tracking-widest ${
              TONE_TEXT[tile.tone] ?? "text-zinc-500"
            }`}
          >
            {tile.icon}
            <span className="text-zinc-500">{tile.label}</span>
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-50">
            {tile.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Time Spine ────────────────────────────────────────────────────────────

function TimeSpine({
  activity,
  sessions,
}: {
  activity: DailyActivity[]
  sessions: OperatorSession[]
}) {
  // 90-day strip. For each day, total turns; below the bar we draw a
  // tiny session marker if any session started that day.
  const days = 90
  const now = new Date()
  const byDate = new Map<string, number>()
  for (const a of activity) byDate.set(a.date, a.messageCount)

  const bars: Array<{
    date: string
    count: number
    isToday: boolean
    sessionsCount: number
  }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const sessionsOnThisDay = sessions.filter((s) => {
      const sd = new Date(s.startedAt)
      return (
        sd.getFullYear() === d.getFullYear() &&
        sd.getMonth() === d.getMonth() &&
        sd.getDate() === d.getDate()
      )
    }).length
    bars.push({
      date: iso,
      count: byDate.get(iso) ?? 0,
      isToday: i === 0,
      sessionsCount: sessionsOnThisDay,
    })
  }

  const max = Math.max(1, ...bars.map((b) => b.count))
  const total = bars.reduce((s, b) => s + b.count, 0)
  const activeDays = bars.filter((b) => b.count > 0).length

  return (
    <Panel
      title="time spine · 90 days"
      icon={<Activity className="h-3 w-3 text-cyan-400" />}
      subtitle={`${total.toLocaleString()} turns · ${activeDays} active days · ${sessions.length} sessions`}
    >
      <div className="space-y-1">
        <div className="flex items-end gap-[2px] h-20">
          {bars.map((b) => {
            const h = b.count === 0 ? 2 : Math.max(3, (b.count / max) * 72)
            return (
              <div
                key={b.date}
                title={`${b.date}: ${b.count} turns · ${b.sessionsCount} session${b.sessionsCount === 1 ? "" : "s"}`}
                className="flex-1 flex items-end"
              >
                <div
                  className={`w-full ${
                    b.isToday
                      ? "bg-cyan-400 ring-1 ring-cyan-300/40"
                      : b.count === 0
                        ? "bg-zinc-800/40"
                        : "bg-zinc-500 hover:bg-zinc-300"
                  }`}
                  style={{ height: `${h}px` }}
                />
              </div>
            )
          })}
        </div>
        {/* Session tick row */}
        <div className="flex gap-[2px] h-1.5">
          {bars.map((b) => (
            <div
              key={b.date}
              className={`flex-1 ${
                b.sessionsCount > 0 ? "bg-amber-500/60" : "bg-transparent"
              }`}
            />
          ))}
        </div>
        <div className="flex justify-between text-[9px] uppercase tracking-widest text-zinc-600 pt-1">
          <span>{bars[0].date}</span>
          <span>{bars[bars.length - 1].date}</span>
        </div>
      </div>
    </Panel>
  )
}

// ─── Gold Queue ────────────────────────────────────────────────────────────

function GoldQueue({ gold }: { gold: GoldCandidate[] }) {
  const router = useRouter()

  if (gold.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic">
        Nothing surfaced yet — recent activity didn't match the patterns
        we look for (clear takeaways, decisions, or distinctive phrasing).
      </p>
    )
  }

  return (
    <ul className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
      {gold.map((c) => (
        <li
          key={c.messageId}
          className="group rounded-sm border border-zinc-800/60 bg-zinc-900/40 px-2.5 py-2 hover:border-amber-500/40 hover:bg-zinc-900/60 transition-colors cursor-pointer"
          onClick={() =>
            router.push(
              `/operator-studio/threads/${c.threadId}#msg-${c.messageId}`
            )
          }
        >
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest">
            <span className="text-amber-400">▶</span>
            <span className="text-amber-300/80">{c.topReason.label}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{c.role}</span>
            <span className="ml-auto tabular-nums text-zinc-500">
              score {c.score}
            </span>
            <ArrowUpRight className="h-2.5 w-2.5 text-zinc-600 group-hover:text-amber-400 transition-colors" />
          </div>
          <p className="mt-1 text-xs text-zinc-300 leading-relaxed line-clamp-3 font-sans">
            {c.excerpt}
          </p>
          <div className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600 truncate">
            from {c.threadTitle ?? "untitled"}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ─── Theme Constellation ───────────────────────────────────────────────────

function ThemeConstellation({ themes }: { themes: ThemeTerm[] }) {
  if (themes.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic">
        Not enough recurring vocabulary across the workspace yet.
      </p>
    )
  }
  const max = Math.max(...themes.map((t) => t.weight))
  const min = Math.min(...themes.map((t) => t.weight))
  const range = Math.max(1, max - min)

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-baseline max-h-[480px] overflow-y-auto pr-1">
      {themes.map((t) => {
        const n = (t.weight - min) / range
        const size =
          n > 0.7
            ? "text-base"
            : n > 0.45
              ? "text-sm"
              : n > 0.2
                ? "text-xs"
                : "text-[10px]"
        const opacity = 0.55 + n * 0.45
        return (
          <span
            key={t.term}
            title={`${t.messageHits} messages`}
            className={`${size} font-semibold tracking-tight text-cyan-300 font-sans`}
            style={{ opacity }}
          >
            {t.term}
            <span className="text-zinc-600 ml-0.5 text-[9px] tabular-nums">
              ·{t.messageHits}
            </span>
          </span>
        )
      })}
    </div>
  )
}

// ─── Promotion Velocity ────────────────────────────────────────────────────

function PromotionVelocityChart({
  velocity,
}: {
  velocity: PromotionVelocity[]
}) {
  // Fill 30 days of buckets so the bar chart is continuous.
  const days = 30
  const now = new Date()
  const byDate = new Map<string, PromotionVelocity>()
  for (const v of velocity) byDate.set(v.date, v)
  const buckets: PromotionVelocity[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    buckets.push(
      byDate.get(iso) ?? {
        date: iso,
        threadPromotions: 0,
        messagePromotions: 0,
        forks: 0,
      }
    )
  }
  const max = Math.max(
    1,
    ...buckets.map(
      (b) => b.threadPromotions + b.messagePromotions + b.forks
    )
  )
  const total = buckets.reduce(
    (s, b) => s + b.threadPromotions + b.messagePromotions + b.forks,
    0
  )

  // Empty-state guard. The "single tiny bar in a sea of nothing" looks
  // broken — say so plainly and prompt the user to start promoting.
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
        <Star className="h-5 w-5 text-zinc-700" />
        <p className="text-xs text-zinc-500 font-sans">
          No promotions yet across the workspace.
        </p>
        <p className="text-[10px] text-zinc-600 font-sans max-w-[28ch]">
          Open a session and promote a thread, message, or highlight
          — your velocity shows up here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-[2px] h-32">
        {buckets.map((b) => {
          const total = b.threadPromotions + b.messagePromotions + b.forks
          const totalH = total === 0 ? 1 : Math.max(3, (total / max) * 110)
          // Stacked: forks (bottom), thread promotions, message promotions
          const f = total === 0 ? 0 : (b.forks / total) * totalH
          const tp = total === 0 ? 0 : (b.threadPromotions / total) * totalH
          const mp = total === 0 ? 0 : (b.messagePromotions / total) * totalH
          return (
            <div
              key={b.date}
              title={`${b.date}: ${b.threadPromotions} thread / ${b.messagePromotions} msg / ${b.forks} fork`}
              className="flex-1 flex flex-col-reverse"
              style={{ height: 110 }}
            >
              {total === 0 ? (
                <div
                  className="w-full bg-zinc-800/40"
                  style={{ height: 1 }}
                />
              ) : (
                <>
                  <div
                    className="w-full bg-emerald-500"
                    style={{ height: tp }}
                  />
                  <div
                    className="w-full bg-amber-500"
                    style={{ height: mp }}
                  />
                  <div
                    className="w-full bg-cyan-500"
                    style={{ height: f }}
                  />
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-3 pt-1 text-[9px] uppercase tracking-widest text-zinc-500">
        <LegendDot color="bg-emerald-500" label="thread promotions" />
        <LegendDot color="bg-amber-500" label="message promotions" />
        <LegendDot color="bg-cyan-500" label="forks" />
        <span className="ml-auto tabular-nums text-zinc-400">
          {total} total · 30d
        </span>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 ${color}`} />
      {label}
    </span>
  )
}

// ─── Current Session ───────────────────────────────────────────────────────

function CurrentSessionPanel({
  session,
  topThreads,
}: {
  session: OperatorSession | null
  topThreads: TopThread[]
}) {
  const router = useRouter()

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Radar className="h-6 w-6 text-zinc-700 mb-2" />
        <p className="text-xs text-zinc-500">
          No session has had activity in the last 3 hours.
        </p>
        <p className="text-[10px] text-zinc-600 mt-1">
          When a new turn lands, this panel goes live.
        </p>
      </div>
    )
  }

  const start = new Date(session.startedAt)
  const runMin = Math.max(1, Math.round((Date.now() - start.getTime()) / 60000))
  const runLabel =
    runMin < 60
      ? `${runMin}m`
      : `${Math.floor(runMin / 60)}h ${runMin % 60}m`
  const label =
    session.label ??
    defaultSessionLabel(
      new Date(session.startedAt),
      new Date(session.endedAt)
    )

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          live · running for {runLabel}
        </div>
        <div className="mt-1 text-base font-semibold text-zinc-100 font-sans">
          {label}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px bg-zinc-800/60 rounded-sm overflow-hidden border border-zinc-800/80">
        <div className="bg-[#0c0e13] px-3 py-2">
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">
            threads
          </div>
          <div className="text-xl font-semibold tabular-nums text-zinc-100">
            {session.threadCount}
          </div>
        </div>
        <div className="bg-[#0c0e13] px-3 py-2">
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">
            turns
          </div>
          <div className="text-xl font-semibold tabular-nums text-zinc-100">
            {session.messageCount.toLocaleString()}
          </div>
        </div>
        <div className="bg-[#0c0e13] px-3 py-2">
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">
            plan steps
          </div>
          <div className="text-xl font-semibold tabular-nums text-zinc-100">
            {session.planSteps.length}
          </div>
        </div>
      </div>

      {topThreads.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-zinc-500">
            top threads
          </div>
          {topThreads.slice(0, 3).map((t) => (
            <button
              key={t.threadId}
              onClick={() =>
                router.push(`/operator-studio/threads/${t.threadId}`)
              }
              className="block w-full text-left text-xs text-zinc-300 hover:text-cyan-300 transition-colors truncate font-sans"
            >
              <span className="text-zinc-600">→</span>{" "}
              {t.title ?? "Untitled thread"}{" "}
              <span className="text-zinc-600 text-[10px] tabular-nums">
                ({t.messageCount})
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={() => router.push(`/operator-studio/sessions/${session.id}`)}
        className="w-full mt-1 rounded-sm border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/10 transition-colors"
      >
        open session →
      </button>
    </div>
  )
}

// ─── Live Feed ─────────────────────────────────────────────────────────────

const EVENT_META: Record<
  FoundryEvent["kind"],
  { label: string; icon: React.ReactNode; color: string }
> = {
  imported: {
    label: "ingest",
    icon: <ArrowUpRight className="h-2.5 w-2.5" />,
    color: "text-cyan-400",
  },
  promoted: {
    label: "promo",
    icon: <Star className="h-2.5 w-2.5" />,
    color: "text-amber-400",
  },
  forked: {
    label: "fork",
    icon: <GitFork className="h-2.5 w-2.5" />,
    color: "text-emerald-400",
  },
}

/**
 * Collapse consecutive events that share (kind, normalized title
 * prefix) — multiple ingests of the kickoff thread (or repeat
 * promotions of the same thread) collapse to a single row with a
 * "+N more" tail. Without this collapse the feed becomes a wall of
 * "INGEST # Kickoff prompt — open-source treatment for Operator
 * Studio" repeated 8 times in a row.
 */
function collapseEvents(
  events: FoundryEvent[]
): Array<FoundryEvent & { dupes: number }> {
  const out: Array<FoundryEvent & { dupes: number }> = []
  for (const e of events) {
    const titlePrefix = (e.threadTitle ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40)
      .toLowerCase()
    const last = out[out.length - 1]
    if (
      last &&
      last.kind === e.kind &&
      (last.threadTitle ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40)
        .toLowerCase() === titlePrefix
    ) {
      last.dupes++
      // Show the EARLIEST event in the collapsed row (oldest), so the
      // ts shows when the streak began.
      // (Events are newest-first from the API, so we keep the first
      // one we saw.)
      continue
    }
    out.push({ ...e, dupes: 1 })
  }
  return out
}

function LiveFeed({ events }: { events: FoundryEvent[] }) {
  const router = useRouter()
  const collapsed = React.useMemo(() => collapseEvents(events), [events])

  if (collapsed.length === 0) {
    return <p className="text-xs text-zinc-600 italic">No events yet.</p>
  }
  return (
    <ul className="space-y-0.5 max-h-[360px] overflow-y-auto pr-1 text-xs">
      {collapsed.map((e, i) => {
        const meta = EVENT_META[e.kind]
        return (
          <li
            key={`${e.kind}-${e.threadId}-${i}`}
            onClick={() =>
              router.push(`/operator-studio/threads/${e.threadId}`)
            }
            className="group flex items-center gap-2 px-1.5 py-1 rounded-sm hover:bg-zinc-900/60 cursor-pointer"
          >
            <span className="text-[9px] tabular-nums text-zinc-600 w-12 shrink-0">
              {formatRelative(e.at).replace(" ago", "")}
            </span>
            <span
              className={`flex items-center gap-0.5 text-[9px] uppercase tracking-widest w-12 shrink-0 ${meta.color}`}
            >
              {meta.icon}
              {meta.label}
            </span>
            <span className="flex-1 truncate text-zinc-300 group-hover:text-zinc-100 transition-colors font-sans">
              {e.threadTitle ?? "Untitled thread"}
              {e.dupes > 1 && (
                <span className="ml-1.5 text-[9px] text-zinc-600 tabular-nums">
                  ×{e.dupes}
                </span>
              )}
            </span>
            {e.actor && (
              <span className="text-[9px] text-zinc-600 shrink-0">
                {e.actor}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── Source Bar ────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  claude: "bg-cyan-500",
  "claude-code": "bg-cyan-500",
  opencode: "bg-violet-500",
  codex: "bg-amber-500",
  chatgpt: "bg-emerald-500",
  openai: "bg-emerald-500",
  gemini: "bg-violet-500",
  cursor: "bg-rose-500",
  manual: "bg-zinc-500",
  webhook: "bg-zinc-500",
}

function SourceBar({ sources }: { sources: SourceCount[] }) {
  if (sources.length === 0) {
    return <p className="text-xs text-zinc-600 italic">No sources yet.</p>
  }
  const total = sources.reduce((s, c) => s + c.messageCount, 0)
  return (
    <div className="space-y-2">
      <div className="flex h-2 rounded-sm overflow-hidden bg-zinc-800/40">
        {sources.map((s) => {
          const w = total === 0 ? 0 : (s.messageCount / total) * 100
          return (
            <div
              key={s.sourceApp}
              title={`${s.sourceApp}: ${s.messageCount.toLocaleString()} turns across ${s.threadCount} threads`}
              className={`${SOURCE_COLORS[s.sourceApp] ?? "bg-zinc-500"} transition-all`}
              style={{ width: `${w}%` }}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] uppercase tracking-widest text-zinc-500">
        {sources.map((s) => (
          <span key={s.sourceApp} className="flex items-center gap-1">
            <span
              className={`h-1.5 w-1.5 ${SOURCE_COLORS[s.sourceApp] ?? "bg-zinc-500"}`}
            />
            <span className="text-zinc-300">{s.sourceApp}</span>
            <span className="tabular-nums text-zinc-500">
              {s.threadCount}t · {s.messageCount.toLocaleString()}m
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Hot Threads ───────────────────────────────────────────────────────────

function HotThreadsList({ hot }: { hot: HotThread[] }) {
  const router = useRouter()
  if (hot.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
        <Flame className="h-5 w-5 text-zinc-700" />
        <p className="text-xs text-zinc-500 font-sans">
          No threads have received turns in the last hour.
        </p>
      </div>
    )
  }
  const max = Math.max(...hot.map((h) => h.recentMessages))
  return (
    <ul className="space-y-1.5">
      {hot.map((h) => {
        const w = (h.recentMessages / max) * 100
        return (
          <li
            key={h.threadId}
            onClick={() =>
              router.push(`/operator-studio/threads/${h.threadId}`)
            }
            className="group cursor-pointer rounded-sm border border-zinc-800/60 bg-zinc-900/30 px-2.5 py-1.5 hover:border-rose-500/40 hover:bg-zinc-900/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-xs text-zinc-200 font-sans group-hover:text-rose-300 transition-colors">
                {h.title ?? "Untitled thread"}
              </span>
              <span className="text-[9px] tabular-nums text-zinc-500 shrink-0">
                +{h.recentMessages}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1 h-1 bg-zinc-800/60 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-rose-500/70"
                  style={{ width: `${w}%` }}
                />
              </div>
              <span className="text-[9px] uppercase tracking-widest text-zinc-600 shrink-0">
                {h.sourceApp}
              </span>
              <span className="text-[9px] text-zinc-600 shrink-0 tabular-nums">
                {formatRelative(h.lastMessageAt).replace(" ago", "")}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ─── Actor Leaderboard ─────────────────────────────────────────────────────

function ActorLeaderboard({ actors }: { actors: ActorRow[] }) {
  if (actors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
        <Users className="h-5 w-5 text-zinc-700" />
        <p className="text-xs text-zinc-500 font-sans">
          No tracked contributors in the last 30 days.
        </p>
      </div>
    )
  }
  const maxScore = Math.max(...actors.map((a) => a.score))
  return (
    <ol className="space-y-1.5">
      {actors.map((a, i) => {
        const w = (a.score / maxScore) * 100
        return (
          <li
            key={a.actor}
            className="group rounded-sm bg-zinc-900/30 px-2 py-1.5"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="w-4 shrink-0 text-[10px] font-mono text-zinc-600 tabular-nums">
                #{i + 1}
              </span>
              <span className="flex-1 truncate font-sans text-zinc-200">
                {a.actor}
              </span>
              <span className="tabular-nums text-zinc-400">{a.score}</span>
            </div>
            <div className="mt-1 ml-6 flex items-center gap-2">
              <div className="flex-1 h-1 bg-zinc-800/60 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-amber-500/70"
                  style={{ width: `${w}%` }}
                />
              </div>
              <span
                className="text-[9px] text-zinc-600 shrink-0"
                title={`${a.threadsImported} imported · ${a.threadsPromoted} thread promos · ${a.messagesPromoted} message promos`}
              >
                <Hash className="inline h-2 w-2 mr-0.5" />
                {a.threadsImported}i · {a.threadsPromoted}p · {a.messagesPromoted}m
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ─── Circadian Heatmap ─────────────────────────────────────────────────────

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"]
const DOW_FROM_PG = [0, 1, 2, 3, 4, 5, 6] // Postgres EXTRACT(DOW) is 0=Sun..6=Sat

function CircadianHeatmap({ circadian }: { circadian: CircadianCell[] }) {
  // Build a 7×24 grid (rows = day-of-week, cols = hour-of-day),
  // initialized to 0. Highlights peak cell + draws a tiny scale at
  // the bottom.
  const grid: number[][] = Array.from({ length: 7 }, () =>
    new Array(24).fill(0)
  )
  for (const c of circadian) {
    if (c.dow >= 0 && c.dow <= 6 && c.hour >= 0 && c.hour <= 23) {
      grid[c.dow][c.hour] = c.count
    }
  }
  const allCells = grid.flat()
  const max = Math.max(1, ...allCells)
  const total = allCells.reduce((s, n) => s + n, 0)
  // Find peak hour for the narrative caption.
  let peakDow = 0
  let peakHour = 0
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (grid[d][h] > grid[peakDow][peakHour]) {
        peakDow = d
        peakHour = h
      }
    }
  }
  const peakLabel =
    total === 0
      ? null
      : `${DOW_LABELS[peakDow]} · ${peakHour.toString().padStart(2, "0")}:00`

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-6 space-y-2">
        <Sun className="h-5 w-5 text-zinc-700" />
        <p className="text-xs text-zinc-500 font-sans">
          No activity in the last 14 days.
        </p>
      </div>
    )
  }

  function cellColor(n: number): string {
    if (n === 0) return "bg-zinc-900/40"
    const intensity = n / max
    if (intensity > 0.75) return "bg-cyan-400"
    if (intensity > 0.5) return "bg-cyan-500/80"
    if (intensity > 0.25) return "bg-cyan-500/50"
    return "bg-cyan-500/25"
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="grid grid-cols-[14px_repeat(24,minmax(0,1fr))] gap-[2px]">
          {/* Header row: hour ticks */}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={`h-${h}`}
              className="text-[7px] text-center tabular-nums text-zinc-700"
            >
              {h % 6 === 0 ? h : ""}
            </div>
          ))}
          {/* Data rows */}
          {DOW_FROM_PG.map((d) => (
            <React.Fragment key={`row-${d}`}>
              <div className="text-[8px] text-zinc-600 text-right pr-1 tabular-nums">
                {DOW_LABELS[d]}
              </div>
              {Array.from({ length: 24 }, (_, h) => (
                <div
                  key={`c-${d}-${h}`}
                  title={`${DOW_LABELS[d]} ${h}:00 — ${grid[d][h]} turn${grid[d][h] === 1 ? "" : "s"}`}
                  className={`h-2.5 rounded-[1px] ${cellColor(grid[d][h])}`}
                />
              ))}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-zinc-600">
        <span>{total.toLocaleString()} turns · 14d</span>
        {peakLabel && (
          <span>
            peak <span className="text-cyan-400">{peakLabel}</span>
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Menagerie placeholders ─────────────────────────────────────────────────
// Lightweight stubs for the in-progress menagerie panels so the Foundry
// page builds and the canvas is visible. Each is styled enough to look
// intentional in place but trivial to replace with a fuller
// implementation — they read their props and render minimal but honest
// representations of the data.

function BreakthroughMeter({ stats }: { stats: BreakthroughStats }) {
  const delta = stats.deltaPercent
  const isUp = delta > 10
  const isDown = delta < -10
  const tone = isUp
    ? "text-amber-400"
    : isDown
      ? "text-zinc-500"
      : "text-zinc-300"
  const arrow = isUp ? "▲" : isDown ? "▼" : "—"
  const summary = isUp
    ? "heavy-thinking spike"
    : isDown
      ? "calmer than baseline"
      : "tracking baseline"
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2">
        <span className={`text-3xl font-bold tabular-nums ${tone}`}>
          {arrow} {Math.abs(delta)}%
        </span>
      </div>
      <p className="text-[9px] uppercase tracking-widest text-zinc-500">
        {summary}
      </p>
      <div className="space-y-1.5 text-[10px]">
        <div className="flex items-center justify-between text-zinc-400">
          <span>last 24h</span>
          <span className="tabular-nums text-zinc-300">
            {stats.recentInsights}/{stats.recentTurns}
          </span>
        </div>
        <div className="h-1 bg-zinc-800/60 rounded-sm overflow-hidden">
          <div
            className="h-full bg-amber-500/70"
            style={{ width: `${Math.min(100, stats.recentDensity * 1000)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-zinc-500">
          <span>7d baseline</span>
          <span className="tabular-nums text-zinc-500">
            {stats.baselineInsights}/{stats.baselineTurns}
          </span>
        </div>
        <div className="h-1 bg-zinc-800/60 rounded-sm overflow-hidden">
          <div
            className="h-full bg-zinc-600"
            style={{
              width: `${Math.min(100, stats.baselineDensity * 1000)}%`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

function QuoteWall({ gold }: { gold: GoldCandidate[] }) {
  const router = useRouter()
  if (gold.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic">No gold to quote yet.</p>
    )
  }
  // Cycling palette so the wall feels alive, not uniform.
  const accents = [
    "border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-transparent",
    "border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-transparent",
    "border-emerald-500/25 bg-gradient-to-br from-emerald-500/8 to-transparent",
    "border-rose-500/25 bg-gradient-to-br from-rose-500/8 to-transparent",
    "border-violet-500/25 bg-gradient-to-br from-violet-500/8 to-transparent",
  ]
  return (
    <div className="columns-1 md:columns-2 gap-2.5 [&>*]:break-inside-avoid">
      {gold.map((g, i) => (
        <div
          key={g.messageId}
          onClick={() =>
            router.push(
              `/operator-studio/threads/${g.threadId}#msg-${g.messageId}`
            )
          }
          className={`mb-2.5 cursor-pointer rounded-sm border ${accents[i % accents.length]} px-3 py-2 hover:shadow-md hover:shadow-amber-500/5 transition-shadow`}
        >
          <div className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-amber-300/80">
            <Quote className="h-2.5 w-2.5" />
            {g.topReason.label}
          </div>
          <p className="mt-1.5 text-xs text-zinc-200 leading-relaxed line-clamp-6 font-sans">
            {g.excerpt}
          </p>
          <p className="mt-2 text-[8px] uppercase tracking-widest text-zinc-600 truncate">
            {g.role} · {g.threadTitle ?? "untitled"}
          </p>
        </div>
      ))}
    </div>
  )
}

const SIGNAL_LABEL: Record<string, string> = {
  tldr: "TLDR",
  "insight-callout": "insight",
  "emphatic-claim": "emphatic",
  "structured-analysis": "structured",
  "substantive-analysis": "substantive",
  "code-and-explain": "code+explain",
  "numbered-synthesis": "numbered",
  "opening-framing": "opening",
  "substantive-question": "user-frame",
  conclusion: "conclusion",
  "next-action": "next",
  "quoted-reference": "quote",
}

const SIGNAL_COLOR: Record<string, string> = {
  tldr: "bg-amber-500",
  "insight-callout": "bg-amber-400",
  "emphatic-claim": "bg-rose-400",
  "structured-analysis": "bg-cyan-400",
  "substantive-analysis": "bg-cyan-500",
  "code-and-explain": "bg-emerald-400",
  "numbered-synthesis": "bg-emerald-500",
  "opening-framing": "bg-violet-400",
  "substantive-question": "bg-violet-500",
  conclusion: "bg-zinc-400",
  "next-action": "bg-zinc-500",
  "quoted-reference": "bg-zinc-600",
}

function SignalMix({ mix }: { mix: Record<string, number> }) {
  const entries = Object.entries(mix).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total === 0) {
    return <p className="text-xs text-zinc-600 italic">No signals yet.</p>
  }
  return (
    <div className="space-y-2">
      {/* Stacked horizontal "spectrum" bar — tells you the mix at one glance */}
      <div className="flex h-3 rounded-sm overflow-hidden bg-zinc-800/40 ring-1 ring-zinc-800">
        {entries.map(([k, n]) => (
          <div
            key={k}
            title={`${SIGNAL_LABEL[k] ?? k}: ${n}`}
            className={SIGNAL_COLOR[k] ?? "bg-zinc-500"}
            style={{ width: `${(n / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="space-y-0.5 text-[10px]">
        {entries.slice(0, 8).map(([kind, n]) => {
          const pct = Math.round((n / total) * 100)
          return (
            <li key={kind} className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 ${SIGNAL_COLOR[kind] ?? "bg-zinc-500"}`}
              />
              <span className="text-zinc-400 lowercase font-sans">
                {SIGNAL_LABEL[kind] ?? kind}
              </span>
              <span className="ml-auto tabular-nums text-zinc-500">
                {n} · {pct}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ConstellationGraphView({ graph }: { graph: ConstellationGraph }) {
  if (graph.nodes.length === 0) {
    return <p className="text-xs text-zinc-600 italic">No constellation yet.</p>
  }
  // buildConstellation returns positions in [0,1] × [0,1]; scale to
  // a viewBox for sharp SVG rendering.
  const VB = 600
  const pad = 30
  const maxWeight = Math.max(...graph.nodes.map((n) => n.weight))
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        className="w-full h-[320px]"
        preserveAspectRatio="xMidYMid meet"
      >
        {graph.edges.map((e, i) => {
          const a = graph.nodes.find((n) => n.term === e.a)
          const b = graph.nodes.find((n) => n.term === e.b)
          if (!a || !b) return null
          return (
            <line
              key={i}
              x1={pad + a.x * (VB - pad * 2)}
              y1={pad + a.y * (VB - pad * 2)}
              x2={pad + b.x * (VB - pad * 2)}
              y2={pad + b.y * (VB - pad * 2)}
              stroke="rgba(6, 182, 212, 0.18)"
              strokeWidth={Math.max(0.5, Math.min(2.5, e.weight / 3))}
            />
          )
        })}
        {graph.nodes.map((n) => {
          const r = 3 + (n.weight / maxWeight) * 10
          const cx = pad + n.x * (VB - pad * 2)
          const cy = pad + n.y * (VB - pad * 2)
          return (
            <g key={n.term}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="rgba(6, 182, 212, 0.4)"
                stroke="rgba(6, 182, 212, 0.8)"
                strokeWidth={1}
              />
              <text
                x={cx}
                y={cy - r - 3}
                fontSize={10}
                fill="rgba(203, 213, 225, 0.9)"
                textAnchor="middle"
                className="font-sans"
              >
                {n.term}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function DecisionsLog({ decisions }: { decisions: DecisionMoment[] }) {
  const router = useRouter()
  if (decisions.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic">
        No decisions detected yet — looking for phrasings like "decision:",
        "let's go with…", or "the call is…".
      </p>
    )
  }
  return (
    <ul className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
      {decisions.map((d) => (
        <li
          key={d.messageId}
          onClick={() =>
            router.push(
              `/operator-studio/threads/${d.threadId}#msg-${d.messageId}`
            )
          }
          className="group cursor-pointer rounded-sm border border-emerald-500/20 bg-gradient-to-r from-emerald-500/[0.04] to-transparent px-2.5 py-2 hover:border-emerald-500/40 hover:from-emerald-500/[0.08] transition-colors"
        >
          <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest">
            <Gavel className="h-2.5 w-2.5 text-emerald-400" />
            <span className="text-emerald-300">{d.trigger}</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-500">{d.role}</span>
            <span className="ml-auto tabular-nums text-zinc-600">
              w{d.weight}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-200 leading-relaxed line-clamp-3 font-sans group-hover:text-zinc-100 transition-colors">
            {d.excerpt}
          </p>
          {d.threadTitle && (
            <p className="mt-1 text-[9px] uppercase tracking-widest text-zinc-600 truncate">
              from {d.threadTitle}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

// ─── Session Ribbon ────────────────────────────────────────────────────────

/**
 * Horizontal time-axis ribbon of all sessions over the visible range.
 * Each session is a colored block whose width is proportional to its
 * duration, height is proportional to its message count. Plan-step
 * dots underneath show how many sessions had a sketched plan.
 *
 * Distinct mental model from the time spine: spine is "activity per
 * day," ribbon is "sessions as discrete chunks of work."
 */
function SessionRibbon({ sessions }: { sessions: OperatorSession[] }) {
  const router = useRouter()
  if (sessions.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic font-sans">
        No sessions yet.
      </p>
    )
  }
  // Bound the view to the last 30 days for visual density.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const visible = sessions.filter(
    (s) => new Date(s.endedAt).getTime() >= cutoff
  )
  if (visible.length === 0) {
    return (
      <p className="text-xs text-zinc-600 italic font-sans">
        No sessions in the last 30 days.
      </p>
    )
  }
  const minStart = Math.min(...visible.map((s) => new Date(s.startedAt).getTime()))
  const maxEnd = Math.max(...visible.map((s) => new Date(s.endedAt).getTime()))
  const span = Math.max(1, maxEnd - minStart)
  const maxMsg = Math.max(...visible.map((s) => s.messageCount), 1)
  const now = Date.now()

  return (
    <div className="space-y-2">
      <div className="relative h-12 w-full bg-zinc-900/40 border border-zinc-800/60 rounded-sm overflow-hidden">
        {/* Day grid lines, faint */}
        {Array.from({ length: 31 }, (_, i) => {
          const t = maxEnd - i * 24 * 60 * 60 * 1000
          if (t < minStart) return null
          const left = ((t - minStart) / span) * 100
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-zinc-800/50"
              style={{ left: `${left}%` }}
            />
          )
        })}
        {/* Session blocks */}
        {visible.map((s) => {
          const start = new Date(s.startedAt).getTime()
          const end = new Date(s.endedAt).getTime()
          const left = ((start - minStart) / span) * 100
          const w = Math.max(0.5, ((end - start) / span) * 100)
          const intensity = s.messageCount / maxMsg
          const isLive =
            new Date(s.endedAt).getTime() >= now - 3 * 60 * 60 * 1000
          const tone = isLive
            ? "bg-emerald-500"
            : s.planSteps.length > 0
              ? "bg-amber-500"
              : "bg-cyan-600"
          return (
            <button
              key={s.id}
              onClick={() => router.push(`/operator-studio/sessions/${s.id}`)}
              title={`${s.label ?? "session"} · ${s.messageCount} turns · ${s.planSteps.length}-step plan`}
              className={`absolute top-1 bottom-1 ${tone} rounded-sm hover:brightness-150 transition-all`}
              style={{
                left: `${left}%`,
                width: `${w}%`,
                opacity: 0.35 + intensity * 0.65,
              }}
            />
          )
        })}
        {/* Now line */}
        <div
          className="absolute top-0 bottom-0 w-px bg-rose-400 ring-1 ring-rose-400/30"
          style={{ left: `${((now - minStart) / span) * 100}%` }}
        />
      </div>
      <div className="flex items-center gap-3 text-[9px] uppercase tracking-widest text-zinc-600">
        <LegendDot color="bg-emerald-500" label="live" />
        <LegendDot color="bg-amber-500" label="has plan" />
        <LegendDot color="bg-cyan-600" label="open" />
        <span className="ml-auto tabular-nums text-zinc-500">
          {visible.length} sessions · 30d
        </span>
      </div>
    </div>
  )
}

function GenomeStrip({ genomes }: { genomes: ThreadGenome[] }) {
  if (genomes.length === 0) {
    return <p className="text-xs text-zinc-600 italic">No genomes yet.</p>
  }
  return (
    <div className="space-y-2">
      {genomes.map((g) => {
        const max = Math.max(
          1,
          ...g.turns.map((t) => Math.log2((t.length || 1) + 1))
        )
        return (
          <div key={g.threadId}>
            <div className="flex items-center justify-between text-[10px]">
              <span className="truncate font-sans text-zinc-300">
                {g.title ?? "Untitled"}
              </span>
              <span className="tabular-nums text-zinc-600">
                {g.totalTurns.toLocaleString()} turns
              </span>
            </div>
            <div className="mt-1 flex items-end gap-[1px] h-6">
              {g.turns.map((t, i) => {
                const mag = Math.log2((t.length || 1) + 1)
                const h = Math.max(2, (mag / max) * 22)
                const isUser = t.role === "user"
                const isPromoted = !!t.promotedAt
                return (
                  <div
                    key={i}
                    className={`w-full rounded-[1px] ${
                      isPromoted
                        ? "bg-emerald-400"
                        : isUser
                          ? "bg-cyan-400/70"
                          : "bg-violet-400/70"
                    }`}
                    style={{ height: `${h}px` }}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
