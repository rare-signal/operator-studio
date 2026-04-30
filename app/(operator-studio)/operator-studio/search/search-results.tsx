"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, MessageSquare, Search as SearchIcon, X } from "lucide-react"

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
  projectSlug: string | null
  importedAt: string
  createdAt: string
  rank: number | null
  snippet: string | null
}

interface MessageHit {
  id: string
  threadId: string
  threadTitle: string | null
  sourceApp: OperatorSourceApp
  projectSlug: string | null
  role: string
  turnIndex: number
  createdAt: string
  rank: number
  snippet: string
}

interface SearchResponse {
  query: string | null
  tag?: string | null
  threads: ThreadHit[]
  messages: MessageHit[]
}

type SortMode = "relevance" | "newest"

interface MessageGroup {
  threadId: string
  threadTitle: string | null
  sourceApp: OperatorSourceApp
  projectSlug: string | null
  messages: MessageHit[]
  bestRank: number
  latestAt: string
}

// ─── Snippet renderer ────────────────────────────────────────────────────────

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

// ─── Time helpers ───────────────────────────────────────────────────────────

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

type TimeBucket =
  | "today"
  | "yesterday"
  | "this-week"
  | "this-month"
  | "earlier"

const BUCKET_LABELS: Record<TimeBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "Earlier this week",
  "this-month": "Earlier this month",
  earlier: "Earlier",
}

const BUCKET_ORDER: TimeBucket[] = [
  "today",
  "yesterday",
  "this-week",
  "this-month",
  "earlier",
]

function bucketFor(iso: string): TimeBucket {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return "earlier"

  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }

  const today = startOfDay(new Date())
  const thenDay = startOfDay(then)
  const diffDays = Math.round(
    (today.getTime() - thenDay.getTime()) / (1000 * 60 * 60 * 24)
  )

  if (diffDays <= 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return "this-week"
  if (diffDays < 31) return "this-month"
  return "earlier"
}

// ─── Main component ─────────────────────────────────────────────────────────

