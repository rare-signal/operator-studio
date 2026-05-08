"use client"

import * as React from "react"
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  RotateCcw,
  Sparkles,
  Telescope,
} from "lucide-react"

import { Button } from "@/registry/new-york-v4/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/registry/new-york-v4/ui/collapsible"

import type {
  EnrichmentStatus,
  ThreadEnrichmentRow,
} from "@/lib/operator-studio/wayseer/queries"
import {
  CONTRACT_VERSION as THREAD_ANALYSIS_CONTRACT_VERSION,
  type ThreadAnalysis,
} from "@/lib/operator-studio/wayseer/contracts/thread-analysis"

import { useWayseer } from "./wayseer-context"

interface AnalysisResponse {
  enrichment: ThreadEnrichmentRow | null
  contractVersion: string
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 60 // 3 minutes worth of polls

/**
 * Per-thread Wayseer analysis. Mounts inside ThreadDetail; renders
 * the structured output of the thread-analysis contract — timeline,
 * attitude, what-got-done, open-threads. Defense-in-depth gates on
 * `useWayseer().enabled` so it can't show up if a parent forgets to
 * gate it.
 */
export function WayseerAnalysisPanel({ threadId }: { threadId: string }) {
  const { enabled } = useWayseer()
  const [data, setData] = React.useState<AnalysisResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [open, setOpen] = React.useState(true)
  const pollTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollAttempts = React.useRef(0)

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(
        `/api/operator-studio/wayseer/threads/${threadId}/analysis`,
        { cache: "no-store" }
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(body?.error ?? `GET failed: ${res.status}`)
      }
      const json = (await res.json()) as AnalysisResponse
      setData(json)
      setError(null)
      return json
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      return null
    }
  }, [threadId])

  // Initial load.
  React.useEffect(() => {
    if (!enabled) return
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [enabled, refresh])

  // Poll while running. Self-cancelling: clears the timer when the
  // status moves out of `running` or the component unmounts.
  React.useEffect(() => {
    const status = data?.enrichment?.status
    if (status !== "running") {
      pollAttempts.current = 0
      if (pollTimer.current) {
        clearTimeout(pollTimer.current)
        pollTimer.current = null
      }
      return
    }
    pollTimer.current = setTimeout(async () => {
      pollAttempts.current += 1
      if (pollAttempts.current > POLL_MAX_ATTEMPTS) {
        // Give up gracefully — the row will eventually flip in the DB,
        // and a manual reload will pick it up.
        setError("Analysis is taking longer than expected. Reload to check status.")
        return
      }
      await refresh()
    }, POLL_INTERVAL_MS)
    return () => {
      if (pollTimer.current) {
        clearTimeout(pollTimer.current)
        pollTimer.current = null
      }
    }
  }, [data?.enrichment?.status, refresh])

  const startAnalysis = React.useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/operator-studio/wayseer/threads/${threadId}/analyze`,
        { method: "POST" }
      )
      if (!res.ok && res.status !== 202) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(body?.error ?? `POST failed: ${res.status}`)
      }
      const json = (await res.json()) as { enrichment: ThreadEnrichmentRow }
      setData((prev) => ({
        enrichment: json.enrichment,
        contractVersion: prev?.contractVersion ?? json.enrichment.contractVersion,
      }))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
    } finally {
      setStarting(false)
    }
  }, [threadId])

  if (!enabled) return null
  if (loading && !data) {
    return (
      <PanelShell>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading Wayseer analysis…
        </div>
      </PanelShell>
    )
  }

  const enrichment = data?.enrichment ?? null
  const status: EnrichmentStatus | null = enrichment?.status ?? null
  const isStale =
    enrichment?.status === "completed" &&
    data?.contractVersion !== undefined &&
    enrichment.contractVersion !== data.contractVersion

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <PanelShell>
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 text-left flex-1 min-w-0 -my-1 py-1 hover:opacity-80"
            >
              <Telescope className="h-3.5 w-3.5 text-violet-500 shrink-0" />
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Wayseer
              </span>
              <StatusBadge status={status} stale={isStale} />
              <ChevronDown
                className={`h-3.5 w-3.5 text-muted-foreground/60 transition-transform ${
                  open ? "" : "-rotate-90"
                }`}
              />
            </button>
          </CollapsibleTrigger>
          <PanelActions
            status={status}
            stale={isStale}
            starting={starting}
            onStart={startAnalysis}
          />
        </div>
        <CollapsibleContent>
          <div className="mt-3">
            <PanelBody
              status={status}
              error={error}
              enrichment={enrichment}
              starting={starting}
              onStart={startAnalysis}
            />
            {isStale && status === "completed" && (
              <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-300">
                This analysis was produced by an older contract version. Re-run for the latest output shape.
              </p>
            )}
          </div>
        </CollapsibleContent>
      </PanelShell>
    </Collapsible>
  )
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-violet-500/5 border-violet-500/20 dark:bg-violet-500/10 px-4 py-3">
      {children}
    </div>
  )
}

function StatusBadge({
  status,
  stale,
}: {
  status: EnrichmentStatus | null
  stale: boolean
}) {
  if (status === null) {
    return (
      <span className="text-[10px] text-muted-foreground">
        not yet analyzed
      </span>
    )
  }
  if (status === "running") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-300">
        <Loader2 className="h-3 w-3 animate-spin" />
        analyzing…
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400">
        <AlertCircle className="h-3 w-3" /> failed
      </span>
    )
  }
  if (status === "completed") {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        {stale ? "stale" : "ready"}
      </span>
    )
  }
  return null
}

function PanelActions({
  status,
  stale,
  starting,
  onStart,
}: {
  status: EnrichmentStatus | null
  stale: boolean
  starting: boolean
  onStart: () => void
}) {
  if (status === "running") return null
  if (status === null) {
    return (
      <Button
        size="sm"
        variant="default"
        onClick={onStart}
        disabled={starting}
        className="h-7 px-2.5 text-[11px]"
      >
        {starting ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3 mr-1" />
        )}
        Analyze
      </Button>
    )
  }
  if (status === "failed" || stale) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={onStart}
        disabled={starting}
        className="h-7 px-2.5 text-[11px]"
      >
        {starting ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <RotateCcw className="h-3 w-3 mr-1" />
        )}
        Retry
      </Button>
    )
  }
  // status === "completed" and not stale: small re-run affordance.
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onStart}
      disabled={starting}
      className="h-7 px-2 text-[11px] text-muted-foreground"
    >
      {starting ? (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      ) : (
        <RotateCcw className="h-3 w-3 mr-1" />
      )}
      Re-run
    </Button>
  )
}

function PanelBody({
  status,
  error,
  enrichment,
  starting,
  onStart,
}: {
  status: EnrichmentStatus | null
  error: string | null
  enrichment: ThreadEnrichmentRow | null
  starting: boolean
  onStart: () => void
}) {
  if (status === null) {
    return (
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Wayseer reads the thread end-to-end and pulls out a timeline, the
          operator&apos;s focus across the conversation, and what got done.
          Click <strong>Analyze</strong> to run it. Output is stored, so you
          only pay the LLM cost once per thread.
        </p>
      </div>
    )
  }

  if (status === "running") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
        <span>Reading the thread and extracting structure. This usually takes 10–60 seconds.</span>
      </div>
    )
  }

  if (status === "failed") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-red-600 dark:text-red-400">
            Analysis failed
          </p>
          <p className="mt-0.5 text-muted-foreground break-words">
            {enrichment?.errorMessage ?? error ?? "Unknown error"}
          </p>
        </div>
      </div>
    )
  }

  if (
    status === "completed" &&
    enrichment?.resultPayload &&
    enrichment.contractVersion === THREAD_ANALYSIS_CONTRACT_VERSION
  ) {
    return (
      <CompletedAnalysis
        analysis={enrichment.resultPayload as ThreadAnalysis}
        enrichment={enrichment}
      />
    )
  }

  // Defensive: completed without a payload should never happen, but
  // surface a Run again hint if it does.
  return (
    <div className="flex items-start gap-2 text-xs text-muted-foreground">
      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <div>
        <p>This run completed but didn&apos;t store an analysis payload.</p>
        <Button
          size="sm"
          variant="link"
          onClick={onStart}
          disabled={starting}
          className="h-auto p-0 text-xs"
        >
          Run again
        </Button>
      </div>
    </div>
  )
}

function CompletedAnalysis({
  analysis,
  enrichment,
}: {
  analysis: ThreadAnalysis
  enrichment: ThreadEnrichmentRow
}) {
  return (
    <div className="space-y-4">
      <Section label="Attitude">
        <p className="text-sm text-foreground/90 leading-relaxed">
          {analysis.attitude}
        </p>
      </Section>

      {analysis.timeline.length > 0 && (
        <Section label="Timeline">
          <ol className="space-y-2">
            {analysis.timeline.map((step, idx) => (
              <li key={idx} className="flex gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">
                    {step.label}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {step.summary}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {analysis.what_got_done.length > 0 && (
        <Section label="What got done">
          <ul className="space-y-1.5">
            {analysis.what_got_done.map((item, idx) => (
              <li
                key={idx}
                className="flex gap-2 text-sm text-foreground/90"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-500" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {analysis.open_threads.length > 0 && (
        <Section label="Still open">
          <ul className="space-y-1.5">
            {analysis.open_threads.map((item, idx) => (
              <li
                key={idx}
                className="flex gap-2 text-sm text-foreground/90"
              >
                <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Telemetry enrichment={enrichment} />
    </div>
  )
}

function Section({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  )
}

function Telemetry({ enrichment }: { enrichment: ThreadEnrichmentRow }) {
  const parts: string[] = []
  if (enrichment.completedAt) {
    parts.push(
      `analyzed ${new Date(enrichment.completedAt).toLocaleString()}`
    )
  }
  if (enrichment.latencyMs) {
    parts.push(`${(enrichment.latencyMs / 1000).toFixed(1)}s`)
  }
  if (enrichment.promptTokens || enrichment.completionTokens) {
    parts.push(
      `${enrichment.promptTokens ?? 0}↓ / ${
        enrichment.completionTokens ?? 0
      }↑ tok`
    )
  }
  if (parts.length === 0) return null
  return (
    <p className="pt-1 text-[10px] text-muted-foreground/60">
      {parts.join(" · ")}
    </p>
  )
}

