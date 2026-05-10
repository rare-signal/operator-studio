"use client"

/**
 * LaunchFallbackPanel — global recovery surface for failed
 * /agents/new-session attempts.
 *
 * Polls /api/operator-studio/agents/launch-attempts?status=pending and
 * renders one card per pending attempt. Each card carries the
 * verbatim prompt and stage-specific copy so the operator can:
 *
 *   - copy the prompt to the clipboard,
 *   - send it into an existing claude:/codex:/tmux: agent (proven
 *     /agents/:id/send path), and on success bind that agent to the
 *     attempt's planStepId,
 *   - dismiss the attempt (when it was retried + landed elsewhere).
 *
 * Intentionally minimal — it sits above the main content as a
 * compact stack of cards. The point is "your prompt is safe, here's
 * the boring proven fallback," NOT "do everything from here."
 */

import * as React from "react"

type Stage =
  | "hot-mode"
  | "validate"
  | "activate"
  | "focus-after-activate"
  | "new-session-shortcut"
  | "focus-after-new-session"
  | "clipboard-stage"
  | "paste"
  | "submit"
  | "reconcile"
  | "manual"
  | "paste-and-submit"

type LaunchAttempt = {
  id: string
  createdAt: string
  appKind: "claude" | "codex"
  prompt: string
  planStepId: string | null
  sourceRecommendationId: string | null
  stage: Stage
  message: string
  body: string
  suggestedActions: string[]
  errorRaw: string | null
  evidence: Record<string, unknown> | null
  status: "pending" | "resolved" | "dismissed"
  resolvedAgentId: string | null
}

type AgentSummary = {
  id: string
  kind: "tmux" | "claude" | "codex"
  label?: string
  title?: string
}

const POLL_INTERVAL_MS = 8_000

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return iso
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  return `${Math.round(ms / 3_600_000)}h ago`
}

