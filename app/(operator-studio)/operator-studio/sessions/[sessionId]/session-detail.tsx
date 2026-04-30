"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  GitBranch,
  GitFork,
  Layers,
  List,
  MessageSquare,
  Network,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react"

import { Badge } from "@/registry/new-york-v4/ui/badge"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Input } from "@/registry/new-york-v4/ui/input"
import { Textarea } from "@/registry/new-york-v4/ui/textarea"
import { defaultSessionLabel } from "@/lib/operator-studio/sessions"
import type { GoldCandidate } from "@/lib/operator-studio/gold-extractor"
import type { ThemeTerm } from "@/lib/operator-studio/theme-extractor"
import type { PulseBucket } from "@/lib/operator-studio/activity-pulse"
import type {
  OperatorPlanStep,
  OperatorSession,
  OperatorStepFulfillment,
  OperatorThread,
} from "@/lib/operator-studio/types"
import { SessionGraphView } from "./session-graph-view"

interface SessionDetailProps {
  session: OperatorSession
  threads: OperatorThread[]
  fulfillments: OperatorStepFulfillment[]
  /** Heuristic-ranked message candidates worth promoting. Can be empty
   *  — small/connective sessions won't have any gold. */
  gold: GoldCandidate[]
  /** Top keywords across the session, frequency-weighted. */
  themes: ThemeTerm[]
  /** Per-bucket message counts across the session's timeline. */
  pulse: PulseBucket[]
}

/** Simple client-side id generator — steps never leave the plan, so
 *  no need for crypto-grade uniqueness. */
function newStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function SessionDetail({
  session: initialSession,
  threads,
  fulfillments: initialFulfillments,
  gold,
  themes,
  pulse,
}: SessionDetailProps) {
  const router = useRouter()
  const [session, setSession] = React.useState(initialSession)
  const [fulfillments, setFulfillments] = React.useState(initialFulfillments)
  const [editingLabel, setEditingLabel] = React.useState(false)
  const [labelDraft, setLabelDraft] = React.useState(session.label ?? "")
  const [savingLabel, setSavingLabel] = React.useState(false)
  const [threadView, setThreadView] = React.useState<"list" | "graph">("list")

  const fallbackLabel = defaultSessionLabel(
    new Date(session.startedAt),
    new Date(session.endedAt)
  )
  const currentLabel = session.label ?? fallbackLabel

  async function saveLabel() {
    setSavingLabel(true)
    try {
      const trimmed = labelDraft.trim()
      const res = await fetch(
        `/api/operator-studio/sessions/${session.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: trimmed || null }),
        }
      )
      if (res.ok) {
        setSession({ ...session, label: trimmed || null })
        setEditingLabel(false)
      } else {
        const data = await res.json().catch(() => ({}))
        window.alert(`Couldn't save: ${data.error ?? "unknown error"}`)
      }
    } finally {
      setSavingLabel(false)
    }
  }

  async function savePlan(steps: OperatorPlanStep[]) {
    const res = await fetch(
      `/api/operator-studio/sessions/${session.id}/plan`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      }
    )
    if (res.ok) {
      const data = await res.json()
      setSession({ ...session, planSteps: data.steps })
      // Server may have dropped orphan fulfillments (steps removed).
      // Reconcile the local list.
      const liveStepIds = new Set(data.steps.map((s: OperatorPlanStep) => s.id))
      setFulfillments((prev) => prev.filter((f) => liveStepIds.has(f.stepId)))
    } else {
      const data = await res.json().catch(() => ({}))
      window.alert(`Couldn't save plan: ${data.error ?? "unknown error"}`)
    }
  }

  async function removeFulfillment(fulfillmentId: string) {
    const res = await fetch(
      `/api/operator-studio/sessions/${session.id}/fulfill?fulfillmentId=${encodeURIComponent(fulfillmentId)}`,
      { method: "DELETE" }
    )
    if (res.ok) {
      setFulfillments((prev) => prev.filter((f) => f.id !== fulfillmentId))
    }
  }

  /**
   * Promote a message to a plan step directly from a gold card.
   * Returns the new fulfillment (or null on failure) so the UI can
   * update optimistically.
   */
  async function promoteMessageToStep(
    stepId: string,
    messageId: string,
    note?: string
  ): Promise<OperatorStepFulfillment | null> {
    const res = await fetch(
      `/api/operator-studio/sessions/${session.id}/fulfill`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          targetType: "message",
          targetId: messageId,
          note,
        }),
      }
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      window.alert(`Promote failed: ${data.error ?? "unknown error"}`)
      return null
    }
    const data = await res.json()
    setFulfillments((prev) => {
      if (prev.some((p) => p.id === data.fulfillment.id)) {
        return prev.map((p) =>
          p.id === data.fulfillment.id ? data.fulfillment : p
        )
      }
      return [...prev, data.fulfillment]
    })
    return data.fulfillment
  }

  const start = new Date(session.startedAt)
  const end = new Date(session.endedAt)
  const durationMs = end.getTime() - start.getTime()
  const durationMin = Math.round(durationMs / 60000)
  const durationLabel =
    durationMin < 60
      ? `${durationMin}m`
      : `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`

  // Threads indexed by id for the coverage view.
  const threadsById = React.useMemo(() => {
    const m = new Map<string, OperatorThread>()
    for (const t of threads) m.set(t.id, t)
    return m
  }, [threads])

  return (
    <div className="flex flex-col gap-6 p-6">
      <button
        onClick={() => router.push("/operator-studio/sessions")}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
      >
        <ArrowLeft className="h-3 w-3" />
        All sessions
      </button>

      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editingLabel ? (
              <div className="flex items-center gap-2">
                <Input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  placeholder={fallbackLabel}
                  className="max-w-md h-8 text-xl font-semibold"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveLabel()
                    if (e.key === "Escape") {
                      setEditingLabel(false)
                      setLabelDraft(session.label ?? "")
                    }
                  }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={saveLabel}
                  disabled={savingLabel}
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditingLabel(false)
                    setLabelDraft(session.label ?? "")
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {currentLabel}
                </h1>
                <button
                  onClick={() => setEditingLabel(true)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  aria-label="Edit label"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                {!session.label && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1.5 py-0 text-[9px] font-normal text-muted-foreground"
                  >
                    auto-named
                  </Badge>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {start.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                –{" "}
                {end.toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {durationLabel}
              </span>
              <span className="flex items-center gap-1">
                <GitBranch className="h-3 w-3" />
                {threads.length} thread{threads.length === 1 ? "" : "s"}
              </span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {session.messageCount} message
                {session.messageCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Gold — heuristic promotion candidates, the "bait" layer */}
      {gold.length > 0 && (
        <GoldStrip
          gold={gold}
          planSteps={session.planSteps}
          fulfillments={fulfillments}
          onPromote={promoteMessageToStep}
        />
      )}

      {/* Themes + Pulse side-by-side — shape of the session */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
        <ThemesPanel themes={themes} />
        <PulsePanel pulse={pulse} />
      </div>

      {/* Plan editor + coverage */}
      <PlanSection
        steps={session.planSteps}
        fulfillments={fulfillments}
        threadsById={threadsById}
        onSaveSteps={savePlan}
        onRemoveFulfillment={removeFulfillment}
      />

      {/* Threads in this session */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Threads in this session
          </h2>
          {threads.length > 0 && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5 text-[10px]">
              <button
                onClick={() => setThreadView("list")}
                className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                  threadView === "list"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="h-3 w-3" />
                List
              </button>
              <button
                onClick={() => setThreadView("graph")}
                className={`flex items-center gap-1 px-2 py-0.5 rounded transition-colors ${
                  threadView === "graph"
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Network className="h-3 w-3" />
                Graph
              </button>
            </div>
          )}
        </div>
        {threads.length === 0 ? (
          <div className="rounded-lg border border-dashed py-8 text-center">
            <GitFork className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              No threads overlap this session's time range.
            </p>
          </div>
        ) : threadView === "graph" ? (
          <SessionGraphView threads={threads} />
        ) : (
          <div className="space-y-2">
            {threads.map((thread) => {
              const threadFulfillments = fulfillments.filter(
                (f) => f.targetType === "thread" && f.targetId === thread.id
              )
              return (
                <div
                  key={thread.id}
                  className="rounded-lg border border-border"
                >
                  <button
                    onClick={() =>
                      router.push(`/operator-studio/threads/${thread.id}`)
                    }
                    className="w-full px-4 py-3 text-left transition-colors hover:bg-accent/50 rounded-lg"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {thread.promotedTitle ??
                            thread.rawTitle ??
                            "Untitled thread"}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <Badge
                            variant="secondary"
                            className="h-4 px-1.5 py-0 text-[9px] font-normal"
                          >
                            {thread.sourceApp}
                          </Badge>
                          <span>{thread.messageCount} turns</span>
                          <span>·</span>
                          <span>{thread.reviewState}</span>
                          {thread.parentThreadId && (
                            <>
                              <span>·</span>
                              <span className="flex items-center gap-1">
                                <GitFork className="h-2.5 w-2.5" />
                                fork
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <PromoteThreadMenu
                        sessionId={session.id}
                        thread={thread}
                        planSteps={session.planSteps}
                        existingFulfillments={threadFulfillments}
                        onPromote={(fulfillment) =>
                          setFulfillments((prev) => {
                            if (prev.some((p) => p.id === fulfillment.id)) {
                              return prev.map((p) =>
                                p.id === fulfillment.id ? fulfillment : p
                              )
                            }
                            return [...prev, fulfillment]
                          })
                        }
                      />
                    </div>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Plan editor + coverage view ────────────────────────────────────────────

interface PlanSectionProps {
  steps: OperatorPlanStep[]
  fulfillments: OperatorStepFulfillment[]
  threadsById: Map<string, OperatorThread>
  onSaveSteps: (steps: OperatorPlanStep[]) => Promise<void>
  onRemoveFulfillment: (fulfillmentId: string) => Promise<void>
}

function PlanSection({
  steps,
  fulfillments,
  threadsById,
  onSaveSteps,
  onRemoveFulfillment,
}: PlanSectionProps) {
  const [draftSteps, setDraftSteps] = React.useState(steps)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Sync draft with props when server state changes (e.g. after save).
  React.useEffect(() => {
    setDraftSteps(steps)
  }, [steps])

  async function handleSave() {
    setSaving(true)
    try {
      await onSaveSteps(draftSteps)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function addStep() {
    setDraftSteps((prev) => [
      ...prev,
      {
        id: newStepId(),
        title: "",
        order: prev.length,
        status: "open",
        parentStepId: null,
        coverImageUrl: null,
        positionX: null,
        positionY: null,
      },
    ])
  }

  function updateStep(id: string, patch: Partial<OperatorPlanStep>) {
    setDraftSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
    )
  }

  function removeStep(id: string) {
    setDraftSteps((prev) =>
      prev
        .filter((s) => s.id !== id)
        .map((s, i) => ({ ...s, order: i }))
    )
  }

  function moveStep(id: string, dir: "up" | "down") {
    setDraftSteps((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx === -1) return prev
      const target = dir === "up" ? idx - 1 : idx + 1
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next.map((s, i) => ({ ...s, order: i }))
    })
  }

  // Read-only mode: show plan + coverage if plan exists; CTA if empty.
  if (!editing) {
    if (steps.length === 0) {
      return (
        <section className="rounded-lg border border-dashed border-muted-foreground/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Plan
            </div>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Sketch a plan
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Outline the phases of what you're working on. As you promote
            threads and messages from this session, they'll show up
            beneath the step they fulfill — a running map of what's done
            and what's still open.
          </p>
        </section>
      )
    }

    return (
      <section className="rounded-lg border p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Plan
            <Badge
              variant="outline"
              className="h-4 px-1.5 py-0 text-[9px] font-normal"
            >
              {steps.length} step{steps.length === 1 ? "" : "s"}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
          >
            <Edit2 className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => {
            const stepFulfillments = fulfillments.filter(
              (f) => f.stepId === step.id
            )
            return (
              <CoverageCard
                key={step.id}
                index={i}
                step={step}
                fulfillments={stepFulfillments}
                threadsById={threadsById}
                onRemoveFulfillment={onRemoveFulfillment}
              />
            )
          })}
        </div>
      </section>
    )
  }

  // Edit mode
  return (
    <section className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Layers className="h-4 w-4 text-muted-foreground" />
          Plan
          <Badge
            variant="outline"
            className="h-4 px-1.5 py-0 text-[9px] font-normal"
          >
            editing
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraftSteps(steps)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save plan"}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {draftSteps.map((step, i) => (
          <div
            key={step.id}
            className="rounded-md border border-border p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-muted-foreground w-5">
                {i + 1}.
              </span>
              <Input
                value={step.title}
                onChange={(e) =>
                  updateStep(step.id, { title: e.target.value })
                }
                placeholder="Step title (e.g. 'Context retrieval')"
                className="h-8 text-sm flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => moveStep(step.id, "up")}
                disabled={i === 0}
                aria-label="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => moveStep(step.id, "down")}
                disabled={i === draftSteps.length - 1}
                aria-label="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => removeStep(step.id)}
                aria-label="Remove step"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea
              value={step.description ?? ""}
              onChange={(e) =>
                updateStep(step.id, { description: e.target.value })
              }
              placeholder="Description (optional) — what counts as 'done' for this step?"
              className="text-xs min-h-[60px]"
            />
          </div>
        ))}
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={addStep}
        className="w-full"
      >
        <Plus className="h-3.5 w-3.5 mr-1.5" />
        Add step
      </Button>
    </section>
  )
}

interface CoverageCardProps {
  index: number
  step: OperatorPlanStep
  fulfillments: OperatorStepFulfillment[]
  threadsById: Map<string, OperatorThread>
  onRemoveFulfillment: (fulfillmentId: string) => Promise<void>
}

function CoverageCard({
  index,
  step,
  fulfillments,
  threadsById,
  onRemoveFulfillment,
}: CoverageCardProps) {
  const router = useRouter()
  const hasCoverage = fulfillments.length > 0

  return (
    <div
      className={`rounded-md border p-3 ${
        hasCoverage
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-dashed border-muted-foreground/30"
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0 mt-0.5">
          {index + 1}.
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{step.title}</p>
            {hasCoverage ? (
              <Badge
                variant="secondary"
                className="h-4 px-1.5 py-0 text-[9px] font-normal bg-emerald-500/20 text-emerald-900 dark:text-emerald-100"
              >
                <Target className="h-2.5 w-2.5 mr-0.5" />
                {fulfillments.length}
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="h-4 px-1.5 py-0 text-[9px] font-normal text-muted-foreground"
              >
                open
              </Badge>
            )}
          </div>
          {step.description && (
            <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
              {step.description}
            </p>
          )}
          {fulfillments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {fulfillments.map((f) => {
                const thread =
                  f.targetType === "thread"
                    ? threadsById.get(f.targetId)
                    : undefined
                const title =
                  f.targetType === "thread"
                    ? (thread?.promotedTitle ??
                      thread?.rawTitle ??
                      "Untitled thread")
                    : "Message"
                const targetPath =
                  f.targetType === "thread"
                    ? `/operator-studio/threads/${f.targetId}`
                    : undefined
                const isMessage = f.targetType === "message"
                return (
                  <li
                    key={f.id}
                    className="rounded bg-background px-2 py-1.5 border border-border/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() =>
                          targetPath && router.push(targetPath)
                        }
                        className="flex-1 min-w-0 text-left"
                        disabled={!targetPath}
                      >
                        <p className="truncate text-xs font-medium">
                          {title}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {f.targetType} · by {f.promotedBy}
                        </p>
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onRemoveFulfillment(f.id)}
                        aria-label="Remove fulfillment"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                    {isMessage && f.note && (
                      <blockquote className="mt-1.5 border-l-2 border-emerald-500/40 pl-2 text-[11px] text-foreground/80 whitespace-pre-wrap line-clamp-6">
                        {f.note}
                      </blockquote>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Promote-to-step menu on each thread row ────────────────────────────────

interface PromoteThreadMenuProps {
  sessionId: string
  thread: OperatorThread
  planSteps: OperatorPlanStep[]
  existingFulfillments: OperatorStepFulfillment[]
  onPromote: (fulfillment: OperatorStepFulfillment) => void
}

function PromoteThreadMenu({
  sessionId,
  thread,
  planSteps,
  existingFulfillments,
  onPromote,
}: PromoteThreadMenuProps) {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  async function promote(stepId: string) {
    setBusy(true)
    try {
      const res = await fetch(
        `/api/operator-studio/sessions/${sessionId}/fulfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stepId,
            targetType: "thread",
            targetId: thread.id,
          }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        onPromote(data.fulfillment)
      }
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  if (planSteps.length === 0) return null

  const fulfilledStepIds = new Set(existingFulfillments.map((f) => f.stepId))

  return (
    <div ref={ref} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-[10px]"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <Target className="h-3 w-3 mr-1" />
        Assign
      </Button>
      {open && (
        <div className="absolute right-0 top-8 z-10 min-w-[240px] rounded-md border bg-popover shadow-md p-1">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Assign to plan step
          </p>
          {planSteps.map((step, i) => {
            const isFulfilled = fulfilledStepIds.has(step.id)
            return (
              <button
                key={step.id}
                onClick={() => !isFulfilled && !busy && promote(step.id)}
                disabled={isFulfilled || busy}
                className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <span className="text-[10px] font-mono text-muted-foreground w-4">
                  {i + 1}.
                </span>
                <span className="flex-1 truncate">{step.title || "(untitled)"}</span>
                {isFulfilled && (
                  <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── GoldStrip: heuristic promotion candidates ──────────────────────────────

/**
 * Cards visually "bait" the user: here's what the tool thinks is worth
 * promoting, with the reason. Click the excerpt to jump to the message;
 * click "Promote to step" to attach it to the plan. Intentional gold
 * visual (amber accent, slight shine) so it reads as distinct from the
 * neutral surfaces below.
 */
function GoldStrip({
  gold,
  planSteps,
  fulfillments,
  onPromote,
}: {
  gold: GoldCandidate[]
  planSteps: OperatorPlanStep[]
  fulfillments: OperatorStepFulfillment[]
  onPromote: (
    stepId: string,
    messageId: string,
    note?: string
  ) => Promise<OperatorStepFulfillment | null>
}) {
  // Which messages are already promoted so we can badge them instead
  // of offering a duplicate promote.
  const promotedMessageIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const f of fulfillments) {
      if (f.targetType === "message") ids.add(f.targetId)
    }
    return ids
  }, [fulfillments])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Potentially promotable
          </h2>
          <span className="text-[10px] text-muted-foreground/60">
            · {gold.length} candidate{gold.length === 1 ? "" : "s"} surfaced
            from this session
          </span>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {gold.map((c) => (
          <GoldCard
            key={c.messageId}
            candidate={c}
            planSteps={planSteps}
            alreadyPromoted={promotedMessageIds.has(c.messageId)}
            onPromote={onPromote}
          />
        ))}
      </div>
    </section>
  )
}

function GoldCard({
  candidate,
  planSteps,
  alreadyPromoted,
  onPromote,
}: {
  candidate: GoldCandidate
  planSteps: OperatorPlanStep[]
  alreadyPromoted: boolean
  onPromote: (
    stepId: string,
    messageId: string,
    note?: string
  ) => Promise<OperatorStepFulfillment | null>
}) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [justPromoted, setJustPromoted] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!menuOpen) return
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [menuOpen])

  async function handlePromote(stepId: string) {
    setBusy(true)
    try {
      const result = await onPromote(
        stepId,
        candidate.messageId,
        candidate.excerpt
      )
      if (result) {
        setJustPromoted(true)
        setMenuOpen(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const showPromoted = alreadyPromoted || justPromoted

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border p-4 transition-all ${
        showPromoted
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-amber-500/25 bg-gradient-to-br from-amber-500/5 via-card to-card hover:border-amber-500/40 hover:shadow-md hover:shadow-amber-500/5"
      }`}
    >
      {/* shine */}
      {!showPromoted && (
        <div className="pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full bg-amber-500/10 blur-3xl" />
      )}

      <div className="relative space-y-3">
        {/* Reason badge */}
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`h-5 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider ${
              showPromoted
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                : "border-amber-500/40 text-amber-700 dark:text-amber-300"
            }`}
          >
            {showPromoted ? (
              <>
                <Check className="h-2.5 w-2.5 mr-0.5" /> promoted
              </>
            ) : (
              <>
                <Sparkles className="h-2.5 w-2.5 mr-0.5" />{" "}
                {candidate.topReason.label}
              </>
            )}
          </Badge>
          <span className="text-[10px] text-muted-foreground/70">
            {candidate.role} · turn {candidate.turnIndex + 1}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground/50 tabular-nums">
            score {candidate.score}
          </span>
        </div>

        {/* Excerpt */}
        <button
          onClick={() =>
            router.push(
              `/operator-studio/threads/${candidate.threadId}#msg-${candidate.messageId}`
            )
          }
          className="block w-full text-left"
        >
          <p className="text-sm leading-relaxed whitespace-pre-wrap line-clamp-6">
            {candidate.excerpt}
          </p>
        </button>

        {/* Footer: thread origin + all signals + promote */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] text-muted-foreground">
              from{" "}
              <span className="text-foreground/80">
                {candidate.threadTitle ?? "Untitled thread"}
              </span>
            </p>
            {candidate.signals.length > 1 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {candidate.signals.slice(0, 4).map((s, i) => (
                  <span
                    key={i}
                    className="text-[9px] px-1 rounded bg-muted/60 text-muted-foreground"
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {!showPromoted && planSteps.length > 0 && (
            <div ref={menuRef} className="relative shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-amber-500/40 text-[10px] hover:bg-amber-500/10"
                onClick={() => setMenuOpen((o) => !o)}
                disabled={busy}
              >
                <Target className="h-3 w-3 mr-1" />
                Promote to step
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
              {menuOpen && (
                <div className="absolute right-0 top-8 z-10 min-w-[220px] rounded-md border bg-popover shadow-md p-1">
                  <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Promote as quote to…
                  </p>
                  {planSteps.map((step, i) => (
                    <button
                      key={step.id}
                      onClick={() => handlePromote(step.id)}
                      disabled={busy}
                      className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent disabled:opacity-50 flex items-center gap-2"
                    >
                      <span className="text-[10px] font-mono text-muted-foreground w-4">
                        {i + 1}.
                      </span>
                      <span className="flex-1 truncate">
                        {step.title || "(untitled)"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!showPromoted && planSteps.length === 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60 italic">
              sketch a plan to promote
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ThemesPanel: frequency-weighted keyword cloud ──────────────────────────

function ThemesPanel({ themes }: { themes: ThemeTerm[] }) {
  if (themes.length === 0) {
    return (
      <div className="rounded-xl border bg-card/50 p-4 flex flex-col">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Themes
        </h3>
        <p className="text-xs text-muted-foreground/70">
          Not enough recurring terms to surface themes yet.
        </p>
      </div>
    )
  }

  const maxWeight = Math.max(...themes.map((t) => t.weight))
  const minWeight = Math.min(...themes.map((t) => t.weight))
  const range = Math.max(1, maxWeight - minWeight)

  function sizeFor(weight: number): { size: string; opacity: number } {
    const n = (weight - minWeight) / range // 0..1
    if (n > 0.7) return { size: "text-base", opacity: 1 }
    if (n > 0.4) return { size: "text-sm", opacity: 0.9 }
    if (n > 0.2) return { size: "text-xs", opacity: 0.75 }
    return { size: "text-[11px]", opacity: 0.6 }
  }

  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Themes
        </h3>
        <span className="text-[10px] text-muted-foreground/60">
          {themes.length} recurring terms
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 items-baseline">
        {themes.map((t) => {
          const s = sizeFor(t.weight)
          return (
            <span
              key={t.term}
              title={`${t.messageHits} message${t.messageHits === 1 ? "" : "s"}`}
              className={`${s.size} font-medium tracking-tight`}
              style={{ opacity: s.opacity }}
            >
              {t.term}
              <span className="text-muted-foreground/40 ml-0.5 text-[10px]">
                ·{t.messageHits}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ─── PulsePanel: message density sparkline within the session ───────────────

function PulsePanel({ pulse }: { pulse: PulseBucket[] }) {
  if (pulse.length === 0) {
    return (
      <div className="rounded-xl border bg-card/50 p-4 flex flex-col">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Activity pulse
        </h3>
        <p className="text-xs text-muted-foreground/70">No activity yet.</p>
      </div>
    )
  }

  const max = Math.max(1, ...pulse.map((b) => b.count))
  const total = pulse.reduce((s, b) => s + b.count, 0)
  // Find the "peak" bucket for narration.
  let peakIdx = 0
  for (let i = 1; i < pulse.length; i++) {
    if (pulse[i].count > pulse[peakIdx].count) peakIdx = i
  }
  const peak = pulse[peakIdx]
  const peakTime = new Date(peak.startedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })

  return (
    <div className="rounded-xl border bg-card/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Activity pulse
        </h3>
        <span className="text-[10px] text-muted-foreground/60">
          {total.toLocaleString()} turn{total === 1 ? "" : "s"} · peak at{" "}
          {peakTime}
        </span>
      </div>
      <div className="flex items-end gap-[2px] h-20">
        {pulse.map((b, i) => {
          const h = b.count === 0 ? 2 : Math.max(3, (b.count / max) * 70)
          const isPeak = i === peakIdx && b.count > 0
          return (
            <div
              key={b.startedAt}
              title={`${new Date(b.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}: ${b.count}`}
              className="flex-1 flex items-end"
            >
              <div
                className={`w-full rounded-[2px] transition-colors ${
                  isPeak
                    ? "bg-amber-500"
                    : b.count === 0
                      ? "bg-muted-foreground/10"
                      : "bg-foreground/35 hover:bg-foreground/55"
                }`}
                style={{ height: `${h}px` }}
              />
            </div>
          )
        })}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground/50 mt-1">
        <span>
          {new Date(pulse[0].startedAt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span>
          {new Date(pulse[pulse.length - 1].endedAt).toLocaleTimeString(
            undefined,
            { hour: "numeric", minute: "2-digit" }
          )}
        </span>
      </div>
    </div>
  )
}
