import { describe, it, expect } from "vitest"

import {
  buildSessionGraph,
  type GraphNodeInput,
} from "./session-graph"

function makeThread(overrides: Partial<GraphNodeInput>): GraphNodeInput {
  return {
    id: overrides.id ?? "t",
    parentThreadId: overrides.parentThreadId ?? null,
    createdAt: overrides.createdAt ?? "2026-04-21T10:00:00Z",
    title: overrides.title ?? "Untitled",
    reviewState: overrides.reviewState ?? "imported",
    messageCount: overrides.messageCount ?? 0,
    sourceApp: overrides.sourceApp ?? "claude",
  }
}

describe("buildSessionGraph", () => {
  it("handles empty input", () => {
    const g = buildSessionGraph([])
    expect(g).toEqual({ nodes: [], edges: [], columns: 0, rows: 0 })
  })

  it("a single thread with no parent is one root", () => {
    const g = buildSessionGraph([makeThread({ id: "a" })])
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0].column).toBe(0)
    expect(g.nodes[0].row).toBe(0)
    expect(g.edges).toEqual([])
    expect(g.columns).toBe(1)
    expect(g.rows).toBe(1)
  })

  it("two unrelated threads become two roots stacked vertically", () => {
    const g = buildSessionGraph([
      makeThread({ id: "a", createdAt: "2026-04-21T10:00:00Z" }),
      makeThread({ id: "b", createdAt: "2026-04-21T11:00:00Z" }),
    ])
    expect(g.nodes).toHaveLength(2)
    // Both in column 0, distinct rows
    expect(g.nodes[0]).toMatchObject({ id: "a", column: 0, row: 0 })
    expect(g.nodes[1]).toMatchObject({ id: "b", column: 0, row: 1 })
    expect(g.edges).toEqual([])
  })

  it("fork goes into column 1 with an edge from parent", () => {
    const g = buildSessionGraph([
      makeThread({ id: "a", createdAt: "2026-04-21T10:00:00Z" }),
      makeThread({
        id: "b",
        parentThreadId: "a",
        createdAt: "2026-04-21T10:30:00Z",
      }),
    ])
    expect(g.nodes).toHaveLength(2)
    expect(g.nodes.find((n) => n.id === "a")?.column).toBe(0)
    expect(g.nodes.find((n) => n.id === "b")?.column).toBe(1)
    expect(g.edges).toEqual([{ fromId: "a", toId: "b" }])
    expect(g.columns).toBe(2)
  })

  it("forks-of-forks cascade into deeper columns", () => {
    const g = buildSessionGraph([
      makeThread({ id: "a" }),
      makeThread({ id: "b", parentThreadId: "a", createdAt: "2026-04-21T10:30:00Z" }),
      makeThread({ id: "c", parentThreadId: "b", createdAt: "2026-04-21T11:00:00Z" }),
    ])
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]))
    expect(byId.a.column).toBe(0)
    expect(byId.b.column).toBe(1)
    expect(byId.c.column).toBe(2)
    expect(g.edges).toEqual([
      { fromId: "a", toId: "b" },
      { fromId: "b", toId: "c" },
    ])
    expect(g.columns).toBe(3)
  })

  it("parent-not-in-session is treated as a root (no cross-session edges)", () => {
    const g = buildSessionGraph([
      makeThread({ id: "fork", parentThreadId: "outside-session" }),
    ])
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0]).toMatchObject({ id: "fork", column: 0, row: 0 })
    expect(g.edges).toEqual([])
  })

  it("siblings of the same parent stack vertically", () => {
    const g = buildSessionGraph([
      makeThread({ id: "p" }),
      makeThread({
        id: "c1",
        parentThreadId: "p",
        createdAt: "2026-04-21T11:00:00Z",
      }),
      makeThread({
        id: "c2",
        parentThreadId: "p",
        createdAt: "2026-04-21T12:00:00Z",
      }),
    ])
    const c1 = g.nodes.find((n) => n.id === "c1")!
    const c2 = g.nodes.find((n) => n.id === "c2")!
    expect(c1.column).toBe(1)
    expect(c2.column).toBe(1)
    expect(c1.row).not.toBe(c2.row)
    expect(g.edges).toEqual([
      { fromId: "p", toId: "c1" },
      { fromId: "p", toId: "c2" },
    ])
  })

  it("sorts children by creation time", () => {
    const g = buildSessionGraph([
      makeThread({ id: "p" }),
      // Inserted in reverse time order — layout should still order
      // the earliest child first.
      makeThread({
        id: "late",
        parentThreadId: "p",
        createdAt: "2026-04-21T13:00:00Z",
      }),
      makeThread({
        id: "early",
        parentThreadId: "p",
        createdAt: "2026-04-21T11:00:00Z",
      }),
    ])
    const earlyIdx = g.nodes.findIndex((n) => n.id === "early")
    const lateIdx = g.nodes.findIndex((n) => n.id === "late")
    expect(earlyIdx).toBeLessThan(lateIdx)
  })

  it("defends against a cycle (parent points back to child)", () => {
    // Shouldn't happen in practice but the guard prevents an infinite
    // loop if the DB gets corrupted.
    const g = buildSessionGraph([
      makeThread({ id: "a", parentThreadId: "b" }),
      makeThread({ id: "b", parentThreadId: "a" }),
    ])
    // One of them becomes a root; the other is reachable. Exact order
    // depends on insertion order, but we should produce exactly 2
    // nodes and terminate.
    expect(g.nodes).toHaveLength(2)
  })
})
