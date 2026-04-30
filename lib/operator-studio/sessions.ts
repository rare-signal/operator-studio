/**
 * Session segmentation — the pure logic.
 *
 * A "session" is a burst of LLM activity bracketed by a gap of N hours
 * or more. Default gap is 3 hours, chosen to match how humans actually
 * work: meals, meetings, sleep all break work into discrete sessions.
 *
 * This file is pure — no DB, no network, no side effects. The session
 * entity itself lives in `operator_sessions` and is materialized by
 * `ensureSessionsForWorkspace` in `queries.ts`. This module just
 * decides WHERE the boundaries are.
 *
 * Keeping the logic pure means it's:
 * - Testable without a DB (see `sessions.test.ts`)
 * - Reusable wherever we have timestamps (not just threads — future
 *   chat-turn-level segmentation, webhook event bursts, etc.)
 * - Easy to reason about when users inevitably ask "why is this thread
 *   in this session?"
 */

export interface ActivityPoint {
  /** Anything that identifies where this activity came from. */
  id: string
  /** ISO timestamp OR Date — we normalize to epoch ms internally. */
  timestamp: string | Date
}

export interface SessionSegment {
  /** Earliest activity in this session (inclusive). */
  startedAt: Date
  /** Latest activity in this session (inclusive). */
  endedAt: Date
  /** IDs of activity points that fall inside this session, in order. */
  activityIds: string[]
}

export interface ComputeSessionsOptions {
  /** Minimum gap (in hours) between activities to start a new session.
   *  Default 3h. */
  gapHours?: number
}

function toEpoch(t: string | Date): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime()
}

/**
 * Bucket a flat list of activity points into sessions.
 *
 * Algorithm: sort by timestamp, walk forward, start a new session
 * whenever the gap from the previous activity exceeds `gapHours`.
 *
 * Edge cases:
 * - Empty input → empty output.
 * - Single activity → one session of duration zero.
 * - All activity within one gap window → one session covering all.
 * - Duplicate timestamps → bucketed into the same session (order
 *   preserved from input for ties).
 */
export function computeSessions(
  activity: ActivityPoint[],
  opts: ComputeSessionsOptions = {}
): SessionSegment[] {
  if (activity.length === 0) return []

  const gapMs = (opts.gapHours ?? 3) * 60 * 60 * 1000

  // Sort ascending by timestamp. Stable on ties (preserves input order).
  const sorted = [...activity]
    .map((a) => ({ ...a, _epoch: toEpoch(a.timestamp) }))
    .sort((a, b) => a._epoch - b._epoch)

  const sessions: SessionSegment[] = []
  let current: {
    startEpoch: number
    endEpoch: number
    activityIds: string[]
  } | null = null

  for (const point of sorted) {
    if (current === null) {
      current = {
        startEpoch: point._epoch,
        endEpoch: point._epoch,
        activityIds: [point.id],
      }
      continue
    }

    const gap = point._epoch - current.endEpoch
    if (gap >= gapMs) {
      // Close out the current session and start a new one.
      sessions.push({
        startedAt: new Date(current.startEpoch),
        endedAt: new Date(current.endEpoch),
        activityIds: current.activityIds,
      })
      current = {
        startEpoch: point._epoch,
        endEpoch: point._epoch,
        activityIds: [point.id],
      }
    } else {
      current.endEpoch = point._epoch
      current.activityIds.push(point.id)
    }
  }

  if (current !== null) {
    sessions.push({
      startedAt: new Date(current.startEpoch),
      endedAt: new Date(current.endEpoch),
      activityIds: current.activityIds,
    })
  }

  return sessions
}

/**
 * Generate a stable, deterministic session id from its start timestamp.
 * Used when materializing sessions — two runs over the same activity
 * produce the same ids, so upserts are idempotent.
 */
export function sessionIdFromStart(
  workspaceId: string,
  startedAt: Date
): string {
  // Minute-resolution — a session that grows by a few seconds as new
  // activity arrives keeps the same id.
  const iso = startedAt.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
  return `session-${workspaceId}-${iso}`.replace(/[^a-zA-Z0-9-]/g, "-")
}

/**
 * Find the session whose time range contains the given ISO timestamp.
 *
 * Used when promoting a message from a thread detail page — the caller
 * knows the message's `createdAt` and needs to know which session (if
 * any) that message landed in, so the promote menu can offer the right
 * plan steps.
 *
 * If multiple sessions overlap the timestamp (shouldn't happen given
 * how segmentation works, but defensively), the one with the latest
 * `startedAt` wins — that's the most specific match. Returns `null`
 * when the timestamp falls outside every session window (including
 * empty input, invalid timestamp, or a gap between sessions).
 *
 * The range is inclusive on both ends: a message created exactly at
 * `startedAt` or `endedAt` counts as inside.
 */
export function findSessionForTimestamp<
  T extends { startedAt: string; endedAt: string },
>(sessions: readonly T[], iso: string): T | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null

  let best: T | null = null
  let bestStart = -Infinity
  for (const s of sessions) {
    const start = new Date(s.startedAt).getTime()
    const end = new Date(s.endedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (t < start || t > end) continue
    if (start > bestStart) {
      best = s
      bestStart = start
    }
  }
  return best
}

/**
 * Derive a human-readable default label from a session's time range.
 * Examples:
 *   start 9a, end 11a (2h)            → "Apr 21 morning"
 *   start 9a, end 1p (4h)             → "Apr 21 morning → afternoon"
 *   start 6:42a, end 6:58p (12h)      → "Apr 21 all day"
 *   start 11p Apr 21, end 2a Apr 22   → "Apr 21 late night"
 *
 * Without `endedAt` the function falls back to the start-only bucket
 * (legacy behavior) — callers should pass it so the label reflects
 * the actual span. A "MORNING" pin on a 12-hour session reads as a
 * bug to anyone looking at the rail.
 */
export function defaultSessionLabel(
  startedAt: Date,
  endedAt?: Date
): string {
  const day = startedAt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })
  const startBucket = bucketFor(startedAt.getHours())
  if (!endedAt) return `${day} ${startBucket}`

  const durationMs = endedAt.getTime() - startedAt.getTime()
  const durationHours = durationMs / 3_600_000
  // Anything ≥ 10 hours is unambiguously "all day" regardless of the
  // start hour. This is the common shape that drove the rail UX bug
  // — a 12h session pinned as "morning" because it merely started
  // before noon.
  if (durationHours >= 10) return `${day} all day`

  const endBucket = bucketFor(endedAt.getHours())
  if (endBucket === startBucket || durationHours < 3.5) {
    return `${day} ${startBucket}`
  }
  return `${day} ${startBucket} → ${endBucket}`
}

function bucketFor(hour: number): string {
  if (hour < 5) return "overnight"
  if (hour < 12) return "morning"
  if (hour < 17) return "afternoon"
  if (hour < 21) return "evening"
  return "late night"
}
