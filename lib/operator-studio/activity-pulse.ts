/**
 * Activity pulse — message density across a session's timeline.
 *
 * Session Spaces are long (minutes → hours). Within a session, activity
 * isn't flat — you burst, pause, pivot, then resume. The pulse is a
 * per-bucket count of messages over the session's window, rendered as
 * a tiny sparkline on the detail page. Lets the user see "oh, the
 * heavy work was the first 20 minutes" or "we sprinted at the end"
 * without scrubbing through turns.
 *
 * Pure function, no DOM. Caller supplies messages + session bounds,
 * we bucket and count. Bucket width auto-scales with the session's
 * duration so we always produce ~30 bars regardless of whether the
 * session was 15m or 6h.
 */

export interface PulseBucket {
  /** Start of the bucket (ISO). */
  startedAt: string
  /** End of the bucket (ISO, exclusive). */
  endedAt: string
  /** Message count in this bucket. */
  count: number
}

export interface PulseInput {
  sessionStart: string | Date
  sessionEnd: string | Date
  /** Messages in this session. Order doesn't matter. */
  messages: Array<{ createdAt: string | Date }>
  /** Target number of buckets. Default 30. */
  targetBuckets?: number
}

function toEpoch(t: string | Date): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime()
}

export function computeActivityPulse(input: PulseInput): PulseBucket[] {
  const start = toEpoch(input.sessionStart)
  const end = toEpoch(input.sessionEnd)
  const target = input.targetBuckets ?? 30

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return []
  }

  const totalMs = end - start
  // Bucket width: floor(totalMs / target), with a minimum of 30s so
  // we don't produce micro-buckets for very short sessions. For a 15m
  // session that means ~30 buckets of 30s each; for a 3h session
  // ~30 buckets of 6min each.
  const bucketMs = Math.max(30_000, Math.floor(totalMs / target))
  const bucketCount = Math.max(1, Math.ceil(totalMs / bucketMs))

  const counts = new Array<number>(bucketCount).fill(0)
  for (const m of input.messages) {
    const t = toEpoch(m.createdAt)
    if (!Number.isFinite(t)) continue
    if (t < start || t > end) continue
    const idx = Math.min(bucketCount - 1, Math.floor((t - start) / bucketMs))
    counts[idx]++
  }

  const buckets: PulseBucket[] = []
  for (let i = 0; i < bucketCount; i++) {
    buckets.push({
      startedAt: new Date(start + i * bucketMs).toISOString(),
      endedAt: new Date(
        Math.min(end, start + (i + 1) * bucketMs)
      ).toISOString(),
      count: counts[i],
    })
  }
  return buckets
}
