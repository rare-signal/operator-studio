"use client"

import * as React from "react"
import {
  ArrowRightLeft,
  ArrowUpRight,
  CheckCircle2,
  Footprints,
  MapPin,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Card } from "@/registry/new-york-v4/ui/card"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { cn } from "@/lib/utils"

import {
  isOnFront,
  trailIsInFlight,
  type Trail,
  type TrailQuote,
  type TrailsResponse,
  type TrailTemperature,
} from "@/lib/operator-studio/wayseer/contracts/trails"

import { SourceAppToken } from "../components/source-apps"

type TrailDecision = "pending" | "accepted" | "dismissed"
type QuoteAction = "promoted" | "jumped" | "rejected"

interface TrailsViewProps {
  response: TrailsResponse
  /** Lookup so `linked_step_ids` chips can render the step's real
   *  title instead of an opaque id. Missing ids fall back to a
   *  prettified render of the id itself. */
  stepTitlesById?: Record<string, string>
}

export function TrailsView({
  response,
  stepTitlesById = {},
}: TrailsViewProps) {
  const [decisions, setDecisions] = React.useState<
    Record<string, TrailDecision>
  >({})
  // Per-quote action ledger. Keyed `${trailId}::${quoteIdx}` so a quote
  // appearing in two trails (rare but possible — not deduped at the
  // schema level) can be acted on independently in each context.
  const [quoteActions, setQuoteActions] = React.useState<
    Record<string, QuoteAction>
  >({})

  const decide = (trailId: string, decision: TrailDecision) =>
    setDecisions((prev) => ({ ...prev, [trailId]: decision }))

  const actOnQuote = (
    trailId: string,
    quoteIdx: number,
    action: QuoteAction
  ) =>
    setQuoteActions((prev) => ({
      ...prev,
      [`${trailId}::${quoteIdx}`]: action,
    }))

  const trailTitleById = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const t of response.trails) map[t.trail_id] = t.inferred_title
    return map
  }, [response.trails])

  const front = response.trails.filter(isOnFront)
  const backBurner = response.trails.filter((t) => !isOnFront(t))

  const linkedCount = response.trails.filter(
    (t) => (t.linked_step_ids?.length ?? 0) > 0
  ).length
  const crossedCount = response.trails.filter(
    (t) => (t.crosses_with_trail_ids?.length ?? 0) > 0
  ).length

  const windowStart = new Date(response.window_start)
  const windowEnd = new Date(response.window_end)

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500 dark:text-stone-400">
          <Footprints className="size-3.5" />
          <span>Sleuth · cross-session synthesis</span>
        </div>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Trails
        </h1>
        <p className="max-w-prose text-stone-600 dark:text-stone-300">
          What you keep returning to in your own words. Three or more
          quotes from your own messages across recent sessions, grouped
          when the Sleuth thinks they belong to the same through-line.
        </p>
        <p className="mt-4 text-xs text-stone-400 italic dark:text-stone-500">
          As of {formatRange(windowStart, windowEnd)} ·{" "}
          {response.trails.length} trail
          {response.trails.length === 1 ? "" : "s"} surfaced ·{" "}
          {linkedCount} linked to plan steps · {crossedCount} cross
          another trail
        </p>
      </header>

      <section className="space-y-6">
        {front.map((trail) => (
          <TrailCard
            key={trail.trail_id}
            trail={trail}
            decision={decisions[trail.trail_id] ?? "pending"}
            onDecide={(d) => decide(trail.trail_id, d)}
            onQuoteAction={(quoteIdx, action) =>
              actOnQuote(trail.trail_id, quoteIdx, action)
            }
            quoteActions={quoteActions}
            trailTitleById={trailTitleById}
            stepTitlesById={stepTitlesById}
          />
        ))}
      </section>

      {backBurner.length > 0 && (
        <>
          <Separator className="my-12" />
          <section>
            <header className="mb-4 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-400 dark:text-stone-500">
              <span>Back burner</span>
              <span className="text-[10px] normal-case tracking-normal text-stone-400 dark:text-stone-500">
                — cooling or dormant
              </span>
            </header>
            <div className="space-y-6">
              {backBurner.map((trail) => (
                <TrailCard
                  key={trail.trail_id}
                  trail={trail}
                  decision={decisions[trail.trail_id] ?? "pending"}
                  onDecide={(d) => decide(trail.trail_id, d)}
                  onQuoteAction={(quoteIdx, action) =>
                    actOnQuote(trail.trail_id, quoteIdx, action)
                  }
                  quoteActions={quoteActions}
                  trailTitleById={trailTitleById}
                  stepTitlesById={stepTitlesById}
                  muted
                />
              ))}
            </div>
          </section>
        </>
      )}

      <footer className="mt-16 border-t border-stone-200 pt-6 text-xs italic text-stone-400 dark:border-stone-800 dark:text-stone-500">
        Detective work is allowed; the moment it speaks louder than your
        own words, this surface has failed. Quotes are sacrosanct — the
        Sleuth&apos;s framing sits beside them, not over them.
      </footer>
    </div>
  )
}

