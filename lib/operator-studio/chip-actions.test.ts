/**
 * Parser tests for the exec chip system. Locks the syntax contract so
 * Worker 4 can wire the cockpit render against a stable shape.
 *
 * The chip system is deliberately small: a parser + a stripper. There
 * are no typed actions, no registry, no dispatcher — the agent on the
 * receiving end reads the natural-language label and acts.
 */

import { describe, expect, it } from "vitest"

import { parseChipsFromMessage, stripChipSentinels } from "./chip-actions"

describe("parseChipsFromMessage", () => {
  it("returns empty array on empty / non-string input", () => {
    expect(parseChipsFromMessage("")).toEqual([])
    // @ts-expect-error intentional bad input
    expect(parseChipsFromMessage(null)).toEqual([])
    // @ts-expect-error intentional bad input
    expect(parseChipsFromMessage(undefined)).toEqual([])
  })

  it("extracts a single chip", () => {
    const msg = `Phase 1 done. <<chip:Approve Phase 2 for Worker 1>>`
    expect(parseChipsFromMessage(msg)).toEqual([
      { label: "Approve Phase 2 for Worker 1", index: 0 },
    ])
  })

  it("extracts multiple chips and indexes them in emission order", () => {
    const msg = [
      "Three options:",
      `<<chip:Approve Phase 2 for plan-cleanup>>`,
      `<<chip:Read Worker 2's field report>>`,
      `<<chip:Hold and revisit tomorrow>>`,
    ].join("\n")
    const chips = parseChipsFromMessage(msg)
    expect(chips).toHaveLength(3)
    expect(chips.map((c) => c.label)).toEqual([
      "Approve Phase 2 for plan-cleanup",
      "Read Worker 2's field report",
      "Hold and revisit tomorrow",
    ])
    expect(chips.map((c) => c.index)).toEqual([0, 1, 2])
  })

  it("trims surrounding whitespace from labels", () => {
    const msg = `<<chip:   Approve Phase 2   >>`
    expect(parseChipsFromMessage(msg)[0].label).toBe("Approve Phase 2")
  })

  it("drops chips with empty / whitespace-only labels", () => {
    expect(parseChipsFromMessage(`<<chip:>>`)).toEqual([])
    expect(parseChipsFromMessage(`<<chip:   >>`)).toEqual([])
  })

  it("preserves punctuation, quotes, and identifiers in labels", () => {
    const msg = `<<chip:Mark "step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup" covered>>`
    expect(parseChipsFromMessage(msg)[0].label).toBe(
      `Mark "step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup" covered`
    )
  })

  it("handles chips inline with prose around them", () => {
    const msg = `Done with the review. <<chip:Approve>> or <<chip:Send back for revision>> — your call.`
    expect(parseChipsFromMessage(msg).map((c) => c.label)).toEqual([
      "Approve",
      "Send back for revision",
    ])
  })
})

describe("stripChipSentinels", () => {
  it("removes the sentinel from the rendered body", () => {
    const msg = `Hi.\n\n<<chip:Approve Phase 2>>\n\nMore text.`
    const stripped = stripChipSentinels(msg)
    expect(stripped).not.toContain("<<chip")
    expect(stripped).toContain("Hi.")
    expect(stripped).toContain("More text.")
  })

  it("collapses 3+ blank lines that the strip created back to a paragraph break", () => {
    const msg = `One.\n\n<<chip:x>>\n\nTwo.`
    expect(stripChipSentinels(msg)).toBe("One.\n\nTwo.")
  })

  it("strips multiple chips at once", () => {
    const msg = `<<chip:A>> and <<chip:B>> and <<chip:C>> done.`
    expect(stripChipSentinels(msg)).toBe("and  and  done.")
  })

  it("is a no-op for empty / non-string", () => {
    expect(stripChipSentinels("")).toBe("")
    // @ts-expect-error intentional bad input
    expect(stripChipSentinels(null)).toBe(null)
  })
})
