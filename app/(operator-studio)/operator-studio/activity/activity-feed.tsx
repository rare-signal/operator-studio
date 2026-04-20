"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  Activity as ActivityIcon,
  Archive,
  Download,
  FileText,
  Flame,
  Loader2,
  MessageSquare,
  Star,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { cn } from "@/lib/utils"

// ─── Response shape ─────────────────────────────────────────────────────────

type ActivityKind =
  | "thread.imported"
  | "thread.promoted"
  | "thread.archived"
  | "message.promoted"
  | "summary.created"
  | "chat.session.started"

interface ActivityEvent {
  id: string
  kind: ActivityKind
  at: string
  actor: string
  threadId: string
  threadTitle: string | null
  details: Record<string, unknown>
}

interface ActivityResponse {
  events: ActivityEvent[]
  hasMore: boolean
}

// ─── Static kind metadata ───────────────────────────────────────────────────

interface KindMeta {
  label: string
  verb: string
  icon: React.ComponentType<{ className?: string }>
}

const KIND_META: Record<ActivityKind, KindMeta> = {
  "thread.imported": {
    label: "Imported",
    verb: "imported",
    icon: Download,
  },
  "thread.promoted": {
    label: "Promoted",
    verb: "promoted",
    icon: Star,
  },
  "thread.archived": {
    label: "Archived",
    verb: "archived",
    icon: Archive,
  },
  "message.promoted": {
    label: "Fired message",
    verb: "fired a message in",
    icon: Flame,
  },
  "summary.created": {
    label: "Summary",
    verb: "added a summary to",
    icon: FileText,
  },
  "chat.session.started": {
    label: "Chat",
    verb: "started a chat on",
    icon: MessageSquare,
  },
}

const ALL_KINDS: ActivityKind[] = [
  "thread.imported",
  "thread.promoted",
  "thread.archived",
  "message.promoted",
  "summary.created",
  "chat.session.started",
]

// ─── Time-ago helper (no date-fns) ──────────────────────────────────────────

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ""
  const now = Date.now()
  const diffSec = Math.max(0, Math.round((now - then) / 1000))

  if (diffSec < 45) return "just now"
  if (diffSec < 90) return "1m ago"
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  const diffWk = Math.round(diffDay / 7)
  if (diffWk < 5) return `${diffWk}w ago`
  const diffMo = Math.round(diffDay / 30)
  if (diffMo < 12) return `${diffMo}mo ago`
  const diffYr = Math.round(diffDay / 365)
  return `${diffYr}y ago`
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50

