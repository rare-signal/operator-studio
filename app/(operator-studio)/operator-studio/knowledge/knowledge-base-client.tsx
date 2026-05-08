"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowPath,
  ArrowRight,
  CheckBadge,
  CheckCircle,
  ClipboardDocumentCheck,
  Clock,
  DocumentDuplicate,
  DocumentMagnifyingGlass,
  DocumentText,
  ExclamationTriangle,
  LightBulb,
  Link as LinkIcon,
  MagnifyingGlass,
  PencilSquare,
  Plus,
  ShieldCheck,
  Sparkles,
  Squares2x2,
  Star,
  Tag,
  User,
  Calculator,
  ChartBar,
  Scale,
} from "./kb-icons"
import { MarkdownProse } from "../components/markdown-prose"
import {
  KB_ENTRY_TYPES,
  KB_STABILITIES,
  type KbEntry,
  type KbEntryType,
  type KbStability,
} from "@/lib/operator-studio/knowledge"

// ─── Type taxonomy + presentation ──────────────────────────────────────
//
// 1:1 with AIDA Observatory intelligence/memory. Order matches the
// screenshots' Browse-by-Category grid.

interface TypeMeta {
  value: KbEntryType
  label: string
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  cardClass: string
  iconColor: string
  badgeClass: string
}

