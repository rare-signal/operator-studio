import { describe, it, expect } from "vitest"

import {
  computeSessions,
  defaultSessionLabel,
  findSessionForTimestamp,
  sessionIdFromStart,
  type ActivityPoint,
} from "./sessions"

/**
 * Session segmentation is the foundation of the whole Session Space
 * feature — if the boundaries are wrong, every view downstream is
 * wrong. Lock the edge cases down hard.
 */

function activityAt(id: string, iso: string): ActivityPoint {
  return { id, timestamp: iso }
}

describe("computeSessions", () => {
  it("returns empty array for empty input", () => {
    expect(computeSessions([])).toEqual([])
  })

  it("returns one session of zero duration for a single activity", () => {
    const t = "2026-04-21T10:00:00.000Z"
    const sessions = computeSessions([activityAt("a", t)])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].startedAt.toISOString()).toBe(t)
    expect(sessions[0].endedAt.toISOString()).toBe(t)
    expect(sessions[0].activityIds).toEqual(["a"])
  })

  it("groups activity within 3h into a single session", () => {
    const sessions = computeSessions([
      activityAt("a", "2026-04-21T10:00:00Z"),
      activityAt("b", "2026-04-21T10:30:00Z"),
      activityAt("c", "2026-04-21T12:00:00Z"), // 2h after a
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activityIds).toEqual(["a", "b", "c"])
  })

  it("splits on a 3h+ gap", () => {
    const sessions = computeSessions([
      activityAt("a", "2026-04-21T09:00:00Z"),
      activityAt("b", "2026-04-21T09:30:00Z"),
      // 3.5h gap
      activityAt("c", "2026-04-21T13:00:00Z"),
      activityAt("d", "2026-04-21T13:30:00Z"),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions[0].activityIds).toEqual(["a", "b"])
    expect(sessions[1].activityIds).toEqual(["c", "d"])
  })

  it("splits exactly at the gap threshold (>= is the boundary)", () => {
    // Activity b is exactly 3h after a → should start a new session
    // (we use >= gapMs, so the threshold itself triggers a split).
    const sessions = computeSessions([
      activityAt("a", "2026-04-21T09:00:00Z"),
      activityAt("b", "2026-04-21T12:00:00Z"),
    ])
    expect(sessions).toHaveLength(2)
  })

  it("does not split at just under the gap threshold", () => {
    const sessions = computeSessions([
      activityAt("a", "2026-04-21T09:00:00Z"),
      activityAt("b", "2026-04-21T11:59:59Z"), // 2h59m59s later
    ])
    expect(sessions).toHaveLength(1)
  })

  it("handles many sessions across multiple days", () => {
    const sessions = computeSessions([
      activityAt("m1", "2026-04-20T09:00:00Z"), // Mon morning
      activityAt("m2", "2026-04-20T11:00:00Z"),
      activityAt("m3", "2026-04-20T18:00:00Z"), // 7h gap → new session
      activityAt("t1", "2026-04-21T09:00:00Z"), // next day → new session
      activityAt("t2", "2026-04-21T10:00:00Z"),
    ])
    expect(sessions).toHaveLength(3)
    expect(sessions[0].activityIds).toEqual(["m1", "m2"])
    expect(sessions[1].activityIds).toEqual(["m3"])
    expect(sessions[2].activityIds).toEqual(["t1", "t2"])
  })

  it("sorts unsorted input before segmenting", () => {
    const sessions = computeSessions([
      activityAt("c", "2026-04-21T13:00:00Z"),
      activityAt("a", "2026-04-21T09:00:00Z"),
      activityAt("b", "2026-04-21T09:30:00Z"),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions[0].activityIds).toEqual(["a", "b"])
    expect(sessions[1].activityIds).toEqual(["c"])
  })

  it("accepts Date objects in addition to ISO strings", () => {
    const sessions = computeSessions([
      { id: "a", timestamp: new Date("2026-04-21T10:00:00Z") },
      { id: "b", timestamp: new Date("2026-04-21T11:00:00Z") },
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activityIds).toEqual(["a", "b"])
  })

  it("respects a custom gapHours override", () => {
    // 2h gap with default (3h) = one session.
    // 2h gap with gapHours=1 = two sessions.
    const activity = [
      activityAt("a", "2026-04-21T09:00:00Z"),
      activityAt("b", "2026-04-21T11:00:00Z"),
    ]
    expect(computeSessions(activity)).toHaveLength(1)
    expect(computeSessions(activity, { gapHours: 1 })).toHaveLength(2)
  })

  it("handles duplicate timestamps as same-session", () => {
    const t = "2026-04-21T10:00:00.000Z"
    const sessions = computeSessions([
      activityAt("a", t),
      activityAt("b", t),
      activityAt("c", t),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0].activityIds).toEqual(["a", "b", "c"])
    expect(sessions[0].startedAt.toISOString()).toBe(t)
    expect(sessions[0].endedAt.toISOString()).toBe(t)
  })
})

describe("sessionIdFromStart", () => {
  it("is deterministic for the same workspace + start time", () => {
    const a = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:00Z"))
    const b = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:00Z"))
    expect(a).toBe(b)
  })

  it("differs across workspaces for the same time", () => {
    const a = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:00Z"))
    const b = sessionIdFromStart("ws-2", new Date("2026-04-21T10:00:00Z"))
    expect(a).not.toBe(b)
  })

  it("stays stable across seconds-level drift (minute resolution)", () => {
    // A session that grows by a few seconds shouldn't change ids —
    // otherwise upserts would create duplicates as the session
    // accumulates late activity.
    const a = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:00Z"))
    const b = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:45Z"))
    expect(a).toBe(b)
  })

  it("differs across minute boundaries", () => {
    const a = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:00Z"))
    const b = sessionIdFromStart("ws-1", new Date("2026-04-21T10:01:00Z"))
    expect(a).not.toBe(b)
  })

  it("produces a safe id without colons or special chars", () => {
    const id = sessionIdFromStart("ws-1", new Date("2026-04-21T10:00:00Z"))
    expect(id).toMatch(/^[a-zA-Z0-9-]+$/)
  })
})

describe("findSessionForTimestamp", () => {
  const sessions = [
    { id: "s1", startedAt: "2026-04-21T09:00:00Z", endedAt: "2026-04-21T11:00:00Z" },
    { id: "s2", startedAt: "2026-04-21T14:00:00Z", endedAt: "2026-04-21T17:00:00Z" },
    { id: "s3", startedAt: "2026-04-22T09:00:00Z", endedAt: "2026-04-22T10:00:00Z" },
  ]

  it("returns null for empty sessions", () => {
    expect(findSessionForTimestamp([], "2026-04-21T10:00:00Z")).toBeNull()
  })

  it("returns null for an invalid timestamp", () => {
    expect(findSessionForTimestamp(sessions, "not-a-date")).toBeNull()
  })

  it("finds the session whose range contains the timestamp", () => {
    expect(findSessionForTimestamp(sessions, "2026-04-21T10:00:00Z")?.id).toBe("s1")
    expect(findSessionForTimestamp(sessions, "2026-04-21T15:30:00Z")?.id).toBe("s2")
    expect(findSessionForTimestamp(sessions, "2026-04-22T09:30:00Z")?.id).toBe("s3")
  })

  it("treats the endpoints as inclusive on both ends", () => {
    expect(findSessionForTimestamp(sessions, "2026-04-21T09:00:00Z")?.id).toBe("s1")
    expect(findSessionForTimestamp(sessions, "2026-04-21T11:00:00Z")?.id).toBe("s1")
  })

  it("returns null when the timestamp falls in a gap between sessions", () => {
    expect(
      findSessionForTimestamp(sessions, "2026-04-21T12:00:00Z")
    ).toBeNull()
  })

  it("returns null when the timestamp is before the earliest session", () => {
    expect(
      findSessionForTimestamp(sessions, "2026-04-20T08:00:00Z")
    ).toBeNull()
  })

  it("returns null when the timestamp is after the latest session", () => {
    expect(
      findSessionForTimestamp(sessions, "2026-04-23T00:00:00Z")
    ).toBeNull()
  })

  it("prefers the most recently-started session when ranges overlap", () => {
    // Defensive: normal segmentation shouldn't produce overlapping sessions,
    // but if it ever does we want the most specific (latest-starting) match.
    const overlapping = [
      { id: "outer", startedAt: "2026-04-21T09:00:00Z", endedAt: "2026-04-21T18:00:00Z" },
      { id: "inner", startedAt: "2026-04-21T14:00:00Z", endedAt: "2026-04-21T15:00:00Z" },
    ]
    expect(findSessionForTimestamp(overlapping, "2026-04-21T14:30:00Z")?.id).toBe("inner")
  })
})

describe("defaultSessionLabel", () => {
  it("produces a human-readable label with day + bucket", () => {
    const label = defaultSessionLabel(new Date("2026-04-21T10:00:00"))
    expect(label).toMatch(/morning/)
  })

  it("buckets by time of day", () => {
    // Note: buckets are local-time; use explicit local-time Date construction.
    expect(defaultSessionLabel(new Date(2026, 3, 21, 3, 0))).toMatch(/overnight/)
    expect(defaultSessionLabel(new Date(2026, 3, 21, 10, 0))).toMatch(/morning/)
    expect(defaultSessionLabel(new Date(2026, 3, 21, 14, 0))).toMatch(/afternoon/)
    expect(defaultSessionLabel(new Date(2026, 3, 21, 19, 0))).toMatch(/evening/)
    expect(defaultSessionLabel(new Date(2026, 3, 21, 22, 0))).toMatch(/late night/)
  })
})
