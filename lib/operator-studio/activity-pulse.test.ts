import { describe, it, expect } from "vitest"

import { computeActivityPulse } from "./activity-pulse"

describe("computeActivityPulse", () => {
  it("returns empty for invalid range", () => {
    expect(
      computeActivityPulse({
        sessionStart: "2026-04-22T12:00:00Z",
        sessionEnd: "2026-04-22T12:00:00Z",
        messages: [],
      })
    ).toEqual([])
  })

  it("produces ~target buckets for a multi-hour session", () => {
    const start = "2026-04-22T10:00:00Z"
    const end = "2026-04-22T13:00:00Z" // 3h
    const buckets = computeActivityPulse({
      sessionStart: start,
      sessionEnd: end,
      messages: [],
      targetBuckets: 30,
    })
    // With 3h / 30 = 6min buckets, we expect ~30 entries.
    expect(buckets.length).toBeGreaterThanOrEqual(29)
    expect(buckets.length).toBeLessThanOrEqual(31)
  })

  it("counts messages into their bucket", () => {
    const start = "2026-04-22T10:00:00Z"
    const end = "2026-04-22T11:00:00Z" // 1h
    const buckets = computeActivityPulse({
      sessionStart: start,
      sessionEnd: end,
      messages: [
        { createdAt: "2026-04-22T10:01:00Z" }, // bucket 0
        { createdAt: "2026-04-22T10:02:00Z" }, // bucket 0 or 1 depending
        { createdAt: "2026-04-22T10:59:00Z" }, // near last bucket
      ],
      targetBuckets: 30,
    })
    const total = buckets.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(3)
    // First two messages near session start → in the first bucket
    expect(buckets[0].count).toBeGreaterThanOrEqual(1)
    // Last message is in the last-ish bucket
    expect(buckets[buckets.length - 1].count).toBeGreaterThanOrEqual(1)
  })

  it("ignores messages outside the window", () => {
    const buckets = computeActivityPulse({
      sessionStart: "2026-04-22T10:00:00Z",
      sessionEnd: "2026-04-22T11:00:00Z",
      messages: [
        { createdAt: "2026-04-22T09:00:00Z" }, // before
        { createdAt: "2026-04-22T12:00:00Z" }, // after
        { createdAt: "2026-04-22T10:30:00Z" }, // inside
      ],
    })
    const total = buckets.reduce((s, b) => s + b.count, 0)
    expect(total).toBe(1)
  })

  it("enforces a minimum 30s bucket width for short sessions", () => {
    // 60s session — if we used totalMs / 30 we'd get 2s buckets which
    // are pointless. The floor should clamp to 30s → 2 buckets.
    const buckets = computeActivityPulse({
      sessionStart: "2026-04-22T10:00:00Z",
      sessionEnd: "2026-04-22T10:01:00Z",
      messages: [],
    })
    expect(buckets.length).toBeLessThanOrEqual(2)
  })
})
