"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowRight,
  Brain,
  Download,
  Eye,
  FileText,
  Flame,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Star,
  Upload,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/registry/new-york-v4/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/registry/new-york-v4/ui/dialog"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Label } from "@/registry/new-york-v4/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/registry/new-york-v4/ui/select"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"

import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorDashboardStats,
  OperatorReviewState,
  OperatorSourceApp,
  PromotionKind,
} from "@/lib/operator-studio/types"
import {
  REVIEW_STATE_COLORS,
  REVIEW_STATE_LABELS,
  SOURCE_APP_LABELS,
  PROMOTION_KIND_LABELS,
  PROMOTION_KIND_COLORS,
  PROMOTION_KIND_EMOJI,
} from "@/lib/operator-studio/types"
import {
  SourceAppAvatar,
  SourceAppToken,
  SupportedImportsStrip,
} from "./source-apps"

interface DashboardProps {
  threads: OperatorThread[]
  stats: OperatorDashboardStats | null
}

export function Dashboard({ threads, stats }: DashboardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const stateFilter = searchParams.get("state") as OperatorReviewState | null
  const sourceFilter = searchParams.get("source") as OperatorSourceApp | null
  const viewParam = searchParams.get("view")

  const filteredThreads = React.useMemo(() => {
    let filtered = threads
    if (stateFilter) {
      filtered = filtered.filter((t) => t.reviewState === stateFilter)
    }
    if (sourceFilter) {
      filtered = filtered.filter((t) => t.sourceApp === sourceFilter)
    }
    return filtered
  }, [threads, stateFilter, sourceFilter])

  const promoted = React.useMemo(
    () => threads.filter((t) => t.reviewState === "promoted"),
    [threads]
  )
  const inReview = React.useMemo(
    () => threads.filter((t) => t.reviewState === "in-review"),
    [threads]
  )
  const recentImported = React.useMemo(
    () =>
      threads
        .filter((t) => t.reviewState === "imported")
        .slice(0, 10),
    [threads]
  )

  // Unified promoted gallery view (threads + messages)
  if (viewParam === "promoted") {
    return <PromotedGallery promotedThreads={promoted} />
  }

  const showingFiltered = stateFilter || sourceFilter
  const displayTitle = stateFilter
    ? REVIEW_STATE_LABELS[stateFilter]
    : sourceFilter
      ? SOURCE_APP_LABELS[sourceFilter]
      : null

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Stats row */}
      {stats && !showingFiltered && (
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard label="Total Threads" value={stats.totalThreads} icon={FileText} />
          <StatCard label="Promoted" value={stats.promoted} icon={Star} accent="emerald" />
          <StatCard label="In Review" value={stats.inReview} icon={Eye} accent="amber" />
          <StatCard label="Imported" value={stats.imported} icon={Download} accent="zinc" />
        </div>
      )}

      <SupportedImportsStrip />

      {/* Import actions */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold flex-1">
          {displayTitle ? `${displayTitle} Threads` : "Operator Memory"}
        </h2>
        {(stateFilter || sourceFilter) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/operator-studio")}
          >
            Clear filter
          </Button>
        )}
        <ImportDialog />
      </div>

      {/* Promoted section */}
      {!showingFiltered && promoted.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <Star className="size-3.5 text-emerald-500" />
            Featured / Promoted
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {promoted.map((t) => (
              <ThreadCard key={t.id} thread={t} />
            ))}
          </div>
        </section>
      )}

      {/* In Review section */}
      {!showingFiltered && inReview.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
            <Search className="size-3.5 text-amber-500" />
            In Review
          </h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {inReview.map((t) => (
              <ThreadCard key={t.id} thread={t} />
            ))}
          </div>
        </section>
      )}

      {/* All Threads — compact list inspired by Observatory Focus V4 */}
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
          {showingFiltered ? (
            displayTitle
          ) : (
            <>
              <MessageSquare className="size-3.5" />
              All Threads
            </>
          )}
          <span className="ml-1 tabular-nums text-[10px] text-muted-foreground/50">
            {(showingFiltered ? filteredThreads : threads).length}
          </span>
        </h3>

        {/* List header */}
        <div className="hidden md:grid grid-cols-[minmax(0,2.5fr)_7rem_7rem_5rem_5.5rem_6rem] gap-2 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50 border-b">
          <span>Thread</span>
          <span>Source</span>
          <span>Status</span>
          <span className="text-right">Turns</span>
          <span>Operator</span>
          <span className="text-right">Imported</span>
        </div>

        {/* Thread rows */}
        <div className="divide-y">
          {(showingFiltered ? filteredThreads : threads).map((t) => (
            <ThreadRow key={t.id} thread={t} />
          ))}
        </div>

        {(showingFiltered ? filteredThreads : threads).length === 0 && (
          <Card className="border-dashed mt-3">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Brain className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                {showingFiltered
                  ? "No threads match this filter."
                  : "No threads imported yet. Use the Import button to bring in operator chats."}
              </p>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  )
}