function TrailCard({
  trail,
  decision,
  onDecide,
  onQuoteAction,
  quoteActions,
  trailTitleById,
  stepTitlesById,
  muted = false,
}: {
  trail: Trail
  decision: TrailDecision
  onDecide: (d: TrailDecision) => void
  onQuoteAction: (quoteIdx: number, action: QuoteAction) => void
  quoteActions: Record<string, QuoteAction>
  trailTitleById: Record<string, string>
  stepTitlesById: Record<string, string>
  muted?: boolean
}) {
  const inFlight = trailIsInFlight(trail, new Date())

  if (decision !== "pending") {
    return (
      <Card
        className={cn(
          "border-stone-200/70 bg-stone-50/40 px-6 py-4 shadow-none dark:border-stone-800/70 dark:bg-stone-900/30",
          decision === "accepted" && "border-emerald-300/60 dark:border-emerald-900/60"
        )}
      >
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="italic text-stone-500 dark:text-stone-400">
            {trail.inferred_title}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs uppercase tracking-widest",
              decision === "accepted"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-stone-400 dark:text-stone-500"
            )}
          >
            {decision === "accepted" ? (
              <>
                <CheckCircle2 className="size-3.5" /> pinned
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" /> dismissed
              </>
            )}
          </span>
        </div>
      </Card>
    )
  }

  const hasLinks =
    (trail.linked_step_ids?.length ?? 0) > 0 ||
    (trail.crosses_with_trail_ids?.length ?? 0) > 0

  return (
    <Card
      className={cn(
        "border-stone-200 bg-white px-6 py-5 shadow-none dark:border-stone-800 dark:bg-stone-950",
        muted && "opacity-80"
      )}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TemperaturePill temperature={trail.temperature} inFlight={inFlight} />
        <span className="text-[10px] uppercase tracking-widest text-stone-400 italic dark:text-stone-500">
          inferred trail
        </span>
        {trail.observed_in_source_apps && trail.observed_in_source_apps.length > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            {trail.observed_in_source_apps.map((src) => (
              <SourceAppToken
                key={src}
                source={src}
                size="sm"
                shortLabel
                showLabel={false}
              />
            ))}
          </div>
        )}
      </div>

      <h2 className="mb-1 text-lg italic text-stone-500 dark:text-stone-400">
        {trail.inferred_title}
      </h2>
      <p className="mb-3 max-w-prose text-sm italic text-stone-400 dark:text-stone-500">
        {trail.inferred_rationale}
      </p>

      {hasLinks && (
        <div className="mb-6 flex flex-wrap items-center gap-1.5 text-[11px]">
          {trail.linked_step_ids?.map((stepId) => {
            const realTitle = stepTitlesById[stepId]
            return (
              <a
                key={stepId}
                href={`/operator-studio/plan?focus=${encodeURIComponent(stepId)}`}
                className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-900/40 dark:text-stone-400 dark:hover:text-stone-100"
                title={`Jump to step ${stepId}`}
              >
                <ArrowUpRight className="size-3" />
                <span className="font-medium">Step:</span>
                <span
                  className={cn(
                    "truncate",
                    realTitle ? "" : "font-mono text-[10px]"
                  )}
                >
                  {realTitle ?? prettifyStepId(stepId)}
                </span>
              </a>
            )
          })}
          {trail.crosses_with_trail_ids?.map((otherId) => (
            <a
              key={otherId}
              href={`#${otherId}`}
              className="inline-flex items-center gap-1 rounded-full border border-amber-200/70 bg-amber-50/60 px-2 py-0.5 text-amber-700 transition-colors hover:border-amber-300 hover:text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:text-amber-200"
              title={`Crosses with trail ${otherId}`}
            >
              <ArrowRightLeft className="size-3" />
              <span className="truncate italic">
                {trailTitleById[otherId] ?? otherId}
              </span>
            </a>
          ))}
        </div>
      )}

      <ol className="space-y-5 border-l border-stone-200 pl-5 dark:border-stone-800">
        {trail.quotes.map((q, i) => (
          <QuoteRow
            key={`${q.source_thread_key}-${q.turn_index}-${i}`}
            quote={q}
            action={quoteActions[`${trail.trail_id}::${i}`]}
            onAction={(a) => onQuoteAction(i, a)}
          />
        ))}
      </ol>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-4 dark:border-stone-900">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onDecide("accepted")}
        >
          <MapPin className="size-3.5" /> Pin trail to plan
        </Button>
        <span className="text-[10px] italic text-stone-400 dark:text-stone-500">
          or hover any quote to act on it individually
        </span>
        <div className="ml-auto" />
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          onClick={() => onDecide("dismissed")}
        >
          <Trash2 className="size-3.5" /> Not a thing
        </Button>
      </div>
    </Card>
  )
}