const TYPE_META: TypeMeta[] = [
  {
    value: "concept",
    label: "Concepts",
    Icon: LightBulb,
    cardClass: "bg-blue-50 dark:bg-blue-900/20",
    iconColor: "text-blue-600 dark:text-blue-400",
    badgeClass:
      "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
  },
  {
    value: "pattern",
    label: "Patterns",
    Icon: ChartBar,
    cardClass: "bg-emerald-50 dark:bg-emerald-900/20",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    badgeClass:
      "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  },
  {
    value: "metric",
    label: "Metrics",
    Icon: Calculator,
    cardClass: "bg-emerald-50 dark:bg-emerald-900/20",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    badgeClass:
      "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  },
  {
    value: "procedure",
    label: "Procedures",
    Icon: DocumentText,
    cardClass: "bg-slate-50 dark:bg-slate-800",
    iconColor: "text-slate-600 dark:text-slate-300",
    badgeClass: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400",
  },
  {
    value: "agent",
    label: "Agent Profiles",
    Icon: User,
    cardClass: "bg-orange-50 dark:bg-orange-900/20",
    iconColor: "text-orange-600 dark:text-orange-400",
    badgeClass:
      "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  },
  {
    value: "comparison",
    label: "Comparisons",
    Icon: Scale,
    cardClass: "bg-indigo-50 dark:bg-indigo-900/20",
    iconColor: "text-indigo-600 dark:text-indigo-400",
    badgeClass:
      "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400",
  },
  {
    value: "anomaly",
    label: "Anomalies",
    Icon: ExclamationTriangle,
    cardClass: "bg-rose-50 dark:bg-rose-900/20",
    iconColor: "text-rose-600 dark:text-rose-400",
    badgeClass:
      "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  },
  {
    value: "todo",
    label: "TODOs",
    Icon: ClipboardDocumentCheck,
    cardClass: "bg-amber-50 dark:bg-amber-900/20",
    iconColor: "text-amber-600 dark:text-amber-400",
    badgeClass:
      "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400",
  },
]

const TYPE_BY_VALUE: Record<KbEntryType, TypeMeta> = TYPE_META.reduce(
  (acc, t) => {
    acc[t.value] = t
    return acc
  },
  {} as Record<KbEntryType, TypeMeta>
)

interface StabilityMeta {
  value: KbStability
  label: string
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  textColor: string
}

const STABILITY_META: StabilityMeta[] = [
  {
    value: "evergreen",
    label: "Evergreen",
    Icon: ShieldCheck,
    textColor: "text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "stable",
    label: "Stable",
    Icon: CheckBadge,
    textColor: "text-blue-600 dark:text-blue-400",
  },
  {
    value: "fluctuant",
    label: "Auto-updating",
    Icon: ArrowPath,
    textColor: "text-orange-600 dark:text-orange-400",
  },
  {
    value: "draft",
    label: "Draft",
    Icon: PencilSquare,
    textColor: "text-stone-500 dark:text-stone-400",
  },
]

const STABILITY_BY_VALUE: Record<KbStability, StabilityMeta> =
  STABILITY_META.reduce(
    (acc, s) => {
      acc[s.value] = s
      return acc
    },
    {} as Record<KbStability, StabilityMeta>
  )

// ─── Date helpers ────────────────────────────────────────────────────

function formatDate(date: string | null | undefined): string {
  if (!date) return "Never"
  const d = new Date(date)
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function formatRelativeTime(date: string | null | undefined): string {
  if (!date) return ""
  const d = new Date(date)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString()
}

// ─── Entry form (create/edit) ────────────────────────────────────────

interface EntryFormState {
  title: string
  summary: string
  bodyMarkdown: string
  entryType: KbEntryType
  stability: KbStability
  tagsCsv: string
}

const BLANK_FORM: EntryFormState = {
  title: "",
  summary: "",
  bodyMarkdown: "",
  entryType: "concept",
  stability: "draft",
  tagsCsv: "",
}

// ─── Component ───────────────────────────────────────────────────────

export function KnowledgeBaseClient({
  workspaceId,
  initialEnabled,
  initialEntries,
  initialSelectedId,
}: {
  workspaceId: string
  initialEnabled: boolean
  initialEntries: KbEntry[]
  initialSelectedId: string | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlEntry = searchParams.get("entry")

  const [enabled, setEnabled] = React.useState(initialEnabled)
  const [entries, setEntries] = React.useState<KbEntry[]>(initialEntries)
  const [selectedId, setSelectedIdState] = React.useState<string | null>(
    initialSelectedId
  )

  // Keep state in sync if the URL changes externally (back/forward, sidebar nav).
  React.useEffect(() => {
    setSelectedIdState(urlEntry)
  }, [urlEntry])

  // Single setter that also pushes a history entry so deep links work.
  const setSelectedId = React.useCallback(
    (next: string | null) => {
      setSelectedIdState(next)
      const url = next
        ? `/operator-studio/knowledge?entry=${encodeURIComponent(next)}`
        : "/operator-studio/knowledge"
      router.replace(url, { scroll: false })
    },
    [router]
  )

  const [searchQuery, setSearchQuery] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState<"all" | KbEntryType>(
    "all"
  )
  const [stabilityFilter, setStabilityFilter] = React.useState<
    "all" | KbStability
  >("all")
  const [tagFilter, setTagFilter] = React.useState<string>("")

  const [showEntryModal, setShowEntryModal] = React.useState(false)
  const [isEditing, setIsEditing] = React.useState(false)
  const [form, setForm] = React.useState<EntryFormState>(BLANK_FORM)
  const [saving, setSaving] = React.useState(false)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)

  const selectedEntry = React.useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId]
  )

  // Apply filters
  const filteredEntries = React.useMemo(() => {
    let result = entries
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.summary.toLowerCase().includes(q) ||
          e.bodyMarkdown.toLowerCase().includes(q) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    if (typeFilter !== "all") {
      result = result.filter((e) => e.entryType === typeFilter)
    }
    if (stabilityFilter !== "all") {
      result = result.filter((e) => e.stability === stabilityFilter)
    }
    if (tagFilter) {
      result = result.filter((e) => e.tags.includes(tagFilter))
    }
    return result
  }, [entries, searchQuery, typeFilter, stabilityFilter, tagFilter])

  const allTags = React.useMemo(() => {
    const set = new Set<string>()
    entries.forEach((e) => e.tags.forEach((t) => set.add(t)))
    return Array.from(set).sort()
  }, [entries])

  const tagCounts = React.useMemo(() => {
    const counts: Record<string, number> = {}
    entries.forEach((e) => e.tags.forEach((t) => (counts[t] = (counts[t] || 0) + 1)))
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
  }, [entries])

  const fluctuantEntries = React.useMemo(
    () => entries.filter((e) => e.stability === "fluctuant"),
    [entries]
  )
  const featuredEntry = React.useMemo(
    () =>
      entries.find(
        (e) => e.stability === "evergreen" || e.stability === "stable"
      ) ?? null,
    [entries]
  )
  const recentActivity = React.useMemo(
    () =>
      [...entries]
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )
        .slice(0, 5),
    [entries]
  )

  // ── Actions ──────────────────────────────────────────────────────

  async function reloadEntries() {
    try {
      const r = await fetch("/api/operator-studio/knowledge", {
        cache: "no-store",
      })
      if (!r.ok) throw new Error("load failed")
      const data = (await r.json()) as { entries: KbEntry[] }
      setEntries(data.entries ?? [])
    } catch (err) {
      // keep existing entries on transient failure
      console.error("reloadEntries failed", err)
    }
  }

  async function enableModule() {
    setErrorMessage(null)
    const r = await fetch("/api/operator-studio/knowledge/module", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    })
    if (!r.ok) {
      setErrorMessage("Could not enable Knowledge Base module.")
      return
    }
    setEnabled(true)
    await reloadEntries()
  }

  function openCreateModal() {
    setIsEditing(false)
    setForm(BLANK_FORM)
    setShowEntryModal(true)
  }

  function openEditModal() {
    if (!selectedEntry) return
    setIsEditing(true)
    setForm({
      title: selectedEntry.title,
      summary: selectedEntry.summary,
      bodyMarkdown: selectedEntry.bodyMarkdown,
      entryType: selectedEntry.entryType,
      stability: selectedEntry.stability,
      tagsCsv: selectedEntry.tags.join(", "),
    })
    setShowEntryModal(true)
  }

  async function saveEntry() {
    setSaving(true)
    setErrorMessage(null)
    try {
      const tagsArray = form.tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)

      const payload: Record<string, unknown> = {
        title: form.title,
        summary: form.summary,
        body_markdown: form.bodyMarkdown,
        entry_type: form.entryType,
        stability: form.stability,
        tags: tagsArray,
      }

      if (isEditing && selectedEntry) {
        payload.id = selectedEntry.id
      }

      const r = await fetch(
        isEditing && selectedEntry
          ? `/api/operator-studio/knowledge/${encodeURIComponent(selectedEntry.id)}`
          : "/api/operator-studio/knowledge",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as
          | { error?: string }
          | null
        setErrorMessage(data?.error ?? "Could not save entry.")
        return
      }
      const data = (await r.json()) as { entry: KbEntry }
      await reloadEntries()
      setSelectedId(data.entry.id)
      setShowEntryModal(false)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  if (!enabled) {
    return (
      <DisabledModulePrompt
        workspaceId={workspaceId}
        onEnable={enableModule}
        errorMessage={errorMessage}
      />
    )
  }

  const totalEntries = entries.length
  const totalCitations = entries.reduce(
    (acc, e) => acc + (e.citations?.length ?? 0),
    0
  )
  const userEdits = entries.filter((e) => e.lastUserEditAt).length

  return (
    <div className="h-full flex bg-stone-50 dark:bg-stone-950">
      {errorMessage && (
        <div className="absolute top-4 right-4 z-50 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          {errorMessage}
        </div>
      )}

      {/* ── Sidebar (entry list + filters) ─────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 flex flex-col">
        {/* Search */}
        <div className="p-4 border-b border-stone-200 dark:border-stone-800">
          <div className="relative">
            <MagnifyingGlass className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="Search knowledge..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-stone-100 dark:bg-stone-800 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="p-4 space-y-3 border-b border-stone-200 dark:border-stone-800">
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as "all" | KbEntryType)
            }
            className="w-full text-sm bg-stone-100 dark:bg-stone-800 border-0 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Types</option>
            {TYPE_META.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            value={stabilityFilter}
            onChange={(e) =>
              setStabilityFilter(e.target.value as "all" | KbStability)
            }
            className="w-full text-sm bg-stone-100 dark:bg-stone-800 border-0 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All</option>
            {STABILITY_META.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="w-full text-sm bg-stone-100 dark:bg-stone-800 border-0 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Tags</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Entry List grouped by type */}
        <div className="flex-1 overflow-y-auto">
          {TYPE_META.map((type) => {
            const typeEntries = filteredEntries.filter(
              (e) => e.entryType === type.value
            )
            if (typeEntries.length === 0) return null
            const Icon = type.Icon
            return (
              <div key={type.value}>
                <div className="px-4 pt-4 pb-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-stone-500 dark:text-stone-400 uppercase tracking-wide">
                    <Icon className="size-3" />
                    {type.label}
                    <span className="ml-auto text-stone-400">
                      {typeEntries.length}
                    </span>
                  </div>
                </div>
                <div className="px-2 space-y-1">
                  {typeEntries.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors ${
                        selectedId === entry.id
                          ? "bg-emerald-50 dark:bg-emerald-900/20"
                          : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone-900 dark:text-stone-100 truncate flex-1">
                          {entry.title}
                        </span>
                        {entry.stability === "fluctuant" && (
                          <ArrowPath className="size-3 text-orange-500 shrink-0" />
                        )}
                        {entry.stability === "draft" && (
                          <PencilSquare className="size-3 text-stone-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-xs text-stone-500 dark:text-stone-400 truncate mt-0.5">
                        {entry.summary
                          ? entry.summary.slice(0, 60) +
                            (entry.summary.length > 60 ? "…" : "")
                          : "—"}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {filteredEntries.length === 0 && (
            <div className="p-4 text-center text-stone-500 dark:text-stone-400">
              <DocumentMagnifyingGlass className="size-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No entries found</p>
            </div>
          )}
        </div>

        {/* Stats footer */}
        <div className="p-4 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950">
          <div className="text-xs text-stone-500 dark:text-stone-400 space-y-1">
            <div className="flex justify-between">
              <span>Total entries</span>
              <span className="font-medium tabular-nums">{totalEntries}</span>
            </div>
            <div className="flex justify-between">
              <span>Auto-updating</span>
              <span className="font-medium tabular-nums">
                {fluctuantEntries.length}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto bg-stone-50 dark:bg-stone-950">
        {selectedEntry ? (
          <EntryDetail
            entry={selectedEntry}
            allEntries={entries}
            onSelectEntry={(id) => setSelectedId(id)}
            onTagClick={(t) => setTagFilter(t)}
            onEdit={openEditModal}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <Home
            entries={entries}
            featuredEntry={featuredEntry}
            fluctuantEntries={fluctuantEntries}
            recentActivity={recentActivity}
            tagCounts={tagCounts}
            totalCitations={totalCitations}
            userEdits={userEdits}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onTypeFilter={(t) => setTypeFilter(t)}
            onTagFilter={(t) => setTagFilter(t)}
            onSelectEntry={(id) => setSelectedId(id)}
            onCreate={openCreateModal}
          />
        )}
      </main>

      {/* ── Entry modal ──────────────────────────────────────────── */}
      {showEntryModal && (
        <EntryModal
          form={form}
          isEditing={isEditing}
          saving={saving}
          onChange={setForm}
          onClose={() => setShowEntryModal(false)}
          onSave={saveEntry}
        />
      )}
    </div>
  )
}

// ─── Disabled module prompt ─────────────────────────────────────────────

function DisabledModulePrompt({
  workspaceId,
  onEnable,
  errorMessage,
}: {
  workspaceId: string
  onEnable: () => void
  errorMessage: string | null
}) {
  return (
    <div className="h-full flex items-center justify-center bg-stone-50 dark:bg-stone-950">
      <div className="max-w-md text-center px-8">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-6">
          <Sparkles className="size-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-3">
          Knowledge Base — your synthetic Wikipedia
        </h1>
        <p className="text-stone-600 dark:text-stone-400 mb-8 leading-relaxed">
          Optional module. When enabled, the agent (Wayseer or your coding
          assistant) reads your most recent promoted highlights and starts
          fleshing them out into a browsable, encyclopedic knowledge base of
          your project&apos;s own state of mind. You can hand-write entries
          too. Disabled by default per workspace.
        </p>
        <button
          onClick={onEnable}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-lg shadow-emerald-900/20 inline-flex items-center gap-2"
        >
          <Plus className="size-4" />
          Enable for &ldquo;{workspaceId}&rdquo;
        </button>
        {errorMessage && (
          <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Home (no entry selected) ───────────────────────────────────────────

function Home({
  entries,
  featuredEntry,
  fluctuantEntries,
  recentActivity,
  tagCounts,
  totalCitations,
  userEdits,
  searchQuery,
  onSearchChange,
  onTypeFilter,
  onTagFilter,
  onSelectEntry,
  onCreate,
}: {
  entries: KbEntry[]
  featuredEntry: KbEntry | null
  fluctuantEntries: KbEntry[]
  recentActivity: KbEntry[]
  tagCounts: Array<{ tag: string; count: number }>
  totalCitations: number
  userEdits: number
  searchQuery: string
  onSearchChange: (s: string) => void
  onTypeFilter: (t: "all" | KbEntryType) => void
  onTagFilter: (t: string) => void
  onSelectEntry: (id: string) => void
  onCreate: () => void
}) {
  return (
    <div className="min-h-full pb-12">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-800 dark:from-emerald-950 dark:via-teal-950 dark:to-slate-950 px-8 py-20 text-white shadow-inner">
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
          <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-teal-400/20 blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-400/10 backdrop-blur-md border border-emerald-400/20 text-sm font-medium mb-6 text-emerald-50">
            <Sparkles className="size-4 text-emerald-300" />
            <span>Living Wikipedia of Agentic Insights</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight text-white">
            Knowledge Base
          </h1>
          <p className="text-lg text-emerald-50/80 mb-10 max-w-2xl mx-auto leading-relaxed">
            Explore the collective intelligence discovered from thousands of
            transcript analyses. Search for specific topics or browse by
            category below.
          </p>
          <div className="relative max-w-2xl mx-auto mb-12 group">
            <MagnifyingGlass className="size-6 absolute left-5 top-1/2 -translate-y-1/2 text-emerald-300 group-focus-within:text-white transition-colors" />
            <input
              type="text"
              placeholder="What would you like to learn today?"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-14 pr-6 py-5 bg-slate-900/40 backdrop-blur-md border border-emerald-500/30 rounded-2xl text-xl text-white placeholder-emerald-200/50 focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:bg-slate-900/60 transition-all shadow-2xl"
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
            <StatCard label="Validated Entries" value={entries.length} />
            <StatCard
              label="Live Metrics"
              value={fluctuantEntries.length}
              pulseDot
            />
            <StatCard label="Citations" value={totalCitations} />
            <StatCard label="User Edits" value={userEdits} />
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-8 -mt-10 relative z-10">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left col */}
          <div className="lg:col-span-2 space-y-8 pt-28">
            {featuredEntry && (
              <FeaturedKnowledge
                entry={featuredEntry}
                onSelect={() => onSelectEntry(featuredEntry.id)}
              />
            )}

            {fluctuantEntries.length > 0 && (
              <LiveMetrics
                entries={fluctuantEntries.slice(0, 4)}
                onSelect={(id) => onSelectEntry(id)}
              />
            )}

            <BrowseByCategory
              entries={entries}
              onSelectType={(t) => onTypeFilter(t)}
            />
          </div>

          {/* Right col */}
          <div className="space-y-8">
            <ContributeCta onCreate={onCreate} />
            <RecentActivity
              entries={recentActivity}
              onSelect={(id) => onSelectEntry(id)}
            />
            <PopularTags
              tagCounts={tagCounts}
              onTagClick={(t) => onTagFilter(t)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  pulseDot = false,
}: {
  label: string
  value: number
  pulseDot?: boolean
}) {
  return (
    <div className="px-4 py-3 rounded-xl bg-white/5 backdrop-blur-sm border border-white/10">
      <div className="text-2xl font-bold flex items-center justify-center gap-2 tabular-nums">
        {value}
        {pulseDot && (
          <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
        )}
      </div>
      <div className="text-xs text-emerald-200 uppercase tracking-wider font-semibold">
        {label}
      </div>
    </div>
  )
}

function FeaturedKnowledge({
  entry,
  onSelect,
}: {
  entry: KbEntry
  onSelect: () => void
}) {
  const meta = TYPE_BY_VALUE[entry.entryType]
  const Icon = meta.Icon
  return (
    <section>
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-widest flex items-center gap-2">
          <Star className="size-4 text-amber-500" />
          Featured Knowledge
        </h2>
      </div>
      <button
        onClick={onSelect}
        className="w-full text-left bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-8 shadow-sm hover:shadow-xl hover:border-emerald-300 dark:hover:border-emerald-900/50 transition-all group"
      >
        <div className="flex flex-col md:flex-row gap-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
            <Icon className="size-8 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded-full ${meta.badgeClass}`}
              >
                {entry.entryType}
              </span>
              {entry.lastVerifiedAt && (
                <span className="text-xs text-stone-400 flex items-center gap-1">
                  <CheckCircle className="size-3" />
                  Verified {formatDate(entry.lastVerifiedAt)}
                </span>
              )}
            </div>
            <h3 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-3 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              {entry.title}
            </h3>
            <p className="text-stone-600 dark:text-stone-400 leading-relaxed mb-4">
              {entry.summary || "—"}
            </p>
            <div className="flex items-center gap-4 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <span>Read full entry</span>
              <ArrowRight className="size-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </div>
      </button>
    </section>
  )
}

function LiveMetrics({
  entries,
  onSelect,
}: {
  entries: KbEntry[]
  onSelect: (id: string) => void
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-widest flex items-center gap-2">
          <ArrowPath className="size-4 text-orange-500 [animation:spin_8s_linear_infinite]" />
          Live Metrics
        </h2>
        <span className="text-xs text-orange-600 dark:text-orange-400 font-medium px-2 py-1 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
          Auto-updating insights
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {entries.map((entry) => {
          const Icon = TYPE_BY_VALUE[entry.entryType].Icon
          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className="flex items-start gap-4 p-5 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 hover:border-orange-300 dark:hover:border-orange-900/50 shadow-sm hover:shadow-md transition-all text-left group"
            >
              <div className="w-10 h-10 rounded-lg bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center shrink-0">
                <Icon className="size-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-bold text-stone-900 dark:text-stone-100 mb-1 truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                  {entry.title}
                </h4>
                <p className="text-xs text-stone-500 dark:text-stone-400 line-clamp-2 mb-2">
                  {entry.summary || "—"}
                </p>
                <div className="flex items-center gap-2 text-[10px] font-medium text-stone-400">
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    Updated {formatRelativeTime(entry.updatedAt)}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function BrowseByCategory({
  entries,
  onSelectType,
}: {
  entries: KbEntry[]
  onSelectType: (t: KbEntryType) => void
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-widest flex items-center gap-2">
          <Squares2x2 className="size-4 text-emerald-500" />
          Browse by Category
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {TYPE_META.map((type) => {
          const count = entries.filter((e) => e.entryType === type.value).length
          const Icon = type.Icon
          return (
            <button
              key={type.value}
              onClick={() => onSelectType(type.value)}
              className="flex flex-col items-center text-center p-4 bg-white dark:bg-stone-900 rounded-xl border border-stone-200 dark:border-stone-800 hover:border-emerald-300 dark:hover:border-emerald-900/50 shadow-sm hover:shadow-md transition-all group"
            >
              <div
                className={`w-12 h-12 rounded-full mb-3 flex items-center justify-center transition-transform group-hover:scale-110 ${type.cardClass}`}
              >
                <Icon className={`size-6 ${type.iconColor}`} />
              </div>
              <div className="font-bold text-stone-900 dark:text-stone-100 text-sm mb-1">
                {type.label}
              </div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                {count} {count === 1 ? "entry" : "entries"}
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function ContributeCta({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="p-6 bg-stone-900 dark:bg-emerald-900/40 rounded-2xl text-white shadow-lg border border-white/10">
      <h3 className="font-bold text-lg mb-2">Contribute Knowledge</h3>
      <p className="text-emerald-50/60 text-sm mb-4">
        Add a new concept, pattern, or procedure to the intelligence base.
      </p>
      <button
        onClick={onCreate}
        className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-500 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
      >
        <Plus className="size-5" />
        Create New Entry
      </button>
    </div>
  )
}

function RecentActivity({
  entries,
  onSelect,
}: {
  entries: KbEntry[]
  onSelect: (id: string) => void
}) {
  return (
    <section className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 overflow-hidden shadow-sm">
      <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-950/50">
        <h2 className="text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-widest flex items-center gap-2">
          <Clock className="size-4 text-stone-500" />
          Recent Activity
        </h2>
      </div>
      <div className="divide-y divide-stone-100 dark:divide-stone-800">
        {entries.length === 0 && (
          <div className="px-6 py-8 text-center text-stone-400 text-sm">
            No entries yet
          </div>
        )}
        {entries.map((entry) => {
          const Icon = TYPE_BY_VALUE[entry.entryType].Icon
          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className="w-full text-left px-6 py-4 hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-1">
                <Icon className="size-3 text-stone-400 group-hover:text-emerald-500 transition-colors" />
                <span className="text-sm font-bold text-stone-900 dark:text-stone-100 truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                  {entry.title}
                </span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-stone-500 dark:text-stone-400">
                <span className="px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 uppercase font-semibold tracking-tighter">
                  {entry.entryType}
                </span>
                <span>{formatRelativeTime(entry.updatedAt)}</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function PopularTags({
  tagCounts,
  onTagClick,
}: {
  tagCounts: Array<{ tag: string; count: number }>
  onTagClick: (t: string) => void
}) {
  if (tagCounts.length === 0) return null
  return (
    <section>
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-sm font-bold text-stone-500 dark:text-stone-400 uppercase tracking-widest flex items-center gap-2">
          <Tag className="size-4 text-stone-500" />
          Popular Tags
        </h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {tagCounts.map(({ tag, count }) => (
          <button
            key={tag}
            onClick={() => onTagClick(tag)}
            className="px-3 py-1.5 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-lg text-sm text-stone-600 dark:text-stone-400 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all shadow-sm flex items-center gap-2 group"
          >
            <span className="text-stone-300 dark:text-stone-600 group-hover:text-emerald-300 transition-colors">
              #
            </span>
            {tag}
            <span className="text-[10px] px-1.5 py-0.5 bg-stone-100 dark:bg-stone-800 rounded-full text-stone-500 dark:text-stone-400 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/40 group-hover:text-emerald-600 transition-colors tabular-nums">
              {count}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Detail view ────────────────────────────────────────────────────

function EntryDetail({
  entry,
  allEntries,
  onSelectEntry,
  onTagClick,
  onEdit,
  onClose,
}: {
  entry: KbEntry
  allEntries: KbEntry[]
  onSelectEntry: (id: string) => void
  onTagClick: (t: string) => void
  onEdit: () => void
  onClose: () => void
}) {
  const typeMeta = TYPE_BY_VALUE[entry.entryType]
  const stabMeta = STABILITY_BY_VALUE[entry.stability]
  const TypeIcon = typeMeta.Icon
  const StabIcon = stabMeta.Icon

  const related = entry.relatedEntryIds
    .map((id) => allEntries.find((e) => e.id === id))
    .filter((e): e is KbEntry => Boolean(e))

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={onClose}
          className="text-sm text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 mb-4"
        >
          ← Back to Knowledge Base
        </button>
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`px-3 py-1 text-sm rounded-full inline-flex items-center gap-1 ${typeMeta.badgeClass}`}
          >
            <TypeIcon className="size-4" />
            {entry.entryType}
          </span>
          <span
            className={`flex items-center gap-1 text-sm ${stabMeta.textColor}`}
          >
            <StabIcon className="size-4" />
            {entry.stability}
          </span>
        </div>
        <h1 className="text-3xl font-bold text-stone-900 dark:text-stone-100 mb-4">
          {entry.title}
        </h1>
        <p className="text-lg text-stone-600 dark:text-stone-400 mb-4">
          {entry.summary || "—"}
        </p>

        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {entry.tags.map((tag) => (
              <button
                key={tag}
                onClick={() => onTagClick(tag)}
                className="px-2 py-1 text-xs bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-6 text-sm text-stone-500 dark:text-stone-400 border-y border-stone-200 dark:border-stone-800 py-3">
          <span className="flex items-center gap-1">
            <Clock className="size-4" />
            Updated {formatRelativeTime(entry.updatedAt)}
          </span>
          <span className="flex items-center gap-1">
            <DocumentDuplicate className="size-4" />
            {entry.versionCount}{" "}
            {entry.versionCount === 1 ? "version" : "versions"}
          </span>
          {entry.citations.length > 0 && (
            <span className="flex items-center gap-1">
              <LinkIcon className="size-4" />
              {entry.citations.length}{" "}
              {entry.citations.length === 1 ? "citation" : "citations"}
            </span>
          )}
          {entry.lastVerifiedAt && (
            <span className="flex items-center gap-1">
              <CheckCircle className="size-4" />
              Verified {formatDate(entry.lastVerifiedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Related Entries */}
      {related.length > 0 && (
        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
          <div className="text-sm font-semibold text-emerald-800 dark:text-emerald-300 mb-2 flex items-center gap-2">
            <LinkIcon className="size-4" />
            Related Entries
          </div>
          <div className="flex flex-wrap gap-2">
            {related.map((r) => (
              <button
                key={r.id}
                onClick={() => onSelectEntry(r.id)}
                className="px-3 py-1 text-sm bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-300 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors border border-emerald-200 dark:border-emerald-700"
              >
                {r.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="prose prose-stone dark:prose-invert max-w-none">
        <MarkdownProse content={entry.bodyMarkdown || "_No content yet._"} />
      </div>

      {/* Citations */}
      {entry.citations.length > 0 && (
        <div className="mt-10 pt-6 border-t border-stone-200 dark:border-stone-800">
          <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 uppercase tracking-widest mb-4 flex items-center gap-2">
            <LinkIcon className="size-4 text-stone-500" />
            Citations
          </h3>
          <ol className="space-y-3 list-decimal list-inside text-sm">
            {entry.citations.map((c, i) => (
              <li key={i} className="text-stone-600 dark:text-stone-400">
                {c.threadId ? (
                  <a
                    href={`/operator-studio/threads/${c.threadId}${c.messageId ? `#message-${c.messageId}` : ""}`}
                    className="text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {c.label ?? c.excerpt ?? `${c.kind} citation`}
                  </a>
                ) : (
                  <span>{c.label ?? c.excerpt ?? c.kind}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Actions */}
      <div className="mt-8 pt-6 border-t border-stone-200 dark:border-stone-800 flex items-center gap-4">
        <button
          onClick={onEdit}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <PencilSquare className="size-4" />
          Edit Entry
        </button>
      </div>
    </div>
  )
}

// ─── Modal ──────────────────────────────────────────────────────────

function EntryModal({
  form,
  isEditing,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  form: EntryFormState
  isEditing: boolean
  saving: boolean
  onChange: (next: EntryFormState) => void
  onClose: () => void
  onSave: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-stone-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-stone-200 dark:border-stone-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-stone-200 dark:border-stone-800">
          <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">
            {isEditing ? "Edit Knowledge Entry" : "Create Knowledge Entry"}
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Title
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => onChange({ ...form, title: e.target.value })}
              placeholder="e.g., Objection Handling Basics"
              className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                Type
              </label>
              <select
                value={form.entryType}
                onChange={(e) =>
                  onChange({
                    ...form,
                    entryType: e.target.value as KbEntryType,
                  })
                }
                className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {TYPE_META.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
                Stability
              </label>
              <select
                value={form.stability}
                onChange={(e) =>
                  onChange({
                    ...form,
                    stability: e.target.value as KbStability,
                  })
                }
                className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {STABILITY_META.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Summary
            </label>
            <textarea
              value={form.summary}
              onChange={(e) => onChange({ ...form, summary: e.target.value })}
              rows={2}
              placeholder="Brief overview of this entry..."
              className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Content (Markdown)
            </label>
            <textarea
              value={form.bodyMarkdown}
              onChange={(e) =>
                onChange({ ...form, bodyMarkdown: e.target.value })
              }
              rows={10}
              placeholder="# Title&#10;&#10;Content goes here..."
              className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono text-sm resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">
              Tags (comma separated)
            </label>
            <input
              type="text"
              value={form.tagsCsv}
              onChange={(e) => onChange({ ...form, tagsCsv: e.target.value })}
              placeholder="e.g., sales, technique, training"
              className="w-full px-3 py-2 bg-stone-50 dark:bg-stone-950 border border-stone-200 dark:border-stone-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 rounded-lg hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.title.trim()}
            className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving
              ? "Saving…"
              : isEditing
                ? "Save Changes"
                : "Create Entry"}
          </button>
        </div>
      </div>
    </div>
  )
}
