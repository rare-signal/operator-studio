"use client"

import * as React from "react"

/**
 * Inset pulsation overlay for a chat-pane container.
 *
 * Two states, same 3s cadence:
 *   - working = true   → blue, always on (informational, never suppressed).
 *   - working = false  → red, suppressed for 5s after any mouse/key
 *                         activity anywhere in the page.
 *
 * Asymmetric hysteresis on the `working` prop fixes a real signal-thrash
 * problem: `agent.status` momentarily passes through `"idle"` between
 * turns (tool-result handoffs, streaming→thinking transitions), and a
 * direct read produces false red flashes during sustained work. We
 * flip ON instantly (snappy — blue lights up the moment the agent
 * starts working) and flip OFF only after IDLE_SETTLE_MS of sustained
 * idleness. Net effect: red only appears when the agent is actually at
 * rest, never as a stutter during a turn handoff.
 *
 * The activity detector is module-shared (one window listener pair for
 * the whole page) so dropping the indicator on multiple BentoPanes at
 * once doesn't multiply the cost of `mousemove`. Mousemove is throttled
 * by a "last-seen" timestamp — we only need to know the user moved,
 * not react to every pixel.
 *
 * Parent must establish a positioning context (`relative`) and clip its
 * overflow if it has rounded corners; this overlay is absolutely
 * positioned with `inset: 0` and `pointer-events: none`.
 */
export function ChatPulsationIndicator({
  working,
}: {
  working: boolean
}): React.ReactElement | null {
  const userActive = useUserActivity(USER_IDLE_SUPPRESSION_MS)
  const settledWorking = useSettledWorking(working, IDLE_SETTLE_MS)

  // Working wins over suppression — when the AI starts streaming, we
  // want the blue cue immediately even if the operator just moved their
  // mouse to read.
  const cls = settledWorking
    ? "chat-pulse-working"
    : userActive
      ? null
      : "chat-pulse-idle"

  if (cls === null) return null

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 rounded-[inherit] ${cls}`}
      data-testid="chat-pulsation-indicator"
      data-state={settledWorking ? "working" : "idle"}
    />
  )
}

/** Asymmetric debounce: ON is instant, OFF waits for the signal to
 *  stay low for `settleMs`. Any transient flip back to true cancels the
 *  pending OFF, so a tool-result→thinking handoff that flickers idle
 *  for <settleMs never reaches the indicator. */
function useSettledWorking(working: boolean, settleMs: number): boolean {
  const [settled, setSettled] = React.useState(working)

  React.useEffect(() => {
    if (working) {
      setSettled(true)
      return
    }
    const t = window.setTimeout(() => setSettled(false), settleMs)
    return () => window.clearTimeout(t)
  }, [working, settleMs])

  return settled
}

/** How long the working signal has to stay false before the indicator
 *  is allowed to flip to idle/red. Slightly less than one pulse cycle
 *  (3s) so a steady idle still gets a full visible cycle within ~5s,
 *  but long enough to swallow turn-handoff hiccups (observed up to ~1s
 *  during tool_use→tool_result→thinking). */
const IDLE_SETTLE_MS = 2000

const USER_IDLE_SUPPRESSION_MS = 5000
// Mousemove fires constantly — only update the shared timestamp if at
// least this many ms have passed since the last write. Keeps render
// thrash off the table for the (often many) panes subscribing.
const MOUSEMOVE_THROTTLE_MS = 200

type Listener = (active: boolean) => void

const listeners = new Set<Listener>()
let lastActivityAt = 0
let suppressionTimer: number | null = null
let listenersInstalled = false

function setUserActive(active: boolean) {
  for (const fn of listeners) fn(active)
}

function bumpActivity() {
  const now = Date.now()
  if (now - lastActivityAt < MOUSEMOVE_THROTTLE_MS) return
  lastActivityAt = now
  setUserActive(true)
  if (suppressionTimer !== null) window.clearTimeout(suppressionTimer)
  suppressionTimer = window.setTimeout(() => {
    suppressionTimer = null
    setUserActive(false)
  }, USER_IDLE_SUPPRESSION_MS)
}

function ensureWindowListeners() {
  if (listenersInstalled) return
  if (typeof window === "undefined") return
  listenersInstalled = true
  window.addEventListener("mousemove", bumpActivity, { passive: true })
  window.addEventListener("keydown", bumpActivity)
  // Pointer events cover trackpad-on-touch and stylus — cheap to add
  // and means we also pick up tap-on-iPad cases without separate touch
  // listeners.
  window.addEventListener("pointermove", bumpActivity, { passive: true })
}

function useUserActivity(_suppressionMs: number): boolean {
  const [active, setActive] = React.useState(false)

  React.useEffect(() => {
    ensureWindowListeners()
    const fn: Listener = (next) => setActive(next)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])

  return active
}