export function LaunchFallbackPanel() {
  const [attempts, setAttempts] = React.useState<LaunchAttempt[] | null>(null)
  const [agents, setAgents] = React.useState<AgentSummary[]>([])
  const [collapsed, setCollapsed] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/operator-studio/agents/launch-attempts?status=pending", {
        cache: "no-store",
      })
      if (!res.ok) {
        // 401/403 — silently keep null so the panel never blocks the
        // page for non-admin viewers.
        setAttempts([])
        return
      }
      const data = (await res.json()) as { attempts?: LaunchAttempt[] }
      setAttempts(data.attempts ?? [])
    } catch {
      setAttempts([])
    }
  }, [])

  const refreshAgents = React.useCallback(async () => {
    try {
      const res = await fetch("/api/operator-studio/agents?appLimit=20", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as { items?: AgentSummary[] }
      setAgents(data.items ?? [])
    } catch {
      // best-effort
    }
  }, [])

  React.useEffect(() => {
    refresh()
    refreshAgents()
    const id = window.setInterval(refresh, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [refresh, refreshAgents])

  if (!attempts || attempts.length === 0) return null

  return (
    <div
      data-testid="launch-fallback-panel"
      className="border-b border-amber-500/30 bg-amber-500/5"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-2 text-xs">
        <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
          <span aria-hidden>⚠</span>
          <span>
            {attempts.length} prompt{attempts.length === 1 ? "" : "s"} waiting on
            fallback recovery
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded border border-border bg-background/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>
      {!collapsed && (
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pb-3">
          {attempts.map((a) => (
            <FallbackCard
              key={a.id}
              attempt={a}
              agents={agents}
              onResolved={refresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FallbackCard({
  attempt,
  agents,
  onResolved,
}: {
  attempt: LaunchAttempt
  agents: AgentSummary[]
  onResolved: () => void
}) {
  const [selectedAgentId, setSelectedAgentId] = React.useState<string>(() => {
    const sameKind = agents.find((a) => a.kind === attempt.appKind)
    return sameKind?.id ?? agents[0]?.id ?? ""
  })
  const [busy, setBusy] = React.useState<null | "send" | "copy" | "dismiss">(null)
  const [error, setError] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (selectedAgentId) return
    const sameKind = agents.find((a) => a.kind === attempt.appKind)
    if (sameKind) setSelectedAgentId(sameKind.id)
    else if (agents[0]) setSelectedAgentId(agents[0].id)
  }, [agents, selectedAgentId, attempt.appKind])

  const filteredAgents = agents.filter(
    (a) => a.kind === attempt.appKind || a.kind === "tmux"
  )

  async function copyPrompt() {
    setBusy("copy")
    setError(null)
    try {
      await navigator.clipboard.writeText(attempt.prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed")
    } finally {
      setBusy(null)
    }
  }

  async function sendToExisting() {
    if (!selectedAgentId) {
      setError("Pick an agent to send into.")
      return
    }
    setBusy("send")
    setError(null)
    try {
      // 1. Send the prompt into the chosen pane via the proven
      //    /agents/:id/send route — this is the path David called
      //    out as the boring one that always works.
      const sendRes = await fetch(
        `/api/operator-studio/agents/${encodeURIComponent(selectedAgentId)}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: attempt.prompt, submit: true }),
        }
      )
      if (!sendRes.ok) {
        const data = await sendRes.json().catch(() => ({}))
        throw new Error(data.error ?? `Send failed (${sendRes.status})`)
      }
      // 2. Mark the attempt resolved with the agent we sent to —
      //    the resolve endpoint also performs the agent → plan-step
      //    binding when planStepId is set on the attempt.
      const resRes = await fetch(
        `/api/operator-studio/agents/launch-attempts/${encodeURIComponent(attempt.id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved", agentId: selectedAgentId }),
        }
      )
      if (!resRes.ok) {
        // Send already landed; resolution failure is annoying but
        // not catastrophic — surface but still call onResolved so
        // the operator can refresh and try dismiss manually.
        const data = await resRes.json().catch(() => ({}))
        setError(`Sent, but resolution failed: ${data.error ?? resRes.status}`)
      }
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed")
    } finally {
      setBusy(null)
    }
  }

  async function dismiss() {
    setBusy("dismiss")
    setError(null)
    try {
      const res = await fetch(
        `/api/operator-studio/agents/launch-attempts/${encodeURIComponent(attempt.id)}`,
        { method: "DELETE" }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Dismiss failed (${res.status})`)
      }
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dismiss failed")
    } finally {
      setBusy(null)
    }
  }

  const promptPreview =
    attempt.prompt.length > 320
      ? attempt.prompt.slice(0, 320) + "…"
      : attempt.prompt

  return (
    <div className="rounded-lg border border-amber-500/40 bg-card px-4 py-3 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-amber-700 dark:text-amber-300">
            {attempt.appKind}
          </span>
          <span className="rounded border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            stage: {attempt.stage}
          </span>
          {attempt.planStepId && (
            <span className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground" title={attempt.planStepId}>
              plan card bind on resolve
            </span>
          )}
          <span className="text-[11px] text-muted-foreground">
            {fmtRelative(attempt.createdAt)}
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy !== null}
          className="rounded border border-border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>

      <div className="mt-2">
        <div className="text-[13px] font-semibold text-foreground">
          {attempt.message}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {attempt.body}
        </p>
      </div>

      {attempt.errorRaw && (
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical detail</summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/40 p-2 text-[11px] font-mono">
            {attempt.errorRaw}
          </pre>
        </details>
      )}

      <details className="mt-2 rounded border border-border bg-muted/20 p-2">
        <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Recovered prompt ({attempt.prompt.length.toLocaleString()} chars)
        </summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[12px] leading-snug text-foreground">
          {promptPreview}
        </pre>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyPrompt}
          disabled={busy !== null}
          className="rounded-md border border-border bg-background px-2.5 py-1 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
        >
          {copied ? "Copied ✓" : busy === "copy" ? "Copying…" : "Copy prompt"}
        </button>

        <div className="flex items-center gap-1.5">
          <select
            aria-label="Choose existing agent to receive the prompt"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            disabled={busy !== null || filteredAgents.length === 0}
            className="rounded-md border border-border bg-background px-2 py-1 text-[12px]"
          >
            {filteredAgents.length === 0 && (
              <option value="">No agents available</option>
            )}
            {filteredAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.kind}: {a.title ?? a.label ?? a.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={sendToExisting}
            disabled={busy !== null || !selectedAgentId}
            className="rounded-md border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-200"
          >
            {busy === "send" ? "Sending…" : "Send to selected"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 text-[12px] text-rose-600 dark:text-rose-400">{error}</div>
      )}
    </div>
  )
}