// ─── Thread Card ─────────────────────────────────────────────────────────────

function ThreadCard({ thread }: { thread: OperatorThread }) {
  const router = useRouter()
  const title =
    thread.promotedTitle ?? thread.rawTitle ?? "Untitled thread"
  const summary =
    thread.promotedSummary ?? thread.rawSummary ?? thread.whyItMatters

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/50"
      onClick={() => router.push(`/operator-studio/threads/${thread.id}`)}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium leading-snug line-clamp-2">
            {title}
          </CardTitle>
          <div className="flex shrink-0 gap-1">
            <SourceAppToken source={thread.sourceApp} size="sm" />
            <Badge
              variant="secondary"
              className={`text-[10px] px-1.5 py-0 h-5 font-normal ${
                REVIEW_STATE_COLORS[thread.reviewState] ?? ""
              }`}
            >
              {REVIEW_STATE_LABELS[thread.reviewState] ?? thread.reviewState}
            </Badge>
          </div>
        </div>
        {summary && (
          <CardDescription className="text-xs line-clamp-2 mt-1">
            {summary}
          </CardDescription>
        )}
        {thread.captureReason && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] italic text-muted-foreground">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{thread.captureReason}</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{thread.messageCount} messages</span>
          {thread.ownerName && <span>by {thread.ownerName}</span>}
          <span className="ml-auto">
            {new Date(thread.importedAt).toLocaleDateString()}
          </span>
        </div>
        {thread.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {thread.tags.slice(0, 4).map((tag) => (
              <Link
                key={tag}
                href={`/operator-studio/search?tag=${encodeURIComponent(tag)}`}
                onClick={(e) => e.stopPropagation()}
              >
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-4 hover:border-foreground/40 hover:text-foreground cursor-pointer"
                >
                  #{tag}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Thread Row (Observatory Focus V4 inspired) ─────────────────────────────

function ThreadRow({ thread }: { thread: OperatorThread }) {
  const router = useRouter()
  const title =
    thread.promotedTitle ?? thread.rawTitle ?? "Untitled thread"

  return (
    <button
      className="w-full grid grid-cols-1 md:grid-cols-[minmax(0,2.5fr)_7rem_7rem_5rem_5.5rem_6rem] gap-1 md:gap-2 items-center px-3 py-2.5 text-left transition-colors hover:bg-accent/50 group"
      onClick={() => router.push(`/operator-studio/threads/${thread.id}`)}
    >
      {/* Thread title + project */}
      <div className="min-w-0 flex items-center gap-2">
        <SourceAppAvatar source={thread.sourceApp} />
        <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
          {title}
        </span>
        {thread.projectSlug && (
          <Badge
            variant="outline"
            className="shrink-0 text-[9px] px-1 py-0 h-4 hidden lg:inline-flex"
          >
            {thread.projectSlug}
          </Badge>
        )}
      </div>

      {/* Source app badge */}
      <div className="hidden md:block">
        <SourceAppToken source={thread.sourceApp} size="sm" />
      </div>

      {/* Review state */}
      <div className="hidden md:block">
        <Badge
          variant="secondary"
          className={`text-[10px] px-1.5 py-0 h-5 font-normal ${
            REVIEW_STATE_COLORS[thread.reviewState] ?? ""
          }`}
        >
          {REVIEW_STATE_LABELS[thread.reviewState] ?? thread.reviewState}
        </Badge>
      </div>

      {/* Turn count */}
      <span className="hidden md:block text-xs tabular-nums text-muted-foreground text-right">
        {thread.messageCount}
      </span>

      {/* Operator */}
      <span className="hidden md:block text-xs text-muted-foreground truncate">
        {thread.ownerName ?? thread.importedBy}
      </span>

      {/* Imported date */}
      <span className="hidden md:block text-[11px] tabular-nums text-muted-foreground text-right">
        {relativeTime(thread.importedAt)}
      </span>

      {/* Mobile: inline metadata */}
      <div className="flex md:hidden items-center gap-2 text-[11px] text-muted-foreground">
        <SourceAppToken source={thread.sourceApp} size="sm" />
        <Badge
          variant="secondary"
          className={`text-[9px] px-1 py-0 h-4 font-normal ${
            REVIEW_STATE_COLORS[thread.reviewState] ?? ""
          }`}
        >
          {REVIEW_STATE_LABELS[thread.reviewState] ?? thread.reviewState}
        </Badge>
        <span>{thread.messageCount} turns</span>
        <span className="ml-auto">{relativeTime(thread.importedAt)}</span>
      </div>
    </button>
  )
}

// ─── Relative Time ───────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString()
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  accent?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            accent
              ? `bg-${accent}-500/10 text-${accent}-600 dark:text-${accent}-400`
              : "bg-primary/10 text-primary"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Promoted Gallery (unified threads + messages) ─────────────────────────

import { MarkdownProse } from "./markdown-prose"

function PromotedGallery({
  promotedThreads,
}: {
  promotedThreads: OperatorThread[]
}) {
  const router = useRouter()
  const [promotedMessages, setPromotedMessages] = React.useState<
    (OperatorThreadMessage & { threadTitle: string | null })[]
  >([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    fetch("/api/operator-studio/messages?promoted=true")
      .then((r) => r.json())
      .then((data) => {
        setPromotedMessages(data.messages ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const isEmpty = promotedThreads.length === 0 && promotedMessages.length === 0

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold flex-1 flex items-center gap-2">
          <Star className="h-5 w-5 text-emerald-500" />
          Promoted
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/operator-studio")}
        >
          Back to Dashboard
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : isEmpty ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Star className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              Nothing promoted yet. Promote threads from the review flow, or promote individual messages that are straight fire.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Promoted threads */}
          {promotedThreads.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <Star className="size-3.5 text-emerald-500" />
                Threads
                <span className="ml-1 tabular-nums text-[10px] text-muted-foreground/50">
                  {promotedThreads.length}
                </span>
              </h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {promotedThreads.map((t) => (
                  <ThreadCard key={t.id} thread={t} />
                ))}
              </div>
            </section>
          )}

          {/* Promoted messages */}
          {promotedMessages.length > 0 && (
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
                <Flame className="size-3.5 text-orange-500" />
                Messages
                <span className="ml-1 tabular-nums text-[10px] text-muted-foreground/50">
                  {promotedMessages.length}
                </span>
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {promotedMessages.map((msg) => (
                  <Card
                    key={msg.id}
                    className="cursor-pointer transition-colors hover:bg-accent/50"
                    onClick={() => router.push(`/operator-studio/threads/${msg.threadId}`)}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="secondary"
                            className={`text-[10px] px-1.5 py-0 h-5 font-normal ${
                              PROMOTION_KIND_COLORS[msg.promotionKind!] ?? ""
                            }`}
                          >
                            {PROMOTION_KIND_EMOJI[msg.promotionKind!]}{" "}
                            {PROMOTION_KIND_LABELS[msg.promotionKind!] ?? "Promoted"}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-normal">
                            {msg.role}
                          </Badge>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {msg.promotedBy} · {new Date(msg.promotedAt!).toLocaleDateString()}
                        </span>
                      </div>
                      {msg.threadTitle && (
                        <p className="text-[11px] text-muted-foreground mt-1 truncate">
                          from: {msg.threadTitle}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent>
                      <MarkdownProse
                        content={
                          msg.content.length > 400
                            ? msg.content.slice(0, 400) + "…"
                            : msg.content
                        }
                        className="text-sm"
                      />
                      {msg.promotionNote && (
                        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 border-t border-amber-500/20 pt-1.5">
                          "{msg.promotionNote}"
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Import Dialog ───────────────────────────────────────────────────────────

interface DiscoveredSession {
  sourceThreadId: string
  title: string
  messageCount: number
  filePath: string | null
  projectHint: string | null
  createdAt: string | null
  lastActivityAt: string | null
  sourceApp: string
}

function ImportDialog() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [mode, setMode] = React.useState<"discover" | "paste">("discover")
  const [source, setSource] = React.useState<string>("claude")

  // Discovery state
  const [discovering, setDiscovering] = React.useState(false)
  const [discovered, setDiscovered] = React.useState<DiscoveredSession[] | null>(null)
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Import state
  const [importing, setImporting] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)

  // Paste state
  const [pasteTitle, setPasteTitle] = React.useState("")
  const [pasteContent, setPasteContent] = React.useState("")

  const resetDiscovery = () => {
    setDiscovered(null)
    setSelected(new Set())
    setResult(null)
  }

  const handleDiscover = async () => {
    setDiscovering(true)
    setResult(null)
    setDiscovered(null)
    setSelected(new Set())
    try {
      const res = await fetch(`/api/operator-studio/discover?source=${source}`)
      const data = await res.json()
      if (data.error) {
        setResult(data.error)
      } else {
        setDiscovered(data.sessions ?? [])
        if ((data.sessions ?? []).length === 0) {
          setResult("No sessions found. Check that the source app has conversation files on disk.")
        }
      }
    } catch {
      setResult("Discovery failed.")
    } finally {
      setDiscovering(false)
    }
  }

  const toggleSession = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (!discovered) return
    if (selected.size === discovered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(discovered.map((s) => s.sourceThreadId)))
    }
  }

  const handleImportSelected = async () => {
    if (!discovered) return
    const filePaths = discovered
      .filter((s) => selected.has(s.sourceThreadId) && s.filePath)
      .map((s) => s.filePath!)

    if (filePaths.length === 0) {
      setResult("No sessions selected.")
      return
    }

    setImporting(true)
    setResult(null)
    try {
      const res = await fetch("/api/operator-studio/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          filePaths,
          importedBy:
            localStorage.getItem("operator_studio_reviewer") ?? "operator",
        }),
      })
      const data = await res.json()
      setResult(
        `Imported ${data.threadCount} thread(s) as private.${
          data.errors?.length ? ` ${data.errors.length} error(s).` : ""
        } Review and promote them from the dashboard.`
      )
      if (data.threadCount > 0) {
        setTimeout(() => {
          setOpen(false)
          resetDiscovery()
          router.refresh()
        }, 2000)
      }
    } catch {
      setResult("Import failed.")
    } finally {
      setImporting(false)
    }
  }

  const handlePaste = async () => {
    setImporting(true)
    setResult(null)
    try {
      // Let the server do the parsing — the /ingest endpoint accepts JSON,
      // plain transcripts (User:/Assistant: labels), markdown with headings,
      // or any provider's structured response (Gemini, OpenAI, Claude,
      // ChatGPT share exports). See the "Ingesting from anywhere" docs
      // section for the full format list.
      const params = new URLSearchParams()
      if (pasteTitle.trim()) params.set("title", pasteTitle.trim())
      params.set("source", source || "manual")
      const reviewer = localStorage.getItem("operator_studio_reviewer")
      if (reviewer) params.set("importedBy", reviewer)

      const looksJson =
        pasteContent.trim().startsWith("{") ||
        pasteContent.trim().startsWith("[")

      const res = await fetch(
        `/api/operator-studio/ingest?${params.toString()}`,
        {
          method: "POST",
          headers: {
            "Content-Type": looksJson ? "application/json" : "text/plain",
          },
          body: pasteContent,
        }
      )
      const data = await res.json()
      if (data.ok) {
        setResult(
          `Imported ${data.messageCount} turn(s) as ${data.detectedFormat}. Thread is private — promote from the dashboard.`
        )
        setTimeout(() => {
          setOpen(false)
          router.refresh()
        }, 1800)
      } else {
        setResult(`Import failed: ${data.error}${data.detail ? ` — ${data.detail}` : ""}`)
      }
    } catch (err) {
      setResult(
        `Import failed: ${err instanceof Error ? err.message : "unknown error"}`
      )
    } finally {
      setImporting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) resetDiscovery()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="mr-2 h-3.5 w-3.5" />
          Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Operator Threads</DialogTitle>
          <DialogDescription>
            Discover sessions, pick the ones you want, and import them as private. Promote later from the dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mb-4">
          <Button
            variant={mode === "discover" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setMode("discover")
              resetDiscovery()
            }}
          >
            <Search className="mr-1.5 h-3.5 w-3.5" />
            Discover
          </Button>
          <Button
            variant={mode === "paste" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setMode("paste")
              resetDiscovery()
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Paste
          </Button>
        </div>

        <div className="space-y-4 flex-1 overflow-y-auto min-h-0">
          {/* Source selector */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Source</Label>
              <SourceAppToken source={source} size="sm" />
            </div>
            <Select
              value={source}
              onValueChange={(v) => {
                setSource(v)
                resetDiscovery()
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude Code</SelectItem>
                <SelectItem value="codex">Codex</SelectItem>
                <SelectItem value="cursor">Cursor</SelectItem>
                <SelectItem value="antigravity">Antigravity</SelectItem>
                <SelectItem value="void">Void</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Discover is live for Claude Code and Codex today. The other lanes stay visible here so the import surface matches the roadmap.
            </p>
          </div>

          {/* Discover mode: initial scan prompt */}
          {mode === "discover" && !discovered && (
            <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed rounded-lg">
              <Search className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-4">
                Scan your machine for {SOURCE_APP_LABELS[source as OperatorSourceApp] ?? source} sessions
              </p>
              <Button onClick={handleDiscover} disabled={discovering}>
                {discovering ? (
                  <>
                    <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Scanning…
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-3.5 w-3.5" />
                    Discover Sessions
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Discover mode: session list with checkboxes */}
          {mode === "discover" && discovered && discovered.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">
                  Found {discovered.length} session{discovered.length !== 1 ? "s" : ""}
                </Label>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={toggleAll}
                >
                  {selected.size === discovered.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>
              <div className="border rounded-lg divide-y max-h-[40vh] overflow-y-auto">
                {discovered.map((session, idx) => (
                  <button
                    key={`${session.sourceThreadId}-${idx}`}
                    type="button"
                    className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-accent/50 cursor-pointer transition-colors text-left"
                    onClick={() => toggleSession(session.sourceThreadId)}
                  >
                    <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-sm border flex items-center justify-center transition-colors ${
                      selected.has(session.sourceThreadId)
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-muted-foreground/30"
                    }`}>
                      {selected.has(session.sourceThreadId) && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {session.title}
                      </p>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span>{session.messageCount} messages</span>
                        {session.projectHint && (
                          <>
                            <span className="text-muted-foreground/30">|</span>
                            <span className="truncate">
                              {session.projectHint}
                            </span>
                          </>
                        )}
                        {session.lastActivityAt && (
                          <>
                            <span className="text-muted-foreground/30">|</span>
                            <span>
                              {relativeTime(session.lastActivityAt)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {selected.size > 0 && (
                <p className="text-xs text-muted-foreground">
                  {selected.size} selected — will be imported as private to you
                </p>
              )}
            </div>
          )}

          {/* Paste mode */}
          {mode === "paste" && (
            <>
              <div className="space-y-2">
                <Label>Title (optional)</Label>
                <Input
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Thread title"
                />
              </div>
              <div className="space-y-2">
                <Label>Conversation</Label>
                <Textarea
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder={`Paste anything — Gemini, ChatGPT, Claude, OpenAI responses, or a transcript like:\n\nUser: how do I...\nAssistant: you can...\n\nStructured JSON, JSONL, and markdown with headings also work.`}
                  rows={10}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  The importer autodetects format. Nothing matches? The whole
                  blob is ingested as one message so you never lose the paste.
                </p>
              </div>
            </>
          )}

          {result && (
            <p className="text-sm text-muted-foreground">{result}</p>
          )}
        </div>

        <DialogFooter>
          {mode === "discover" && discovered && discovered.length > 0 && (
            <Button variant="ghost" size="sm" onClick={resetDiscovery} className="mr-auto">
              Re-scan
            </Button>
          )}
          {mode === "discover" ? (
            discovered && discovered.length > 0 ? (
              <Button
                onClick={handleImportSelected}
                disabled={importing || selected.size === 0}
              >
                {importing ? (
                  <>
                    <div className="mr-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Importing…
                  </>
                ) : (
                  `Import ${selected.size} Selected`
                )}
              </Button>
            ) : null
          ) : (
            <Button
              onClick={handlePaste}
              disabled={importing || !pasteContent.trim()}
            >
              {importing ? "Importing…" : "Import Pasted Thread"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
