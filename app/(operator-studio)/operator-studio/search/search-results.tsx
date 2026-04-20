"use client"

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, MessageSquare, Search as SearchIcon } from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Separator } from "@/registry/new-york-v4/ui/separator"
import { cn } from "@/lib/utils"
import {
  REVIEW_STATE_COLORS,
  REVIEW_STATE_LABELS,
  type OperatorReviewState,
  type OperatorSourceApp,
} from "@/lib/operator-studio/types"
import { SourceAppToken } from "../components/source-apps"

// ─── Response shape ──────────────────────────────────────────────────────────

interface ThreadHit {
  id: string
  workspaceId: string
  rawTitle: string | null
  promotedTitle: string | null
  tags: string[]
  reviewState: OperatorReviewState
  sourceApp: OperatorSourceApp
  importedAt: string
  rank: number
  snippet: string | null
}

interface MessageHit {
  id: string
  threadId: string
  threadTitle: string | null
  role: string
  turnIndex: number
  createdAt: string
  rank: number
  snippet: string
}

interface SearchResponse {
  query: string
  threads: ThreadHit[]
  messages: MessageHit[]
}

// ─── Snippet renderer ────────────────────────────────────────────────────────

/**
 * `ts_headline` returns text with literal `<mark>…</mark>` delimiters. We
 * split on them and render the marked ranges with a real `<mark>` element so
 * Tailwind styling applies.
 */
function SnippetText({
  text,
  className,
}: {
  text: string | null
  className?: string
}) {
  if (!text) return null

  const parts = text.split(/(<mark>.*?<\/mark>)/g)
  return (
    <span className={className}>
      {parts.map((part, i) => {
        const match = part.match(/^<mark>(.*?)<\/mark>$/)
        if (match) {
          return (
            <mark
              key={i}
              className="rounded-[2px] bg-amber-200/70 px-0.5 text-foreground dark:bg-amber-500/25"
            >
              {match[1]}
            </mark>
          )
        }
        return <React.Fragment key={i}>{part}</React.Fragment>
      })}
    </span>
  )
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SearchResults() {
  const params = useSearchParams()
  const q = (params.get("q") ?? "").trim()

  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<SearchResponse | null>(null)

  React.useEffect(() => {
    if (q.length < 2) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch(
      `/api/operator-studio/search?q=${encodeURIComponent(q)}&scope=all`,
      { signal: controller.signal }
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
        return r.json() as Promise<SearchResponse>
      })
      .then((body) => {
        setData(body)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return
        setError((e as Error).message || "Search failed")
        setLoading(false)
      })

    return () => controller.abort()
  }, [q])

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-muted-foreground">
          <SearchIcon className="size-4" />
          <span className="text-xs uppercase tracking-wider">Search</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {q.length >= 2 ? (
            <>
              Results for <span className="text-foreground/80">“{q}”</span>
            </>
          ) : (
            "Search Operator Studio"
          )}
        </h1>
        {q.length < 2 && (
          <p className="text-sm text-foreground/80">
            Enter at least two characters in the sidebar search to find
            threads and messages in this workspace.
          </p>
        )}
      </header>

      {q.length >= 2 && (
        <>
          <Separator className="my-6" />

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Searching…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <div className="flex flex-col gap-10">
              <ThreadsSection hits={data.threads} />
              <MessagesSection hits={data.messages} />

              {data.threads.length === 0 && data.messages.length === 0 && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-6 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No matches.
                  </p>
                  <p className="mt-1 text-sm text-foreground/80">
                    Try a different phrase, or drop quoted operators —
                    Postgres full-text search doesn’t parse those.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Threads section ────────────────────────────────────────────────────────

function ThreadsSection({ hits }: { hits: ThreadHit[] }) {
  return (
    <section>
      <SectionHeading label="Threads" count={hits.length} />
      {hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No thread matches.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
          {hits.map((t) => {
            const title = t.promotedTitle || t.rawTitle || "Untitled thread"
            return (
              <li key={t.id}>
                <Link
                  href={`/operator-studio/threads/${t.id}`}
                  className="flex flex-col gap-2 px-2 py-4 transition hover:bg-muted/40"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-medium text-foreground">
                      {title}
                    </span>
                    <SourceAppToken
                      source={t.sourceApp}
                      size="sm"
                      variant="pill"
                    />
                    <Badge
                      variant="secondary"
                      className={cn(
                        "font-normal",
                        REVIEW_STATE_COLORS[t.reviewState]
                      )}
                    >
                      {REVIEW_STATE_LABELS[t.reviewState]}
                    </Badge>
                    {t.tags.slice(0, 4).map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="font-normal text-muted-foreground"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {t.snippet && (
                    <SnippetText
                      text={t.snippet}
                      className="text-sm text-foreground/80"
                    />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ─── Messages section ───────────────────────────────────────────────────────

function MessagesSection({ hits }: { hits: MessageHit[] }) {
  return (
    <section>
      <SectionHeading label="Messages in threads" count={hits.length} />
      {hits.length === 0 ? (
        <p className="text-sm text-muted-foreground">No message matches.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60 border-y border-border/60">
          {hits.map((m) => (
            <li key={m.id}>
              <Link
                href={`/operator-studio/threads/${m.threadId}`}
                className="flex flex-col gap-1.5 px-2 py-4 transition hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <MessageSquare className="size-3.5" />
                  <span className="font-medium text-foreground">
                    {m.threadTitle || "Untitled thread"}
                  </span>
                  <span>·</span>
                  <span>Turn {m.turnIndex}</span>
                  <span>·</span>
                  <span className="capitalize">{m.role}</span>
                  <span>·</span>
                  <span>{formatDate(m.createdAt)}</span>
                </div>
                <SnippetText
                  text={m.snippet}
                  className="text-sm text-foreground/80"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Bits ───────────────────────────────────────────────────────────────────

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h2>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}
