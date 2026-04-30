import { describe, it, expect } from "vitest"

import {
  extractDecisions,
  type DecisionMomentInput,
} from "./decision-extractor"

function msg(o: Partial<DecisionMomentInput>): DecisionMomentInput {
  return {
    id: o.id ?? "m",
    threadId: o.threadId ?? "t",
    threadTitle: o.threadTitle ?? "Thread",
    role: o.role ?? "assistant",
    content: o.content ?? "",
    turnIndex: o.turnIndex ?? 0,
    createdAt: o.createdAt ?? "2026-04-22T10:00:00Z",
  }
}

describe("extractDecisions", () => {
  it("returns empty for unrelated chatter", () => {
    expect(
      extractDecisions([
        msg({ content: "ok let me think about that" }),
        msg({ content: "what about this approach?" }),
      ])
    ).toEqual([])
  })

  it("catches explicit decision: marker", () => {
    const out = extractDecisions([
      msg({ id: "a", content: "Decision: ship chokidar even though it adds 50kb." }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].messageId).toBe("a")
    expect(out[0].trigger).toBe("decision:")
  })

  it("catches let's go with phrasing", () => {
    const out = extractDecisions([
      msg({ id: "a", content: "After thinking about it, let's go with chokidar." }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toBe("going with")
  })

  it("catches X over Y phrasing", () => {
    const out = extractDecisions([
      msg({ id: "a", content: "I'm going chokidar over native fs.watch — it handles Linux." }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].trigger).toMatch(/over/)
  })

  it("catches the call is phrasing", () => {
    const out = extractDecisions([
      msg({ id: "a", content: "The right call is to ship the watcher now and add SSE later." }),
    ])
    expect(out).toHaveLength(1)
  })

  it("excerpts around the trigger so context is visible", () => {
    const out = extractDecisions([
      msg({
        id: "a",
        content:
          "OK so after going through three options. Decision: ship chokidar even though it adds 50kb. The other two were too risky.",
      }),
    ])
    expect(out[0].excerpt).toMatch(/Decision/i)
    expect(out[0].excerpt).toMatch(/chokidar/)
  })

  it("ranks higher-weight triggers first", () => {
    const out = extractDecisions([
      msg({
        id: "low",
        content: "let's not go down that path",
        createdAt: "2026-04-22T11:00:00Z",
      }),
      msg({
        id: "high",
        content: "Decision: shipping the new layout immediately.",
        createdAt: "2026-04-22T10:00:00Z",
      }),
    ])
    expect(out[0].messageId).toBe("high")
  })

  it("caps per-thread", () => {
    const messages: DecisionMomentInput[] = []
    for (let i = 0; i < 8; i++) {
      messages.push(
        msg({
          id: `m${i}`,
          threadId: "hot",
          content: `Decision: ship feature ${i} this sprint.`,
          turnIndex: i,
        })
      )
    }
    const out = extractDecisions(messages)
    expect(out.length).toBeLessThanOrEqual(3)
  })
})
