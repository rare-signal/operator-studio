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

  // Working wins over suppression — when the AI starts streaming, we
  // want the blue cue immediately even if the operator just moved their
  // mouse to read.
  const cls = working
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
      data-state={working ? "working" : "idle"}
    />
  )
}

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
