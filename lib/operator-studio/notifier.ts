/**
 * Push-notification helper for Operator Studio cockpit.
 *
 * Provider: **ntfy.sh** (hosted, free, anonymous topic). See
 * `scripts/data/push-notification-setup-2026-05-10.md` for the full
 * one-time setup walkthrough.
 *
 * Quick setup for David:
 *   1. Install the "ntfy" iOS app from the App Store.
 *   2. Tap "+" in the app → enter your topic name (any URL-safe string;
 *      hard-to-guess suffix recommended, e.g.
 *      `operator-studio-david-7Hq2L9xkP4mZw3Rt`). Treat the topic as a
 *      shared secret — anyone who knows it can publish to it.
 *   3. Add to `.env.local`:
 *        NTFY_TOPIC=operator-studio-david-<your random suffix>
 *        # OPERATOR_STUDIO_NOTIFICATIONS_ENABLED=1   (default)
 *   4. Restart the dev server. Confirm with:
 *        pnpm tsx scripts/push-notification-impl-acceptance.ts
 *
 * Recommendation provenance: KB entry
 *   kb-2026-05-10-push-notification-options-for-customer-of-one
 * Section 4 ("Recommendation"): ntfy.sh hosted, single topic, thin
 * server-side helper, ready-for-review trigger first.
 */

import type { ReviewStatus } from "./review-status"

const NTFY_BASE = "https://ntfy.sh"

/** Review statuses that should fire a phone alert when transitioned
 *  INTO from a non-ready status. Per the multi-tier review state
 *  machine, anything past `live`/`idle` that isn't `human-approved` is
 *  worth surfacing to David's phone. */
const READY_TIERS: ReadonlySet<ReviewStatus> = new Set<ReviewStatus>([
  "candidate-self-believed",
  "awaiting-berthier-check",
  "berthier-reviewed",
])

export function isReadyTier(s: ReviewStatus): boolean {
  return READY_TIERS.has(s)
}

export interface NotifyInput {
  title: string
  body: string
  /** Click-through URL; the ntfy iOS app opens this when the
   *  notification is tapped. */
  url?: string
  /** ntfy priority 1-5. Default 3 (default). */
  priority?: 1 | 2 | 3 | 4 | 5
  /** Emoji tag(s) shown in the notification (ntfy "Tags" header). */
  tags?: string[]
}

export interface NotifyResult {
  ok: boolean
  /** "sent" — wire call returned 2xx
   *  "captured" — test-mode in-memory capture (no wire call)
   *  "disabled" — feature flag off
   *  "rate-limited" — local token bucket dropped this call
   *  "unconfigured" — NTFY_TOPIC missing in env
   *  "error" — wire call failed */
  status:
    | "sent"
    | "captured"
    | "disabled"
    | "rate-limited"
    | "unconfigured"
    | "error"
  error?: string
}

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
const recentTimestamps: number[] = []

function rateLimitGate(now: number): boolean {
  while (recentTimestamps.length && now - recentTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
    recentTimestamps.shift()
  }
  if (recentTimestamps.length >= RATE_LIMIT_MAX) return false
  recentTimestamps.push(now)
  return true
}

interface CapturedNotification extends NotifyInput {
  at: string
}

const captured: CapturedNotification[] = []

function isEnabled(): boolean {
  const raw = process.env.OPERATOR_STUDIO_NOTIFICATIONS_ENABLED
  if (raw === undefined) return true
  return raw === "1" || raw.toLowerCase() === "true"
}

function isTestMode(): boolean {
  const raw = process.env.OPERATOR_STUDIO_NOTIFICATIONS_TEST_MODE
  return raw === "1" || raw?.toLowerCase() === "true"
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  if (!isEnabled()) return { ok: true, status: "disabled" }
  if (!rateLimitGate(Date.now())) {
    console.warn("[notifier] rate-limited; dropping notification:", input.title)
    return { ok: false, status: "rate-limited" }
  }
  if (isTestMode()) {
    captured.push({ ...input, at: new Date().toISOString() })
    return { ok: true, status: "captured" }
  }
  const topic = process.env.NTFY_TOPIC?.trim()
  if (!topic) {
    console.warn("[notifier] NTFY_TOPIC not set; notification skipped:", input.title)
    return { ok: false, status: "unconfigured" }
  }
  const headers: Record<string, string> = {
    Title: input.title,
    Priority: String(input.priority ?? 3),
  }
  if (input.url) headers.Click = input.url
  if (input.tags?.length) headers.Tags = input.tags.join(",")
  try {
    const res = await fetch(`${NTFY_BASE}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: input.body,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      const msg = `ntfy ${res.status}: ${text.slice(0, 200)}`
      console.warn("[notifier]", msg)
      return { ok: false, status: "error", error: msg }
    }
    return { ok: true, status: "sent" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn("[notifier] fetch failed:", msg)
    return { ok: false, status: "error", error: msg }
  }
}

/** Per-process memory of the last review status seen per agent. Used
 *  to detect transitions without persisting to the DB. Crash/restart
 *  loses the memory, which is fine: at worst David gets one extra
 *  alert when the route first observes a worker post-restart. */
const lastSeenStatus = new Map<string, ReviewStatus>()

export interface TransitionResult {
  transitioned: boolean
  previous: ReviewStatus | null
  current: ReviewStatus
  notified: NotifyResult | null
}

/** Record the latest reviewStatus for `agentId` and, if this represents
 *  a transition FROM a non-ready tier INTO a ready tier (and the
 *  worker is not yet human-approved), fire a notification. Fire-and-
 *  forget by the caller — the returned promise resolves with the
 *  result for tests, but route handlers can ignore it. */
export async function maybeNotifyOnReadyTransition(
  agentId: string,
  current: ReviewStatus,
  payload: { title: string; body: string; url?: string }
): Promise<TransitionResult> {
  const previous = lastSeenStatus.get(agentId) ?? null
  lastSeenStatus.set(agentId, current)
  // `human-approved` is terminal — never re-alert once David has signed
  // off, even if a subsequent compute flips back to a ready tier
  // (shouldn't happen, but be defensive).
  if (current === "human-approved") {
    return { transitioned: false, previous, current, notified: null }
  }
  const wasReady = previous !== null && isReadyTier(previous)
  const isReady = isReadyTier(current)
  if (!isReady || wasReady) {
    return { transitioned: false, previous, current, notified: null }
  }
  const notified = await notify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    priority: 4,
    tags: ["white_check_mark"],
  })
  return { transitioned: true, previous, current, notified }
}

// ────────────────────────────────────────────────────────────────────
// Test helpers — exported under a `__` prefix so production callers
// don't reach for them. Used by scripts/push-notification-impl-
// acceptance.ts to verify the transition logic without touching the
// network.
// ────────────────────────────────────────────────────────────────────

export function __resetNotifierForTest(): void {
  lastSeenStatus.clear()
  recentTimestamps.length = 0
  captured.length = 0
}

export function __getCapturedNotificationsForTest(): readonly CapturedNotification[] {
  return captured
}
