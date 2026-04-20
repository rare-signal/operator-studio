"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Activity,
  BarChart3,
  Loader2,
  MessageSquare,
  Users,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { cn } from "@/lib/utils"

import { SourceAppToken } from "../components/source-apps"

// ─── Response shape (mirrors the API route) ─────────────────────────────────

interface MetricsSummary {
  totalThreads: number
  threadsByState: {
    imported: number
    inReview: number
    promoted: number
    archived: number
  }
  threadsBySource: Array<{ sourceApp: string; count: number }>
  promotedMessageCount: number
  continuationChatSessions: number
  continuationChatMessages: number
  uniqueImportersCount: number
  uniquePromotersCount: number
}

interface DailyCounts {
  date: string
  imported: number
  promoted: number
}

interface TopAuthor {
  displayName: string
  imported: number
  promoted: number
}

interface MetricsResponse {
  summary: MetricsSummary
  daily: DailyCounts[]
  topAuthors: TopAuthor[]
  topTags: Array<{ tag: string; count: number }>
  workspace: { id: string; label: string }
  rangeDays: number
}

// ─── Range selector ─────────────────────────────────────────────────────────

const RANGES: Array<{ value: 30 | 90 | 365; label: string }> = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
]

function parseRange(raw: string | null): 30 | 90 | 365 {
  const n = Number(raw)
  if (n === 90) return 90
  if (n === 365) return 365
  return 30
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MetricsContent() {
  const router = useRouter()
  const params = useSearchParams()
  const range = parseRange(params.get("q"))

  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<MetricsResponse | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/operator-studio/metrics?days=${range}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<MetricsResponse>
      })
      .then((body) => {
        setData(body)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return
        setError((e as Error).message || "Failed to load metrics")
        setLoading(false)
      })

    return () => controller.abort()
  }, [range])

  const handleRangeChange = (next: 30 | 90 | 365) => {
    const qs = new URLSearchParams(params.toString())
    qs.set("q", String(next))
    router.replace(`/operator-studio/metrics?${qs.toString()}`)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <BarChart3 className="size-4" />
          <span className="text-xs uppercase tracking-wider">Metrics</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              Workspace activity
            </h1>
            <p className="text-sm text-foreground/80">
              First-90-days rollout metrics for{" "}
              <span className="font-medium text-foreground">
                {data?.workspace.label ?? "this workspace"}
              </span>
              . Imports, promotions, tags, authors, and continuation chat.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-1">
            {RANGES.map((r) => (
              <Button
                key={r.value}
                size="sm"
                variant={r.value === range ? "default" : "ghost"}
                className={cn(
                  "h-7 px-3 text-xs",
                  r.value === range
                    ? ""
                    : "text-foreground/80 hover:text-foreground"
                )}
                onClick={() => handleRangeChange(r.value)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        </div>
      </header>

      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading metrics…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
          <p className="font-medium">Couldn&apos;t load metrics.</p>
          <p className="mt-1 text-foreground/80">{error}</p>
        </div>
      )}

      {data && (
        <div className={cn("flex flex-col gap-10", loading && "opacity-70")}>
          <SummaryStrip summary={data.summary} />

          <Separator />

          <DailyChart daily={data.daily} rangeDays={data.rangeDays} />

          <Separator />

          <div className="grid gap-10 md:grid-cols-2">
            <TopAuthorsTable authors={data.topAuthors} />
            <TopTagsCloud tags={data.topTags} />
          </div>

          <Separator />

          <BySourceBars sources={data.summary.threadsBySource} />

          <Separator />

          <ContinuationActivity
            sessions={data.summary.continuationChatSessions}
            messages={data.summary.continuationChatMessages}
          />
        </div>
      )}
    </div>
  )
}

// ─── Summary strip ──────────────────────────────────────────────────────────

function SummaryStrip({ summary }: { summary: MetricsSummary }) {
  const tiles: Array<{ label: string; value: number; hint?: string }> = [
    { label: "Total", value: summary.totalThreads, hint: "visible threads" },
    { label: "Promoted", value: summary.threadsByState.promoted },
    { label: "In review", value: summary.threadsByState.inReview },
    { label: "Imported", value: summary.threadsByState.imported },
    { label: "Archived", value: summary.threadsByState.archived },
  ]

  return (
    <section>
      <SectionHeading label="Summary" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <Card key={t.label} className="border-border/60 shadow-none">
            <CardHeader className="pb-1">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="text-2xl font-semibold tabular-nums text-foreground">
                {t.value.toLocaleString()}
              </div>
              {t.hint && (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.hint}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}

// ─── Daily chart (pure SVG) ─────────────────────────────────────────────────

function DailyChart({
  daily,
  rangeDays,
}: {
  daily: DailyCounts[]
  rangeDays: number
}) {
  const hasAny = daily.some((d) => d.imported > 0 || d.promoted > 0)
  const peak = daily.reduce(
    (m, d) => Math.max(m, d.imported + d.promoted),
    0
  )
  const totalImported = daily.reduce((s, d) => s + d.imported, 0)
  const totalPromoted = daily.reduce((s, d) => s + d.promoted, 0)

  // Chart dimensions
  const barCount = daily.length
  const gap = barCount > 90 ? 1 : 2
  const barWidth = 100 / barCount // percent width per column including gap

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading
          label={`Daily activity — last ${rangeDays} days`}
          inline
        />
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <LegendDot className="bg-foreground/70" label="imported" />
          <LegendDot className="bg-emerald-500" label="promoted" />
        </div>
      </div>

      {!hasAny ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No activity in this range yet.
        </p>
      ) : (
        <>
          <div className="mt-4 flex h-40 items-end gap-[1px] rounded-md border bg-muted/20 p-2">
            {daily.map((d) => {
              const total = d.imported + d.promoted
              const totalPct = peak === 0 ? 0 : (total / peak) * 100
              const importedPct =
                total === 0 ? 0 : (d.imported / total) * totalPct
              const promotedPct =
                total === 0 ? 0 : (d.promoted / total) * totalPct
              return (
                <div
                  key={d.date}
                  className="relative flex h-full flex-1 flex-col justify-end"
                  style={{
                    minWidth: 0,
                    marginRight: gap,
                    maxWidth: `${barWidth}%`,
                  }}
                  title={`${d.date}: ${d.imported} imported, ${d.promoted} promoted`}
                >
                  <div
                    className="w-full bg-emerald-500"
                    style={{ height: `${promotedPct}%` }}
                  />
                  <div
                    className="w-full bg-foreground/70"
                    style={{ height: `${importedPct}%` }}
                  />
                </div>
              )
            })}
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span className="tabular-nums">
              {daily[0]?.date ?? ""}
            </span>
            <span className="tabular-nums">
              {totalImported.toLocaleString()} imported ·{" "}
              {totalPromoted.toLocaleString()} promoted
            </span>
            <span className="tabular-nums">
              {daily[daily.length - 1]?.date ?? ""}
            </span>
          </div>
        </>
      )}
    </section>
  )
}

function LegendDot({
  className,
  label,
}: {
  className: string
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2 rounded-sm", className)} />
      {label}
    </span>
  )
}

// ─── Top authors ────────────────────────────────────────────────────────────

function TopAuthorsTable({ authors }: { authors: TopAuthor[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" />
        <SectionHeading label="Top authors" inline />
      </div>
      {authors.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No author activity in this range.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-2 text-left font-medium">Operator</th>
              <th className="py-2 text-right font-medium">Imported</th>
              <th className="py-2 text-right font-medium">Promoted</th>
            </tr>
          </thead>
          <tbody>
            {authors.map((a) => (
              <tr
                key={a.displayName}
                className="border-b border-border/40 last:border-0"
              >
                <td className="py-2 text-foreground">{a.displayName}</td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {a.imported.toLocaleString()}
                </td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {a.promoted.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

// ─── Top tags ───────────────────────────────────────────────────────────────

function TopTagsCloud({
  tags,
}: {
  tags: Array<{ tag: string; count: number }>
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Activity className="size-4 text-muted-foreground" />
        <SectionHeading label="Top tags" inline />
      </div>
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No tags in this workspace yet.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tags.map((t) => (
            <Badge
              key={t.tag}
              variant="outline"
              className="gap-1.5 font-normal text-foreground"
            >
              <span>{t.tag}</span>
              <span className="tabular-nums text-muted-foreground">
                {t.count}
              </span>
            </Badge>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── By-source bars ─────────────────────────────────────────────────────────

function BySourceBars({
  sources,
}: {
  sources: Array<{ sourceApp: string; count: number }>
}) {
  const peak = sources.reduce((m, s) => Math.max(m, s.count), 0)

  return (
    <section>
      <SectionHeading label="By source" />
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground">No threads yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sources.map((s) => {
            const pct = peak === 0 ? 0 : (s.count / peak) * 100
            return (
              <li
                key={s.sourceApp}
                className="flex items-center gap-3 text-sm"
              >
                <div className="w-28 shrink-0">
                  <SourceAppToken
                    source={s.sourceApp}
                    size="sm"
                    variant="pill"
                  />
                </div>
                <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground/70"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-12 shrink-0 text-right tabular-nums text-foreground">
                  {s.count.toLocaleString()}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ─── Continuation activity ──────────────────────────────────────────────────

function ContinuationActivity({
  sessions,
  messages,
}: {
  sessions: number
  messages: number
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare className="size-4 text-muted-foreground" />
        <SectionHeading label="Continuation chat" inline />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-semibold tabular-nums text-foreground">
              {sessions.toLocaleString()}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Grounded chats opened against imported threads
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/60 shadow-none">
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Messages
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-semibold tabular-nums text-foreground">
              {messages.toLocaleString()}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Total turns across all continuation sessions
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function SectionHeading({
  label,
  inline = false,
}: {
  label: string
  inline?: boolean
}) {
  return (
    <h2
      className={cn(
        "text-sm font-semibold uppercase tracking-wider text-muted-foreground",
        !inline && "mb-3"
      )}
    >
      {label}
    </h2>
  )
}
