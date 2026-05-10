"use client"

/**
 * Visible indicator for the server-side desktop control micro-lease.
 *
 * When Operator Studio is firing AppleScript keystrokes (new-session
 * Cmd+N, paste, submit), the user sees a small chip in the shell
 * header: "Operator controlling Claude — 2.1s". The intent is honesty
 * — David shares this workstation with the operator, and a visible
 * chip + countdown means he can never wonder "did Operator Studio
 * just hijack my keyboard?". The lease itself is short (≤ 4s), so
 * the chip's job is to be unambiguous, not to be cancellable —
 * waiting it out is faster than any cancel button would be.
 *
 * Polling is visibility-gated and asymmetric: 1s while a lease is
 * active so the countdown stays accurate; 5s while idle. We keep the
 * chip rendered for 1.5s after release so back-to-back phases of one
 * logical operation (activate → new-session → paste → submit) don't
 * visibly flicker between leases.
 */

import * as React from "react"
import { Hand } from "lucide-react"

interface LeaseSnapshot {
  active: {
    id: string
    targetApp: string
    purpose: string
    stage: string | null
    acquiredAt: string
    expiresAt: string
    lastFrontmost: string | null
  } | null
  lastEndedAt: string | null
  lastTargetApp: string | null
  lastPurpose: string | null
}

const HOLDOVER_MS = 1500
const ACTIVE_POLL_MS = 1000
const IDLE_POLL_MS = 5000

export function DesktopLeaseIndicator() {
  const [snapshot, setSnapshot] = React.useState<LeaseSnapshot | null>(null)
  const [now, setNow] = React.useState(() => Date.now())

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/operator-studio/agents/desktop-lease", {
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as LeaseSnapshot
      setSnapshot(data)
    } catch {
      // Indicator is observational; a transient error means the chip
      // disappears for one tick — never break the rest of the shell.
    }
  }, [])

  React.useEffect(() => {
    refresh()
    let cadence: number = IDLE_POLL_MS
    let timer: number | null = null
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        timer = window.setTimeout(tick, cadence)
        return
      }
      void refresh()
      cadence = snapshot?.active ? ACTIVE_POLL_MS : IDLE_POLL_MS
      timer = window.setTimeout(tick, cadence)
    }
    timer = window.setTimeout(tick, IDLE_POLL_MS)
    const onVisible = () => {
      if (!document.hidden) refresh()
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible)
    }
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible)
      }
    }
  }, [refresh, snapshot?.active])

  // Animate the countdown between server polls so the remaining-ms
  // figure visibly ticks down rather than jumping in 1s steps.
  React.useEffect(() => {
    if (!snapshot?.active) return
    const id = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(id)
  }, [snapshot?.active])

  if (!snapshot) return null

  const active = snapshot.active
  if (active) {
    const remainingMs = Math.max(
      0,
      new Date(active.expiresAt).getTime() - now
    )
    return (
      <Chip
        targetApp={active.targetApp}
        secondsLabel={(remainingMs / 1000).toFixed(1)}
        kind="active"
      />
    )
  }

  if (snapshot.lastEndedAt && snapshot.lastTargetApp) {
    const sinceEnd = Date.now() - new Date(snapshot.lastEndedAt).getTime()
    if (sinceEnd >= 0 && sinceEnd < HOLDOVER_MS) {
      return (
        <Chip
          targetApp={snapshot.lastTargetApp}
          secondsLabel="0.0"
          kind="holdover"
        />
      )
    }
  }
  return null
}

function Chip({
  targetApp,
  secondsLabel,
  kind,
}: {
  targetApp: string
  secondsLabel: string
  kind: "active" | "holdover"
}) {
  const tone =
    kind === "active"
      ? "bg-amber-500/15 text-amber-900 dark:text-amber-200 border-amber-500/40"
      : "bg-stone-500/10 text-stone-700 dark:text-stone-200 border-stone-500/30"
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={
        kind === "active"
          ? "Operator Studio is firing GUI keystrokes at this app. Auto-releases when the countdown hits 0."
          : "Recent desktop control just released. Workstation is yours."
      }
    >
      <Hand className="h-3 w-3" />
      <span>
        Operator controlling <strong>{targetApp}</strong>
      </span>
      <span className="tabular-nums opacity-80">— {secondsLabel}s</span>
    </span>
  )
}
