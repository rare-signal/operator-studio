import { describe, it, expect } from "vitest"

import {
  extractGoldCandidates,
  type GoldCandidateInput,
} from "./gold-extractor"

/**
 * Gold extraction needs lockdown tests because we'll tune the heuristic
 * weights over time. A regression here = the wrong stuff gets surfaced
 * on the session detail page and the user stops trusting the feature.
 */

function msg(overrides: Partial<GoldCandidateInput>): GoldCandidateInput {
  return {
    id: overrides.id ?? "m1",
    threadId: overrides.threadId ?? "t1",
    threadTitle: overrides.threadTitle ?? "Thread",
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "",
    turnIndex: overrides.turnIndex ?? 5,
    createdAt: overrides.createdAt ?? "2026-04-22T10:00:00Z",
    threadTurnCount: overrides.threadTurnCount ?? 20,
  }
}

describe("extractGoldCandidates", () => {
  it("returns empty for empty input", () => {
    expect(extractGoldCandidates([])).toEqual([])
  })

  it("ignores short connective messages", () => {
    const out = extractGoldCandidates([
      msg({ content: "ok" }),
      msg({ content: "let me think" }),
      msg({ content: "will do" }),
    ])
    expect(out).toEqual([])
  })

  it("surfaces messages with TLDR markers", () => {
    const out = extractGoldCandidates([
      msg({
        id: "a",
        content: "Some analysis here.\n\nTLDR: the real insight is X.",
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].messageId).toBe("a")
    expect(out[0].signals.some((s) => s.kind === "tldr")).toBe(true)
    expect(out[0].topReason.kind).toBe("tldr")
  })

  it("surfaces messages with insight-callout phrases", () => {
    const out = extractGoldCandidates([
      msg({
        id: "a",
        content:
          "The insight is that we should do this. Key decision: use chokidar.",
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].signals.some((s) => s.kind === "insight-callout")).toBe(
      true
    )
  })

  it("surfaces long substantive assistant messages", () => {
    const long = "This is a substantive analysis. ".repeat(100) // ~3200 chars
    const out = extractGoldCandidates([msg({ id: "a", content: long })])
    expect(out).toHaveLength(1)
    expect(
      out[0].signals.some((s) => s.kind === "substantive-analysis")
    ).toBe(true)
  })

  it("surfaces messages with multiple emphasis markers", () => {
    const out = extractGoldCandidates([
      msg({
        id: "a",
        content:
          "We should use **chokidar** for this, because **native fs.watch** doesn't support recursive on Linux. The **right call** is to ship chokidar.",
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].signals.some((s) => s.kind === "emphatic-claim")).toBe(true)
  })

  it("surfaces code + explanation blocks", () => {
    const content = `Here's the fix:

\`\`\`typescript
function foo() { return bar }
\`\`\`

This works because the import cycle is broken by the dynamic import.
${"Explanation continues. ".repeat(15)}`
    const out = extractGoldCandidates([msg({ id: "a", content })])
    expect(out).toHaveLength(1)
    expect(out[0].signals.some((s) => s.kind === "code-and-explain")).toBe(
      true
    )
  })

  it("surfaces first-user-message framing", () => {
    const out = extractGoldCandidates([
      msg({
        id: "a",
        role: "user",
        turnIndex: 0,
        content:
          "I want to build a thing that does X. The goal is Y because Z. Can we start by outlining the approach?",
      }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].signals.some((s) => s.kind === "opening-framing")).toBe(
      true
    )
  })

  it("does not flag short first-user-message as framing", () => {
    const out = extractGoldCandidates([
      msg({
        id: "a",
        role: "user",
        turnIndex: 0,
        content: "hi",
      }),
    ])
    expect(out).toEqual([])
  })

  it("caps candidates per thread via maxPerThread", () => {
    // Ten substantive messages in one thread — without cap we'd get 10;
    // with default cap (3) we get 3.
    const messages: GoldCandidateInput[] = Array.from(
      { length: 10 },
      (_, i) =>
        msg({
          id: `m${i}`,
          threadId: "t-hot",
          content:
            "TLDR: this is a real insight about strategy and architecture. " +
            "The key decision is to ship chokidar. ".repeat(5),
          turnIndex: i,
        })
    )
    const out = extractGoldCandidates(messages)
    expect(out.length).toBeLessThanOrEqual(3)
  })

  it("respects topN cap across threads", () => {
    // 5 threads, 2 gold candidates each → 10 total, but topN=4 caps at 4.
    // Each candidate gets distinct content so the prefix-dedup pass
    // doesn't collapse them.
    const messages: GoldCandidateInput[] = []
    for (let t = 0; t < 5; t++) {
      for (let i = 0; i < 2; i++) {
        messages.push(
          msg({
            id: `t${t}-m${i}`,
            threadId: `t${t}`,
            content: `TLDR: real insight from thread ${t} message ${i}: the bottom line is unique${t}_${i}.`,
            turnIndex: i,
          })
        )
      }
    }
    const out = extractGoldCandidates(messages, { topN: 4 })
    expect(out.length).toBe(4)
  })

  it("dedupes candidates that produce the same excerpt prefix", () => {
    // Three different messages but their gold-extracted excerpts
    // happen to share the same opening (e.g. all start with the same
    // boilerplate header). Only the first should survive — preventing
    // the "same card 3 times" bug.
    const sameHeader = "# Status report\n\n## Progress\n\nTLDR: shipped"
    const out = extractGoldCandidates([
      msg({ id: "a", threadId: "t1", content: sameHeader }),
      msg({ id: "b", threadId: "t2", content: sameHeader }),
      msg({ id: "c", threadId: "t3", content: sameHeader }),
    ])
    expect(out.length).toBe(1)
  })

  it("builds an excerpt with a trailing ellipsis for long content", () => {
    const long = "This is a sentence. ".repeat(30) + "The real insight is Y."
    const out = extractGoldCandidates(
      [msg({ id: "a", content: long })],
      { excerptLength: 100 }
    )
    expect(out).toHaveLength(1)
    expect(out[0].excerpt.endsWith("…")).toBe(true)
    expect(out[0].excerpt.length).toBeLessThanOrEqual(102)
  })

  it("sorts by score descending, then by recency", () => {
    const out = extractGoldCandidates([
      msg({
        id: "low",
        content: "TLDR: small insight.",
        createdAt: "2026-04-22T09:00:00Z",
      }),
      msg({
        id: "high",
        content:
          "TLDR: ## Key decision\n\n**critical** takeaway — " +
          "here's a full synthesis. ".repeat(50),
        createdAt: "2026-04-22T08:00:00Z",
      }),
    ])
    expect(out[0].messageId).toBe("high")
    expect(out[0].score).toBeGreaterThan(out[1].score)
  })

  it("breaks ties on recency (newest first)", () => {
    const a = msg({
      id: "older",
      content: "TLDR: insight.",
      createdAt: "2026-04-22T08:00:00Z",
    })
    const b = msg({
      id: "newer",
      content: "TLDR: insight.",
      createdAt: "2026-04-22T09:00:00Z",
    })
    const out = extractGoldCandidates([a, b])
    expect(out[0].messageId).toBe("newer")
  })

  it("respects minScore threshold", () => {
    // Just an emphasis marker — boost=1, below default minScore=3.
    const out = extractGoldCandidates([
      msg({ id: "a", content: "This is a **thing** that happens." }),
    ])
    expect(out).toEqual([])
  })

  it("includes a topReason with a human label", () => {
    const out = extractGoldCandidates([
      msg({ id: "a", content: "TLDR: the real insight is X." }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].topReason.label).toBeTruthy()
    expect(typeof out[0].topReason.label).toBe("string")
  })
})
