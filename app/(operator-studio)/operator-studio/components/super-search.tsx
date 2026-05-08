"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Command as CommandPrimitive } from "cmdk"

const SHOWCASE_MODE = process.env.NEXT_PUBLIC_SHOWCASE === "1"
import {
  ArrowRight,
  FileText,
  Loader2,
  MessageSquare,
  Search,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/registry/new-york-v4/ui/dialog"

/**
 * SuperSearch — global command-palette-style search.
 *
 * Opens on ⌘K / Ctrl+K from anywhere. Hits the existing
 * /api/operator-studio/search endpoint (Postgres FTS, ranked,
 * pre-highlighted snippets). Two groups: threads and messages.
 *
 * Mounted once at the shell level so the hotkey works on every
 * route, and so a single instance owns the "open" state.
 */

interface ThreadHit {
  id: string
  workspaceId: string
  rawTitle: string | null
  promotedTitle: string | null
  tags: string[] | null
  reviewState: string
  sourceApp: string
  importedAt: string
  rank: number | null
  snippet: string | null
}

interface MessageHit {
  id: string
  threadId: string
  threadTitle: string | null
  role: string
  turnIndex: number
  createdAt: string
  rank: number | null
  snippet: string | null
}

interface SearchResponse {
  query: string | null
  threads: ThreadHit[]
  messages: MessageHit[]
}

const CTX = React.createContext<{
  open: boolean
  setOpen: (v: boolean) => void
} | null>(null)

export function SuperSearchProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  return (
    <CTX.Provider value={{ open, setOpen }}>
      {children}
      <SuperSearchDialog open={open} onOpenChange={setOpen} />
    </CTX.Provider>
  )
}

/** Hook for any sidebar / button that wants to open the palette. */
export function useSuperSearch() {
  const ctx = React.useContext(CTX)
  if (!ctx) throw new Error("useSuperSearch must be used within SuperSearchProvider")
  return ctx
}

function SuperSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<SearchResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Global hotkey: ⌘K / Ctrl+K to toggle.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  // Reset state on close so reopening starts clean.
  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setResults(null)
      setError(null)
      setLoading(false)
    }
  }, [open])

  // Debounced fetch.
  React.useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(null)
      setLoading(false)
      setError(null)
      return
    }
    const controller = new AbortController()
    const t = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        if (SHOWCASE_MODE) {
          // Static showcase: client-side title-substring search over
          // the snapshotted thread list. Postgres FTS isn't shipped in
          // the export, but a simple match is enough to make the
          // palette feel alive.
          const res = await fetch("/showcase-data/threads.json", {
            signal: controller.signal,
          })
          if (!res.ok) {
            setError("Showcase data unavailable")
            setResults(null)
          } else {
            const allThreads = (await res.json()) as Array<{
              id: string
              workspaceId: string
              rawTitle: string | null
              promotedTitle: string | null
              tags: string[] | null
              reviewState: string
              sourceApp: string
              messageCount: number
            }>
            const q = trimmed.toLowerCase()
            const matched = allThreads
              .filter((t) => {
                const title = (t.promotedTitle ?? t.rawTitle ?? "").toLowerCase()
                return title.includes(q)
              })
              .slice(0, 8)
              .map((t) => ({
                ...t,
                titleHighlighted: t.promotedTitle ?? t.rawTitle ?? "Untitled",
              }))
            setResults({
              query: trimmed,
              threads: matched as unknown as ThreadHit[],
              messages: [],
            })
          }
        } else {
          const res = await fetch(
            `/api/operator-studio/search?q=${encodeURIComponent(trimmed)}&limit=8`,
            { signal: controller.signal }
          )
          if (!res.ok) {
            setError(`Search failed (${res.status})`)
            setResults(null)
          } else {
            setResults((await res.json()) as SearchResponse)
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return
        setError("Network error")
        setResults(null)
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      controller.abort()
      clearTimeout(t)
    }
  }, [query])

  const goToThread = (id: string) => {
    onOpenChange(false)
    router.push(`/operator-studio/threads/${id}`)
  }
  const goToMessage = (threadId: string, messageId: string) => {
    onOpenChange(false)
    router.push(`/operator-studio/threads/${threadId}#message-${messageId}`)
  }
  const goToFullSearch = () => {
    if (!query.trim()) return
    onOpenChange(false)
    router.push(`/operator-studio/search?q=${encodeURIComponent(query.trim())}`)
  }

  const showInitial = query.trim().length < 2 && !loading
  const totalHits = (results?.threads.length ?? 0) + (results?.messages.length ?? 0)
  const showEmpty =
    !showInitial && !loading && !error && results !== null && totalHits === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden p-0 sm:max-w-2xl gap-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search threads and messages across the workspace.
        </DialogDescription>
        <CommandPrimitive
          shouldFilter={false}
          loop
          className="flex flex-col"
        >
          <div className="flex items-center gap-2 px-4 border-b border-border">
            <Search className="size-4 text-muted-foreground shrink-0" />
            <CommandPrimitive.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search threads, messages…"
              className="flex h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            {loading && (
              <Loader2 className="size-3.5 text-muted-foreground animate-spin shrink-0" />
            )}
            <kbd className="hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-muted/50 px-1.5 font-mono text-[10px] text-muted-foreground">
              esc
            </kbd>
          </div>

          <CommandPrimitive.List className="max-h-[360px] overflow-y-auto overflow-x-hidden p-2">
            {showInitial && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <p>Type at least 2 characters to search.</p>
                <p className="mt-1.5">
                  Searches thread titles, summaries, and message bodies.
                </p>
              </div>
            )}

            {error && (
              <div className="py-6 text-center text-xs text-destructive">
                {error}
              </div>
            )}

            {showEmpty && (
              <div className="py-8 text-center text-xs text-muted-foreground">
                <p>No matches for &ldquo;{query.trim()}&rdquo;.</p>
                <p className="mt-1.5">
                  Try a different word, or remove a filter.
                </p>
              </div>
            )}

            {results && results.threads.length > 0 && (
              <Group label="Threads">
                {results.threads.map((t) => (
                  <CommandPrimitive.Item
                    key={`thread-${t.id}`}
                    value={`thread-${t.id}`}
                    onSelect={() => goToThread(t.id)}
                    className={itemClass}
                  >
                    <FileText className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {t.promotedTitle ?? t.rawTitle ?? "Untitled thread"}
                        </p>
                        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                          {t.sourceApp}
                        </span>
                      </div>
                      {t.snippet && (
                        <p
                          className="text-xs text-muted-foreground line-clamp-1 mt-0.5"
                          dangerouslySetInnerHTML={{ __html: t.snippet }}
                        />
                      )}
                    </div>
                  </CommandPrimitive.Item>
                ))}
              </Group>
            )}

            {results && results.messages.length > 0 && (
              <Group label="Messages">
                {results.messages.map((m) => (
                  <CommandPrimitive.Item
                    key={`msg-${m.id}`}
                    value={`msg-${m.id}`}
                    onSelect={() => goToMessage(m.threadId, m.id)}
                    className={itemClass}
                  >
                    <MessageSquare className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm truncate">
                          <span className="text-muted-foreground">
                            {m.threadTitle ?? "thread"}
                          </span>
                          <span className="text-muted-foreground/60 mx-1.5">·</span>
                          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                            {m.role}
                          </span>
                        </p>
                      </div>
                      {m.snippet && (
                        <p
                          className="text-xs text-foreground/90 line-clamp-2 mt-0.5"
                          dangerouslySetInnerHTML={{ __html: m.snippet }}
                        />
                      )}
                    </div>
                  </CommandPrimitive.Item>
                ))}
              </Group>
            )}

            {results && totalHits > 0 && (
              <Group label="">
                <CommandPrimitive.Item
                  value="open-full-search"
                  onSelect={goToFullSearch}
                  className={cn(itemClass, "text-emerald-700 dark:text-emerald-400")}
                >
                  <Search className="size-3.5 shrink-0 mt-0.5" />
                  <span className="text-sm flex-1">
                    See all results for &ldquo;{query.trim()}&rdquo;
                  </span>
                  <ArrowRight className="size-3.5 shrink-0 mt-0.5" />
                </CommandPrimitive.Item>
              </Group>
            )}
          </CommandPrimitive.List>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}

const itemClass =
  "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm outline-none cursor-pointer data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"

function Group({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <CommandPrimitive.Group
      heading={label || undefined}
      className="text-foreground [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1"
    >
      {children}
    </CommandPrimitive.Group>
  )
}