export function ActivityFeed() {
  const router = useRouter()

  const [events, setEvents] = React.useState<ActivityEvent[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [hasMore, setHasMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [activeKinds, setActiveKinds] = React.useState<Set<ActivityKind>>(
    () => new Set(ALL_KINDS)
  )

  // Initial load
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(`/api/operator-studio/activity?limit=${PAGE_SIZE}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<ActivityResponse>
      })
      .then((body) => {
        setEvents(body.events)
        setHasMore(body.hasMore)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return
        setError((e as Error).message || "Failed to load activity")
        setLoading(false)
      })

    return () => controller.abort()
  }, [])

  const visibleEvents = React.useMemo(
    () => events.filter((e) => activeKinds.has(e.kind)),
    [events, activeKinds]
  )

  const toggleKind = (kind: ActivityKind) => {
    setActiveKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const loadMore = async () => {
    if (loadingMore || events.length === 0) return
    const oldest = events[events.length - 1]
    setLoadingMore(true)
    try {
      const res = await fetch(
        `/api/operator-studio/activity?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.at)}`
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      const body = (await res.json()) as ActivityResponse
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id))
        const additions = body.events.filter((e) => !seen.has(e.id))
        return [...prev, ...additions]
      })
      setHasMore(body.hasMore)
    } catch (e: unknown) {
      setError((e as Error).message || "Failed to load more")
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          <ActivityIcon className="size-4" />
          <span className="text-xs uppercase tracking-wider">Activity</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          What&apos;s been happening
        </h1>
        <p className="text-sm text-foreground/80">
          Every thread capture, promotion, summary, and continuation chat
          in this workspace, newest first.
        </p>
      </header>

      <Separator className="my-6" />

      <FilterBar activeKinds={activeKinds} onToggle={toggleKind} />

      <div className="mt-6">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading activity…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {error}
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <EmptyState />
        )}

        {!loading && !error && events.length > 0 && visibleEvents.length === 0 && (
          <div className="rounded-md border border-border/60 bg-muted/30 p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              No events match the current filter.
            </p>
            <p className="mt-1 text-sm text-foreground/80">
              Toggle a pill above to expand the stream.
            </p>
          </div>
        )}

        {!loading && !error && visibleEvents.length > 0 && (
          <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
            {visibleEvents.map((event) => (
              <ActivityRow
                key={event.id}
                event={event}
                onNavigate={(threadId) => {
                  if (threadId) {
                    router.push(`/operator-studio/threads/${threadId}`)
                  }
                }}
              />
            ))}
          </ul>
        )}

        {!loading && !error && hasMore && (
          <div className="mt-6 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading…
                </>
              ) : (
                "Load more"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({
  activeKinds,
  onToggle,
}: {
  activeKinds: Set<ActivityKind>
  onToggle: (kind: ActivityKind) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ALL_KINDS.map((kind) => {
        const meta = KIND_META[kind]
        const Icon = meta.icon
        const active = activeKinds.has(kind)
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggle(kind)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
              active
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-muted/50"
            )}
            aria-pressed={active}
          >
            <Icon className="size-3.5" />
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Row ────────────────────────────────────────────────────────────────────

function ActivityRow({
  event,
  onNavigate,
}: {
  event: ActivityEvent
  onNavigate: (threadId: string) => void
}) {
  const meta = KIND_META[event.kind]
  const Icon = meta.icon
  const title = event.threadTitle || "Untitled thread"
  const clickable = event.threadId.length > 0

  const extras = renderExtras(event)

  return (
    <li>
      <button
        type="button"
        onClick={() => onNavigate(event.threadId)}
        disabled={!clickable}
        className={cn(
          "flex w-full items-start gap-3 px-2 py-4 text-left transition",
          clickable
            ? "hover:bg-muted/40"
            : "cursor-default"
        )}
      >
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/60 bg-muted/40 text-muted-foreground">
          <Icon className="size-3.5" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-foreground/80">
            <strong className="font-semibold text-foreground">
              {event.actor}
            </strong>
            <span>{meta.verb}</span>
            <span className="font-medium text-foreground">
              &ldquo;{title}&rdquo;
            </span>
            {extras}
          </div>
          <div className="text-xs text-muted-foreground">
            <span title={formatAbsolute(event.at)}>{timeAgo(event.at)}</span>
          </div>
        </div>
      </button>
    </li>
  )
}

function renderExtras(event: ActivityEvent): React.ReactNode {
  if (event.kind === "message.promoted") {
    const promotionKind = event.details.promotionKind
    if (typeof promotionKind === "string" && promotionKind.length > 0) {
      return (
        <Badge
          variant="outline"
          className="ml-1 font-normal text-muted-foreground"
        >
          {promotionKind}
        </Badge>
      )
    }
  }
  if (event.kind === "thread.imported") {
    const sourceApp = event.details.sourceApp
    if (typeof sourceApp === "string" && sourceApp.length > 0) {
      return (
        <Badge
          variant="outline"
          className="ml-1 font-normal text-muted-foreground"
        >
          {sourceApp}
        </Badge>
      )
    }
  }
  if (event.kind === "summary.created") {
    const summaryKind = event.details.summaryKind
    if (typeof summaryKind === "string" && summaryKind.length > 0) {
      return (
        <Badge
          variant="outline"
          className="ml-1 font-normal text-muted-foreground"
        >
          {summaryKind}
        </Badge>
      )
    }
  }
  return null
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-8 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border/60 bg-background text-muted-foreground">
        <ActivityIcon className="size-4" />
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">
        No activity yet
      </p>
      <p className="mt-1 text-sm text-foreground/80">
        Capture a thread to start the stream.
      </p>
    </div>
  )
}