function QuoteRow({
  quote,
  action,
  onAction,
}: {
  quote: TrailQuote
  action: QuoteAction | undefined
  onAction: (a: QuoteAction) => void
}) {
  const occurred = new Date(quote.occurred_at)
  return (
    <li className="group/quote -ml-5 pl-5">
      <div className="relative">
        <blockquote
          className={cn(
            "font-serif text-[17px] leading-relaxed text-stone-900 dark:text-stone-100",
            action === "rejected" && "line-through text-stone-400 dark:text-stone-600"
          )}
        >
          &ldquo;{quote.quote}&rdquo;
        </blockquote>
        <QuoteActionsRail action={action} onAction={onAction} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
        <time dateTime={quote.occurred_at} title={occurred.toISOString()}>
          {formatRelative(occurred)}
        </time>
        <span aria-hidden>·</span>
        <span className="truncate font-mono text-[10px] text-stone-400 dark:text-stone-500">
          {quote.source_thread_key.slice(0, 18)}… · turn {quote.turn_index}
        </span>
        {action && (
          <span
            className={cn(
              "ml-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest",
              action === "promoted" && "text-emerald-600 dark:text-emerald-400",
              action === "jumped" && "text-sky-600 dark:text-sky-400",
              action === "rejected" && "text-stone-400 dark:text-stone-500"
            )}
          >
            {action === "promoted" && (
              <>
                <Sparkles className="size-3" /> promoted to step
              </>
            )}
            {action === "jumped" && (
              <>
                <ArrowUpRight className="size-3" /> opened source turn
              </>
            )}
            {action === "rejected" && (
              <>
                <X className="size-3" /> doesn&apos;t belong
              </>
            )}
          </span>
        )}
      </div>
    </li>
  )
}

function QuoteActionsRail({
  action,
  onAction,
}: {
  action: QuoteAction | undefined
  onAction: (a: QuoteAction) => void
}) {
  if (action) return null
  return (
    <div className="absolute right-0 top-0 flex translate-x-2 items-center gap-1 opacity-0 transition-opacity group-hover/quote:opacity-100">
      <QuoteIconButton
        title="Promote this quote to its own plan step"
        onClick={() => onAction("promoted")}
      >
        <Sparkles className="size-3.5" />
      </QuoteIconButton>
      <QuoteIconButton
        title="Open the source turn in its thread"
        onClick={() => onAction("jumped")}
      >
        <ArrowUpRight className="size-3.5" />
      </QuoteIconButton>
      <QuoteIconButton
        title="This quote doesn't belong to this trail"
        onClick={() => onAction("rejected")}
      >
        <X className="size-3.5" />
      </QuoteIconButton>
    </div>
  )
}

function QuoteIconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-500 shadow-sm transition-colors hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-400 dark:hover:text-stone-100"
    >
      {children}
    </button>
  )
}

function TemperaturePill({
  temperature,
  inFlight,
}: {
  temperature: TrailTemperature
  inFlight: boolean
}) {
  const styles: Record<
    TrailTemperature,
    { dot: string; text: string; label: string }
  > = {
    heating: {
      dot: "bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      label: "heating",
    },
    steady: {
      dot: "bg-emerald-500",
      text: "text-emerald-700 dark:text-emerald-400",
      label: "steady",
    },
    cooling: {
      dot: "bg-sky-500",
      text: "text-sky-700 dark:text-sky-400",
      label: "cooling",
    },
    dormant: {
      dot: "bg-stone-400",
      text: "text-stone-500 dark:text-stone-400",
      label: "dormant",
    },
  }
  const s = styles[temperature]
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-stone-200 bg-transparent px-2 py-0.5 text-[10px] uppercase tracking-widest dark:border-stone-800",
        s.text
      )}
    >
      <span
        className={cn(
          "inline-block size-1.5 rounded-full",
          s.dot,
          inFlight && temperature === "heating" && "animate-pulse"
        )}
      />
      {s.label}
    </Badge>
  )
}

function prettifyStepId(id: string): string {
  // Demo helper — real id resolution would look up the step's title
  // from the active plan and render that instead.
  return id
    .replace(/^step-(stub-)?/, "")
    .replace(/-/g, " ")
}

function formatRange(start: Date, end: Date) {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  })
  return `${fmt.format(start)} – ${fmt.format(end)}`
}

function formatRelative(d: Date) {
  const now = Date.now()
  const diffMs = now - d.getTime()
  const minutes = Math.round(diffMs / 60_000)
  const hours = Math.round(diffMs / 3_600_000)
  const days = Math.round(diffMs / 86_400_000)
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 14) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d)
}
