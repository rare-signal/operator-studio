"use client"

import * as React from "react"
import {
  Bot,
  Check,
  ClipboardCopy,
  CornerDownRight,
  Loader2,
  RefreshCcw,
  Radar,
  Rocket,
  ShieldCheck,
  X,
} from "lucide-react"

import type {
  ExecutiveRecommendation,
  ExecutiveRecommendationKind,
  ExecutiveRecommendationStatus,
} from "@/lib/operator-studio/executive-recommendations"
import { Button } from "@/registry/new-york-v4/ui/button"
import { Badge } from "@/registry/new-york-v4/ui/badge"

const POLL_MS = 30_000

const KIND_LABEL: Record<ExecutiveRecommendationKind, string> = {
  launch_worker: "Launch worker",
  continue_worker: "Continue worker",
  request_review: "Request review",
  update_plan: "Update plan",
  mark_covered: "Mark covered",
}

const STATUS_TONE: Record<ExecutiveRecommendationStatus, string> = {
  proposed: "border-amber-500/40 text-amber-700 dark:text-amber-300",
  approved: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  rejected: "border-stone-500/30 text-stone-500",
  executed: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  superseded: "border-stone-500/30 text-stone-500",
}

export function ExecutiveInbox() {
  const [items, setItems] = React.useState<ExecutiveRecommendation[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [scanning, setScanning] = React.useState(false)
  const [scanInfo, setScanInfo] = React.useState<string | null>(null)
  const [hotArmed, setHotArmed] = React.useState(false)
  const [launchInfo, setLaunchInfo] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      const [recRes, hotRes] = await Promise.all([
        fetch("/api/operator-studio/executive-recommendations?includeClosed=1"),
        fetch("/api/operator-studio/agents/hot-mode"),
      ])
      if (!recRes.ok) throw new Error(`${recRes.status} ${recRes.statusText}`)
      const data = (await recRes.json()) as {
        items: ExecutiveRecommendation[]
      }
      setItems(data.items)
      if (hotRes.ok) {
        const hot = (await hotRes.json().catch(() => ({}))) as {
          armed?: boolean
        }
        setHotArmed(Boolean(hot.armed))
      }
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function tick() {
      if (cancelled) return
      await refresh()
      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [refresh])

  async function decide(
    id: string,
    action: "approve" | "reject" | "mark_executed" | "supersede",
    executionNote?: string
  ) {
    setBusyId(id)
    try {
      await fetch(
        `/api/operator-studio/executive-recommendations/${id}/decide`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, executionNote }),
        }
      )
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  async function scan() {
    setScanning(true)
    setScanInfo(null)
    try {
      const res = await fetch(
        "/api/operator-studio/executive-recommendations/scan",
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      )
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `${res.status} ${res.statusText}`)
      }
      const data = (await res.json()) as {
        scannedAgents: number
        inMotionCards: number
        proposed: number
      }
      setScanInfo(
        `Scanned ${data.scannedAgents} agents against ${data.inMotionCards} in-motion cards · ${data.proposed} proposed`
      )
      await refresh()
    } catch (e) {
      setScanInfo(e instanceof Error ? `Scan failed: ${e.message}` : "Scan failed")
    } finally {
      setScanning(false)
    }
  }

  async function launchInTmux(rec: ExecutiveRecommendation) {
    setBusyId(rec.id)
    setLaunchInfo(null)
    try {
      const res = await fetch(
        `/api/operator-studio/executive-recommendations/${rec.id}/launch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }
      )
      const data = (await res.json().catch(() => ({}))) as {
        launch?: { agentId?: string; sessionName?: string }
        error?: string
      }
      if (!res.ok) {
        setLaunchInfo(`Launch failed: ${data.error ?? res.statusText}`)
      } else if (data.launch?.agentId) {
        setLaunchInfo(
          `Launched ${data.launch.agentId}. It should appear in Bento as a tmux pane.`
        )
      } else {
        setLaunchInfo("Launched.")
      }
      await refresh()
    } catch (e) {
      setLaunchInfo(
        `Launch failed: ${e instanceof Error ? e.message : "unknown"}`
      )
    } finally {
      setBusyId(null)
    }
  }

  async function copyPrompt(rec: ExecutiveRecommendation) {
    const text = rec.payload.prompt ?? ""
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // best-effort — surface a tiny note via executionNote when David
      // marks executed. No toast lib in scope here.
    }
  }

  const open = items.filter(
    (r) =>
      r.payload.status === "proposed" || r.payload.status === "approved"
  )
  const closed = items.filter(
    (r) => r.payload.status !== "proposed" && r.payload.status !== "approved"
  )

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10 space-y-8">
      <header className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-md border border-amber-500/30 bg-amber-500/10 flex items-center justify-center text-amber-700 dark:text-amber-300">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Executive loop · David-only
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Recommended worker actions
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Proposed launches, nudges, plan mutations, and review taps. Nothing
            executes automatically — approve to mark intent, copy the prompt or
            send it via Bento, then mark executed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={scan}
            disabled={scanning}
          >
            {scanning ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Radar className="mr-1 h-3 w-3" />
            )}
            Scan workers
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCcw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </header>

      {scanInfo && (
        <div className="rounded border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/30 px-3 py-2 text-xs text-stone-600 dark:text-stone-400">
          {scanInfo}
        </div>
      )}

      {launchInfo && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
          {launchInfo}
        </div>
      )}

      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <Section title={`Open · ${open.length}`}>
        {open.length === 0 ? (
          <EmptyState />
        ) : (
          open.map((rec) => (
            <Row
              key={rec.id}
              rec={rec}
              busy={busyId === rec.id}
              hotArmed={hotArmed}
              onCopy={() => copyPrompt(rec)}
              onDecide={decide}
              onLaunch={() => launchInTmux(rec)}
            />
          ))
        )}
      </Section>

      {closed.length > 0 && (
        <Section title={`History · ${closed.length}`} muted>
          {closed.map((rec) => (
            <Row
              key={rec.id}
              rec={rec}
              busy={busyId === rec.id}
              hotArmed={hotArmed}
              onCopy={() => copyPrompt(rec)}
              onDecide={decide}
              onLaunch={() => launchInTmux(rec)}
              compact
            />
          ))}
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  children,
  muted,
}: {
  title: string
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <section className="space-y-2">
      <h2
        className={`text-xs uppercase tracking-wider font-mono ${
          muted ? "text-stone-400" : "text-stone-600 dark:text-stone-400"
        }`}
      >
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-stone-300 dark:border-stone-700 px-4 py-8 text-center text-sm text-muted-foreground">
      No open recommendations. The executive loop will land proposed worker
      actions here as they&apos;re generated.
    </div>
  )
}

function Row({
  rec,
  busy,
  hotArmed,
  onCopy,
  onDecide,
  onLaunch,
  compact,
}: {
  rec: ExecutiveRecommendation
  busy: boolean
  hotArmed: boolean
  onCopy: () => void
  onDecide: (
    id: string,
    action: "approve" | "reject" | "mark_executed" | "supersede",
    executionNote?: string
  ) => void
  onLaunch: () => void
  compact?: boolean
}) {
  const { payload } = rec
  const canLaunchInTmux =
    payload.kind === "launch_worker" &&
    payload.status === "approved" &&
    Boolean(payload.prompt && payload.prompt.trim().length > 0)
  return (
    <article className="rounded-md border border-stone-200 dark:border-stone-800 bg-background p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Bot className="h-4 w-4 mt-0.5 text-stone-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-mono text-stone-500">
              {KIND_LABEL[payload.kind]}
            </span>
            <Badge
              variant="outline"
              className={`text-[10px] ${STATUS_TONE[payload.status]}`}
            >
              {payload.status}
            </Badge>
            {payload.workerKind && (
              <Badge variant="outline" className="text-[10px]">
                {payload.workerKind}
              </Badge>
            )}
            <Badge
              variant="outline"
              className={`text-[10px] ${
                payload.risk === "high"
                  ? "border-rose-500/40 text-rose-700 dark:text-rose-300"
                  : payload.risk === "medium"
                    ? "border-amber-500/30 text-amber-700 dark:text-amber-300"
                    : "border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
              }`}
            >
              risk · {payload.risk}
            </Badge>
            {payload.target.planStepId && (
              <span className="text-[11px] font-mono text-stone-500 truncate">
                {payload.target.planStepId}
              </span>
            )}
            {payload.target.agentId && (
              <span className="text-[11px] font-mono text-stone-500 truncate">
                → {payload.target.agentId}
              </span>
            )}
          </div>
          <h3 className="mt-1 text-sm font-medium text-stone-900 dark:text-stone-50">
            {rec.title}
          </h3>
          {!compact && rec.rationale && (
            <p className="mt-1 text-xs text-stone-600 dark:text-stone-400 whitespace-pre-wrap">
              {rec.rationale}
            </p>
          )}
        </div>
      </div>

      {!compact && payload.prompt && (
        <div className="rounded border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/40 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-mono text-stone-500">
              {payload.kind === "continue_worker" ? "Nudge text" : "Prompt"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={onCopy}
            >
              <ClipboardCopy className="mr-1 h-3 w-3" /> Copy
            </Button>
          </div>
          <pre className="whitespace-pre-wrap text-xs text-stone-700 dark:text-stone-300 font-mono">
            {payload.prompt}
          </pre>
        </div>
      )}

      {!compact && (payload.expectedOutput || payload.acceptanceCriteria) && (
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          {payload.expectedOutput && (
            <Detail label="Expected output">{payload.expectedOutput}</Detail>
          )}
          {payload.acceptanceCriteria && (
            <Detail label="Acceptance">{payload.acceptanceCriteria}</Detail>
          )}
        </div>
      )}

      {!compact && (payload.riskNote || payload.evidence) && (
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          {payload.riskNote && (
            <Detail label="Risk / safety">{payload.riskNote}</Detail>
          )}
          {payload.evidence && (
            <Detail label="Evidence">{payload.evidence}</Detail>
          )}
        </div>
      )}

      {payload.executionNote && (
        <div className="text-xs text-stone-500 flex items-start gap-1">
          <CornerDownRight className="h-3 w-3 mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{payload.executionNote}</span>
        </div>
      )}

      {payload.launch && (
        <div className="text-[11px] text-sky-700 dark:text-sky-300 font-mono flex items-center gap-1">
          <Rocket className="h-3 w-3 shrink-0" />
          <span>{payload.launch.agentId}</span>
          <span className="text-stone-400">·</span>
          <span className="text-stone-500">
            {new Date(payload.launch.launchedAt).toLocaleTimeString()}
          </span>
          {payload.launch.cwd && (
            <>
              <span className="text-stone-400">·</span>
              <span className="text-stone-500 truncate">
                {payload.launch.cwd}
              </span>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {payload.status === "proposed" && (
          <>
            <Button
              size="sm"
              variant="default"
              disabled={busy}
              onClick={() => onDecide(rec.id, "approve")}
            >
              <Check className="mr-1 h-3 w-3" /> Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onDecide(rec.id, "reject")}
            >
              <X className="mr-1 h-3 w-3" /> Reject
            </Button>
          </>
        )}
        {payload.status === "approved" && (
          <>
            {canLaunchInTmux && (
              <Button
                size="sm"
                variant="default"
                disabled={busy || !hotArmed}
                title={
                  hotArmed
                    ? "Spawn a fresh tmux worker running Claude with this prompt"
                    : "Hot mode is not armed — arm it in Bento before launching"
                }
                onClick={onLaunch}
              >
                <Rocket className="mr-1 h-3 w-3" /> Launch in tmux
              </Button>
            )}
            <Button
              size="sm"
              variant={canLaunchInTmux ? "outline" : "default"}
              disabled={busy}
              onClick={() => {
                const note = window.prompt(
                  "How was this executed? (e.g. 'copied prompt to fresh Claude in tmux:work', 'sent to claude:abc123')",
                  ""
                )
                if (note === null) return
                onDecide(rec.id, "mark_executed", note || undefined)
              }}
            >
              <Check className="mr-1 h-3 w-3" /> Mark executed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onDecide(rec.id, "supersede")}
            >
              Supersede
            </Button>
          </>
        )}
        <span className="ml-auto text-[10px] font-mono text-stone-400">
          {new Date(rec.updatedAt).toLocaleString()}
        </span>
      </div>
    </article>
  )
}

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded border border-stone-200 dark:border-stone-800 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider font-mono text-stone-500 mb-0.5">
        {label}
      </div>
      <div className="text-xs text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
        {children}
      </div>
    </div>
  )
}
