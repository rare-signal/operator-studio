"use client"

import * as React from "react"
import { ChevronDown, ChevronRight, Radio } from "lucide-react"

import { cn } from "@/lib/utils"
import type {
  EchoesFeed,
  OperatorTurn,
} from "@/lib/operator-studio/wayseer/fixtures-echoes"

import { SourceAppToken } from "../components/source-apps"

/**
 * The page is your own words, in your own order. Recurrence is a
 * quiet badge — not an entity. The agent retrieves; you synthesize.
 */
export function EchoesView({ feed }: { feed: EchoesFeed }) {
  const turnsById = React.useMemo(() => {
    const map: Record<string, OperatorTurn> = {}
    for (const t of feed.turns) map[t.id] = t
    return map
  }, [feed.turns])

  const [expandedTurnIds, setExpandedTurnIds] = React.useState<Set<string>>(
    new Set()
  )

  const toggle = (turnId: string) =>
    setExpandedTurnIds((prev) => {
      const next = new Set(prev)
      if (next.has(turnId)) next.delete(turnId)
      else next.add(turnId)
      return next
    })

  const echoedCount = feed.turns.filter(
    (t) => t.relatedTurnIds.length > 0
  ).length

  const windowStart = new Date(feed.windowStart)
  const windowEnd = new Date(feed.windowEnd)

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 md:px-8">
      <header className="mb-12">
        <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-stone-500 dark:text-stone-400">
          <Radio className="size-3.5" />
          <span>Your own words, recurring</span>
        </div>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Echoes
        </h1>
        <p className="max-w-prose text-stone-600 dark:text-stone-300">
          Your operator turns from recent agentic sessions, in order.
          When something you said rhymes with something you said before,
          a small badge surfaces — click to read the matches inline.
          The agent retrieves; you decide what it means.
        </p>
        <p className="mt-4 text-xs italic text-stone-400 dark:text-stone-500">
          {formatRange(windowStart, windowEnd)} · {feed.turns.length} turns
          · {echoedCount} echoed elsewhere
        </p>
      </header>

      <ol className="space-y-8">
        {feed.turns.map((turn) => (
          <TurnRow
            key={turn.id}
            turn={turn}
            related={turn.relatedTurnIds.map((id) => turnsById[id]).filter(Boolean)}
            expanded={expandedTurnIds.has(turn.id)}
            onToggle={() => toggle(turn.id)}
          />
        ))}
      </ol>

      <footer className="mt-20 border-t border-stone-200 pt-6 text-xs italic text-stone-400 dark:border-stone-800 dark:text-stone-500">
        No titles, no rationales, no temperatures. The agent only
        retrieves; the operator does the synthesis. If this surface ever
        starts naming what you mean, it has stopped being useful.
      </footer>
    </div>
  )
}

function TurnRow({
  turn,
  related,
  expanded,
  onToggle,
}: {
  turn: OperatorTurn
  related: OperatorTurn[]
  expanded: boolean
  onToggle: () => void
}) {
  const occurred = new Date(turn.occurredAt)
  const hasEchoes = related.length > 0
  return (
    <li className="group">
      <article>
        <blockquote className="font-serif text-[19px] leading-relaxed text-stone-900 dark:text-stone-100">
          &ldquo;{turn.content}&rdquo;
        </blockquote>
        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11px] text-stone-500 dark:text-stone-400">
          <time
            dateTime={turn.occurredAt}
            title={occurred.toISOString()}
            className="tabular-nums"
          >
            {formatRelative(occurred)}
          </time>
          <span aria-hidden>·</span>
          <SourceAppToken
            source={turn.sourceApp}
            size="sm"
            shortLabel
            showLabel={false}
          />
          {turn.threadTitle && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate italic">
                {turn.threadTitle}
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <span className="font-mono text-[10px] text-stone-400 dark:text-stone-500">
            turn {turn.turnIndex}
          </span>
          {hasEchoes && (
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest transition-colors",
                expanded
                  ? "border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                  : "border-stone-200 bg-transparent text-stone-500 hover:border-stone-300 hover:text-stone-900 dark:border-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
              )}
            >
              {expanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {related.length} {related.length === 1 ? "echo" : "echoes"}
            </button>
          )}
        </div>

        {hasEchoes && expanded && (
          <ol className="mt-4 space-y-5 border-l border-stone-200 pl-5 dark:border-stone-800">
            {related.map((r) => (
              <EchoMatch key={r.id} turn={r} />
            ))}
          </ol>
        )}
      </article>
    </li>
  )
}

function EchoMatch({ turn }: { turn: OperatorTurn }) {
  const occurred = new Date(turn.occurredAt)
  return (
    <li>
      <blockquote className="font-serif text-[15.5px] leading-relaxed text-stone-700 dark:text-stone-300">
        &ldquo;{turn.content}&rdquo;
      </blockquote>
      <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-[10.5px] text-stone-500 dark:text-stone-400">
        <time dateTime={turn.occurredAt} className="tabular-nums">
          {formatRelative(occurred)}
        </time>
        <span aria-hidden>·</span>
        <SourceAppToken
          source={turn.sourceApp}
          size="sm"
          shortLabel
          showLabel={false}
        />
        {turn.threadTitle && (
          <>
            <span aria-hidden>·</span>
            <span className="truncate italic">{turn.threadTitle}</span>
          </>
        )}
      </div>
    </li>
  )
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
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 14) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(d)
}
