import { describe, it, expect } from "vitest"

import { extractThemes } from "./theme-extractor"

describe("extractThemes", () => {
  it("returns empty for no messages", () => {
    expect(extractThemes({ messages: [] })).toEqual([])
  })

  it("filters out stopwords", () => {
    const out = extractThemes({
      messages: [
        { id: "a", content: "the and to of" },
        { id: "b", content: "the and to of" },
      ],
    })
    expect(out).toEqual([])
  })

  it("counts distinct messages, not raw tokens", () => {
    // "chokidar" appears 50 times in one message (messageHits=1),
    // "plan" appears once in each of 3 messages (messageHits=3).
    // With default minMessageHits=2, chokidar is correctly excluded
    // despite its high raw frequency — that's the whole point: a
    // single long dump shouldn't monopolize themes.
    const out = extractThemes({
      messages: [
        { id: "a", content: "chokidar ".repeat(50) },
        { id: "b", content: "plan the session" },
        { id: "c", content: "plan the rollout" },
        { id: "d", content: "plan the phases" },
      ],
    })
    const plan = out.find((t) => t.term.startsWith("plan"))
    expect(plan).toBeDefined()
    expect(plan!.messageHits).toBe(3)
    // chokidar has only 1 distinct-message hit, filtered out.
    expect(out.some((t) => t.term.startsWith("chokidar"))).toBe(false)
  })

  it("collapses common inflections via cheap stemming", () => {
    const out = extractThemes({
      messages: [
        { id: "a", content: "planning the session" },
        { id: "b", content: "plan the rollout" },
        { id: "c", content: "plans approved" },
      ],
    })
    // planning / plan / plans → same stem, merged into one term.
    const planTerms = out.filter((t) =>
      ["plan", "plans", "planning"].includes(t.term)
    )
    expect(planTerms).toHaveLength(1)
    expect(planTerms[0].messageHits).toBe(3)
  })

  it("strips code fences so keywords inside code don't dominate", () => {
    const out = extractThemes({
      messages: [
        {
          id: "a",
          content: "```\nconsole.log('workspace workspace workspace')\n```",
        },
        {
          id: "b",
          content: "```\nconsole.log('workspace workspace workspace')\n```",
        },
      ],
    })
    // No code content leaked through; nothing recurs outside code.
    expect(out).toEqual([])
  })

  it("strips URLs", () => {
    const out = extractThemes({
      messages: [
        { id: "a", content: "check https://github.com/rare-signal/operator-studio" },
        { id: "b", content: "see https://github.com/rare-signal/operator-studio" },
      ],
    })
    // Nothing meaningful left after stopwords + URL strip + minHits.
    // At worst, we get the "check"/"see" stopwords which are filtered.
    expect(
      out.some((t) => t.term.includes("github") || t.term.includes("http"))
    ).toBe(false)
  })

  it("respects topN cap", () => {
    const messages = []
    for (let i = 0; i < 50; i++) {
      messages.push({
        id: `m${i}`,
        content: `alpha${i % 10} beta${i % 10} gamma${i % 10} delta${i % 10}`,
      })
    }
    const out = extractThemes({ messages, topN: 5 })
    expect(out.length).toBeLessThanOrEqual(5)
  })

  it("ranks by message-hits weight", () => {
    const out = extractThemes({
      messages: [
        { id: "a", content: "apollo beacon" },
        { id: "b", content: "apollo beacon" },
        { id: "c", content: "apollo" },
        { id: "d", content: "apollo" },
      ],
    })
    // apollo appears in 4 messages, beacon in 2 — apollo should rank
    // higher.
    const apolloIdx = out.findIndex((t) => t.term === "apollo")
    const beaconIdx = out.findIndex((t) => t.term === "beacon")
    expect(apolloIdx).toBeGreaterThanOrEqual(0)
    expect(beaconIdx).toBeGreaterThanOrEqual(0)
    expect(apolloIdx).toBeLessThan(beaconIdx)
  })
})