export function SearchResults() {
  const params = useSearchParams()
  const router = useRouter()
  const q = (params.get("q") ?? "").trim()
  const tag = (params.get("tag") ?? "").trim()

  // Editable draft synced to the URL with a 300ms debounce. URL is the source
  // of truth — the input mirrors it on outside navigation (sidebar, back/fwd).
  const [draft, setDraft] = React.useState(q)
  const inputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => setDraft(q), [q])
  React.useEffect(() => {
    const trimmed = draft.trim()
    if (trimmed === q) return
    const handle = setTimeout(() => {
      const url = trimmed.length >= 2
        ? `/operator-studio/search?q=${encodeURIComponent(trimmed)}`
        : "/operator-studio/search"
      router.replace(url)
    }, 300)
    return () => clearTimeout(handle)
  }, [draft, q, router])

  // Keyboard: `/` focuses the input from anywhere on the page (skip when the
  // user is already typing into another field). Esc behavior is on the input.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return
      }
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const clearTag = () => {
    router.replace("/operator-studio/search")
  }

  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [data, setData] = React.useState<SearchResponse | null>(null)

  // Filters & sort
  const [sourceFilter, setSourceFilter] = React.useState<Set<string>>(new Set())
  const [roleFilter, setRoleFilter] = React.useState<Set<string>>(new Set())
  const [projectFilter, setProjectFilter] = React.useState<Set<string>>(
    new Set()
  )
  const [sort, setSort] = React.useState<SortMode>("relevance")

  React.useEffect(() => {
    const usable = tag.length > 0 || q.length >= 2
    if (!usable) {
      setData(null)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const url = tag
      ? `/api/operator-studio/search?tag=${encodeURIComponent(tag)}`
      : `/api/operator-studio/search?q=${encodeURIComponent(q)}&scope=all`

    fetch(url, { signal: controller.signal })
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
        // Reset filters when query changes
        setSourceFilter(new Set())
        setRoleFilter(new Set())
        setProjectFilter(new Set())
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return
        setError((e as Error).message || "Search failed")
        setLoading(false)
      })

    return () => controller.abort()
  }, [q, tag])

  // ── Derive filter facets from raw data ────────────────────────────────────
  const facets = React.useMemo(() => {
    const sources = new Map<string, number>()
    const roles = new Map<string, number>()
    const projects = new Map<string, number>()

    if (data) {
      for (const t of data.threads) {
        sources.set(t.sourceApp, (sources.get(t.sourceApp) ?? 0) + 1)
        if (t.projectSlug) {
          projects.set(t.projectSlug, (projects.get(t.projectSlug) ?? 0) + 1)
        }
      }
      for (const m of data.messages) {
        sources.set(m.sourceApp, (sources.get(m.sourceApp) ?? 0) + 1)
        roles.set(m.role, (roles.get(m.role) ?? 0) + 1)
        if (m.projectSlug) {
          projects.set(m.projectSlug, (projects.get(m.projectSlug) ?? 0) + 1)
        }
      }
    }

    return { sources, roles, projects }
  }, [data])

  // ── Apply filters ─────────────────────────────────────────────────────────
  const filtered = React.useMemo(() => {
    if (!data) return null
    const matchesSource = (s: string) =>
      sourceFilter.size === 0 || sourceFilter.has(s)
    const matchesProject = (p: string | null) =>
      projectFilter.size === 0 || (p !== null && projectFilter.has(p))
    const matchesRole = (r: string) =>
      roleFilter.size === 0 || roleFilter.has(r)

    const threads = data.threads.filter(
      (t) => matchesSource(t.sourceApp) && matchesProject(t.projectSlug)
    )
    const messages = data.messages.filter(
      (m) =>
        matchesSource(m.sourceApp) &&
        matchesProject(m.projectSlug) &&
        matchesRole(m.role)
    )
    return { threads, messages }
  }, [data, sourceFilter, projectFilter, roleFilter])

  // ── Group messages by thread ─────────────────────────────────────────────
  const groups = React.useMemo<MessageGroup[]>(() => {
    if (!filtered) return []
    const map = new Map<string, MessageGroup>()
    for (const m of filtered.messages) {
      let g = map.get(m.threadId)
      if (!g) {
        g = {
          threadId: m.threadId,
          threadTitle: m.threadTitle,
          sourceApp: m.sourceApp,
          projectSlug: m.projectSlug,
          messages: [],
          bestRank: m.rank,
          latestAt: m.createdAt,
        }
        map.set(m.threadId, g)
      }
      g.messages.push(m)
      if (m.rank > g.bestRank) g.bestRank = m.rank
      if (m.createdAt > g.latestAt) g.latestAt = m.createdAt
    }

    const arr = [...map.values()]
    for (const g of arr) g.messages.sort((a, b) => a.turnIndex - b.turnIndex)

    if (sort === "newest") {
      arr.sort((a, b) => b.latestAt.localeCompare(a.latestAt))
    } else {
      arr.sort((a, b) => b.bestRank - a.bestRank)
    }
    return arr
  }, [filtered, sort])

  // Threads section ordering
  const sortedThreads = React.useMemo(() => {
    if (!filtered) return []
    const arr = [...filtered.threads]
    if (sort === "newest") {
      arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } else {
      arr.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
    }
    return arr
  }, [filtered, sort])

  const totalThreadHits = filtered?.threads.length ?? 0
  const totalMessageHits = filtered?.messages.length ?? 0

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <SearchIcon className="size-4" />
          <span className="text-xs uppercase tracking-wider">Search</span>
        </div>
        <div className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
          {tag ? (
            <div className="flex w-full items-center gap-2 rounded-md border border-border/70 bg-background px-10 py-3 text-base">
              <span className="text-muted-foreground">Tag:</span>
              <Badge variant="secondary" className="font-normal">
                #{tag}
              </Badge>
              <button
                type="button"
                onClick={clearTag}
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" /> Clear tag
              </button>
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (draft.length > 0) {
                      e.preventDefault()
                      setDraft("")
                    } else {
                      inputRef.current?.blur()
                    }
                  }
                }}
                placeholder="Search threads and messages…"
                aria-label="Search"
                className={cn(
                  "w-full rounded-md border border-border/70 bg-background px-10 py-3 text-base text-foreground placeholder:text-muted-foreground",
                  "outline-none transition focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
                )}
                autoComplete="off"
                spellCheck={false}
              />
              {draft.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDraft("")
                    inputRef.current?.focus()
                  }}
                  aria-label="Clear search"
                  className="absolute right-3 inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {tag ? (
              <>Showing threads tagged <span className="text-foreground">#{tag}</span></>
            ) : draft.trim().length === 0 ? (
              "Type to search — at least 2 characters"
            ) : draft.trim().length === 1 ? (
              "Keep typing — minimum 2 characters"
            ) : (
              <>
                Results for{" "}
                <span className="text-foreground">“{draft.trim()}”</span>
              </>
            )}
          </span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
              /
            </kbd>{" "}
            focus ·{" "}
            <kbd className="rounded border border-border/60 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>{" "}
            clear
          </span>
        </div>
      </header>

      {q.length < 2 && tag.length === 0 && (
        <>
          <Separator className="my-6" />
          <div className="rounded-md border border-dashed border-border/60 bg-muted/20 p-8 text-center">
            <SearchIcon className="mx-auto mb-2 size-5 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              Search threads and messages
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Full-text search across every imported conversation in this
              workspace. Click a tag anywhere to filter.
            </p>
          </div>
        </>
      )}

      {(q.length >= 2 || tag.length > 0) && (
        <>
          <Separator className="my-6" />

          {loading && !data && (
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

          {!error && data && filtered && (
            <div
              className={cn(
                "flex flex-col gap-8 transition-opacity",
                loading && "opacity-60"
              )}
              aria-busy={loading || undefined}
            >
              <FilterBar
                facets={facets}
                sourceFilter={sourceFilter}
                setSourceFilter={setSourceFilter}
                roleFilter={roleFilter}
                setRoleFilter={setRoleFilter}
                projectFilter={projectFilter}
                setProjectFilter={setProjectFilter}
                sort={sort}
                setSort={setSort}
                threadCount={totalThreadHits}
                messageCount={totalMessageHits}
              />

              <ThreadsSection hits={sortedThreads} />
              <MessagesSection groups={groups} sort={sort} />

              {totalThreadHits === 0 && totalMessageHits === 0 && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-6 text-center">
                  <p className="text-sm font-medium text-foreground">
                    No matches.
                  </p>
                  <p className="mt-1 text-sm text-foreground/80">
                    {data.threads.length + data.messages.length > 0
                      ? "Filters hide every match. Clear a chip above to expand."
                      : "Try a different phrase, or remove quotes and search operators if you used any."}
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

// ─── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({
  facets,
  sourceFilter,
  setSourceFilter,
  roleFilter,
  setRoleFilter,
  projectFilter,
  setProjectFilter,
  sort,
  setSort,
  threadCount,
  messageCount,
}: {
  facets: {
    sources: Map<string, number>
    roles: Map<string, number>
    projects: Map<string, number>
  }
  sourceFilter: Set<string>
  setSourceFilter: (s: Set<string>) => void
  roleFilter: Set<string>
  setRoleFilter: (s: Set<string>) => void
  projectFilter: Set<string>
  setProjectFilter: (s: Set<string>) => void
  sort: SortMode
  setSort: (s: SortMode) => void
  threadCount: number
  messageCount: number
}) {
  const sources = [...facets.sources.entries()].sort((a, b) => b[1] - a[1])
  const roles = [...facets.roles.entries()].sort((a, b) => b[1] - a[1])
  const projects = [...facets.projects.entries()].sort((a, b) => b[1] - a[1])

  const toggle = (set: Set<string>, value: string): Set<string> => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }

  const hasFilters =
    sourceFilter.size > 0 || roleFilter.size > 0 || projectFilter.size > 0
  const total = threadCount + messageCount

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground tabular-nums">
          {total} {total === 1 ? "match" : "matches"}
          {threadCount > 0 || messageCount > 0 ? (
            <>
              {" "}
              <span className="text-foreground/60">
                · {threadCount} thread{threadCount === 1 ? "" : "s"} ·{" "}
                {messageCount} message{messageCount === 1 ? "" : "s"}
              </span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Sort</span>
          <SortChip
            active={sort === "relevance"}
            onClick={() => setSort("relevance")}
          >
            Relevance
          </SortChip>
          <SortChip
            active={sort === "newest"}
            onClick={() => setSort("newest")}
          >
            Newest
          </SortChip>
        </div>
      </div>

      {(sources.length > 1 || roles.length > 1 || projects.length > 1) && (
        <div className="flex flex-col gap-2">
          {sources.length > 1 && (
            <FilterRow label="Source">
              {sources.map(([src, count]) => (
                <FilterChip
                  key={src}
                  active={sourceFilter.has(src)}
                  onClick={() => setSourceFilter(toggle(sourceFilter, src))}
                >
                  <SourceAppToken
                    source={src}
                    size="sm"
                    variant="plain"
                    showLabel
                  />
                  <span className="text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </FilterChip>
              ))}
            </FilterRow>
          )}
          {roles.length > 1 && (
            <FilterRow label="Role">
              {roles.map(([role, count]) => (
                <FilterChip
                  key={role}
                  active={roleFilter.has(role)}
                  onClick={() => setRoleFilter(toggle(roleFilter, role))}
                >
                  <span className="capitalize">{role}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </FilterChip>
              ))}
            </FilterRow>
          )}
          {projects.length > 1 && (
            <FilterRow label="Project">
              {projects.map(([proj, count]) => (
                <FilterChip
                  key={proj}
                  active={projectFilter.has(proj)}
                  onClick={() => setProjectFilter(toggle(projectFilter, proj))}
                >
                  <span className="font-mono text-[11px]">{proj}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {count}
                  </span>
                </FilterChip>
              ))}
            </FilterRow>
          )}
        </div>
      )}

      {hasFilters && (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => {
            setSourceFilter(new Set())
            setRoleFilter(new Set())
            setProjectFilter(new Set())
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

function FilterRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition",
        active
          ? "border-foreground/40 bg-foreground/10 text-foreground"
          : "border-border/60 bg-background hover:border-foreground/30 hover:bg-muted/40"
      )}
    >
      {children}
    </button>
  )
}

function SortChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 transition",
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
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
                    {t.projectSlug && (
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] text-muted-foreground"
                      >
                        {t.projectSlug}
                      </Badge>
                    )}
                    {t.tags.slice(0, 4).map((tag) => (
                      <Link
                        key={tag}
                        href={`/operator-studio/search?tag=${encodeURIComponent(tag)}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Badge
                          variant="outline"
                          className="font-normal text-muted-foreground hover:text-foreground hover:border-foreground/40 cursor-pointer"
                        >
                          #{tag}
                        </Badge>
                      </Link>
                    ))}
                    <span
                      className="ml-auto text-xs text-muted-foreground tabular-nums"
                      title={formatAbsolute(t.createdAt)}
                    >
                      {timeAgo(t.createdAt)}
                    </span>
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

function MessagesSection({
  groups,
  sort,
}: {
  groups: MessageGroup[]
  sort: SortMode
}) {
  const totalMessages = groups.reduce((n, g) => n + g.messages.length, 0)

  // Newest sort gets time bucket headers between groups; relevance sort is
  // a flat list (rank order would shuffle dates and headers would be noise).
  const buckets = React.useMemo(() => {
    if (sort !== "newest") return null
    const map = new Map<TimeBucket, MessageGroup[]>()
    for (const g of groups) {
      const b = bucketFor(g.latestAt)
      const arr = map.get(b) ?? []
      arr.push(g)
      map.set(b, arr)
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map(
      (b) => [b, map.get(b)!] as const
    )
  }, [groups, sort])

  return (
    <section>
      <SectionHeading
        label={`Messages in ${groups.length} thread${groups.length === 1 ? "" : "s"}`}
        count={totalMessages}
      />
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No message matches.</p>
      ) : buckets ? (
        <div className="flex flex-col gap-6">
          {buckets.map(([b, gs]) => (
            <div key={b} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
                  {BUCKET_LABELS[b]}
                </h3>
                <div className="h-px flex-1 bg-border/60" />
              </div>
              <ul className="flex flex-col gap-3">
                {gs.map((g) => (
                  <MessageGroupCard key={g.threadId} group={g} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((g) => (
            <MessageGroupCard key={g.threadId} group={g} />
          ))}
        </ul>
      )}
    </section>
  )
}

function MessageGroupCard({ group }: { group: MessageGroup }) {
  const title = group.threadTitle || "Untitled thread"
  const count = group.messages.length

  return (
    <li className="flex flex-col rounded-md border border-border/60 bg-background/40">
      <Link
        href={`/operator-studio/threads/${group.threadId}`}
        className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 transition hover:bg-muted/40"
      >
        <MessageSquare className="size-3.5 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{title}</span>
        <SourceAppToken source={group.sourceApp} size="sm" variant="pill" />
        {group.projectSlug && (
          <Badge
            variant="outline"
            className="font-mono text-[10px] text-muted-foreground"
          >
            {group.projectSlug}
          </Badge>
        )}
        <Badge variant="secondary" className="font-normal">
          {count} match{count === 1 ? "" : "es"}
        </Badge>
        <span
          className="ml-auto text-xs text-muted-foreground tabular-nums"
          title={formatAbsolute(group.latestAt)}
        >
          {timeAgo(group.latestAt)}
        </span>
      </Link>
      <ul className="flex flex-col divide-y divide-border/60">
        {group.messages.map((m) => (
          <li key={m.id}>
            <Link
              href={`/operator-studio/threads/${m.threadId}#msg-${m.id}`}
              className="flex flex-col gap-1.5 px-3 py-3 transition hover:bg-muted/30"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded bg-muted/50 px-1.5 py-0.5 capitalize text-foreground/80">
                  {m.role}
                </span>
                <span>·</span>
                <span>Turn {m.turnIndex}</span>
                <span>·</span>
                <span title={formatAbsolute(m.createdAt)}>
                  {timeAgo(m.createdAt)}
                </span>
              </div>
              <SnippetText
                text={m.snippet}
                className="text-sm text-foreground/80"
              />
            </Link>
          </li>
        ))}
      </ul>
    </li>
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
