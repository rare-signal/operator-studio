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

  it("extracts a single chip on its own line", () => {
    const msg = `Phase 1 done.\n<<chip:Approve Phase 2 for Worker 1>>`
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

  it("does NOT match chips inline in prose (must be on their own line)", () => {
    // This is the regression case from the 2026-05-09 cockpit smoke
    // test: documentation like "Sentinel syntax: `<<chip:LABEL>>`" was
    // being parsed as a real chip. Chips must be on their own line.
    const inline = `Done with the review. <<chip:Approve>> or <<chip:Send back for revision>> — your call.`
    expect(parseChipsFromMessage(inline)).toEqual([])
    const docProse = "The sentinel syntax is `<<chip:LABEL>>` — read the brief."
    expect(parseChipsFromMessage(docProse)).toEqual([])
    const codeFence = "```\n<<chip:Example>>\n```"
    // Code-fenced chips DO still match; the regex is line-anchored,
    // not fence-aware. Authors should not put real chip syntax in code
    // examples; if this becomes a problem we'd need a markdown-aware
    // pre-pass. Documenting the current behavior:
    expect(parseChipsFromMessage(codeFence).map((c) => c.label)).toEqual([
      "Example",
    ])
  })

  it("matches chips on their own line, with optional surrounding whitespace", () => {
    const msg = ["Three options:", "  <<chip:A>>  ", "<<chip:B>>", "\t<<chip:C>>\t"].join("\n")
    expect(parseChipsFromMessage(msg).map((c) => c.label)).toEqual(["A", "B", "C"])
  })

  // v2 (2026-05-09): optional `|description` after the label. Inline
  // pills still render label-only; the sparkle (✨) modal surfaces the
  // description as "why pick this now" orientation text.
  it("parses an optional description after the first pipe", () => {
    const msg = `<<chip:Approve|Worker 1's report is committed>>`
    expect(parseChipsFromMessage(msg)).toEqual([
      {
        label: "Approve",
        description: "Worker 1's report is committed",
        index: 0,
      },
    ])
  })

  it("leaves description undefined when no pipe is present (back-compat)", () => {
    const chip = parseChipsFromMessage(`<<chip:Approve>>`)[0]
    expect(chip).toEqual({ label: "Approve", index: 0 })
    expect(chip.description).toBeUndefined()
  })

  it("only splits on the FIRST pipe — subsequent pipes live in the description", () => {
    const msg = `<<chip:A|B|C>>`
    expect(parseChipsFromMessage(msg)).toEqual([
      { label: "A", description: "B|C", index: 0 },
    ])
  })

  it("normalizes an empty description to undefined", () => {
    // `<<chip:A|>>` and `<<chip:A|   >>` both mean "no description";
    // the sparkle modal never opens over a blank card.
    const a = parseChipsFromMessage(`<<chip:A|>>`)[0]
    expect(a).toEqual({ label: "A", index: 0 })
    expect(a.description).toBeUndefined()
    const b = parseChipsFromMessage(`<<chip:A|   >>`)[0]
    expect(b.description).toBeUndefined()
  })

  it("trims whitespace around the description", () => {
    const msg = `<<chip:Approve|  ship it now  >>`
    expect(parseChipsFromMessage(msg)[0].description).toBe("ship it now")
  })

  it("drops chips with empty label even when a description is provided", () => {
    expect(parseChipsFromMessage(`<<chip:|just context>>`)).toEqual([])
  })

  // 2026-05-10 forgiving form: workers occasionally emit
  // `<<chip:LABEL>>|description` (description outside the sentinel)
  // instead of the canonical `<<chip:LABEL|description>>`. The parser
  // accepts both so a small syntax slip doesn't strand the chip as
  // raw text in the rendered message.
  it("parses outside-sentinel description form `<<chip:LABEL>>|DESC`", () => {
    const msg = `<<chip:Mark worker done>>|Berthier should run os:worker-done after eyeballing the diff`
    expect(parseChipsFromMessage(msg)).toEqual([
      {
        label: "Mark worker done",
        description:
          "Berthier should run os:worker-done after eyeballing the diff",
        index: 0,
      },
    ])
  })

  it("when both inside and outside descriptions are present, inside wins (canonical)", () => {
    const msg = `<<chip:Approve|inside form wins>>|outside form ignored`
    expect(parseChipsFromMessage(msg)[0].description).toBe("inside form wins")
  })

  it("parses multiple chips mixing both inside and outside description forms", () => {
    const msg = [
      "<<chip:Inside form|inside desc here>>",
      "<<chip:Outside form>>|outside desc here",
      "<<chip:No desc>>",
    ].join("\n")
    const chips = parseChipsFromMessage(msg)
    expect(chips).toHaveLength(3)
    expect(chips[0]).toMatchObject({
      label: "Inside form",
      description: "inside desc here",
    })
    expect(chips[1]).toMatchObject({
      label: "Outside form",
      description: "outside desc here",
    })
    expect(chips[2]).toMatchObject({ label: "No desc" })
    expect(chips[2].description).toBeUndefined()
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

  it("strips multiple chips on their own lines", () => {
    const msg = `Done.\n<<chip:A>>\n<<chip:B>>\n<<chip:C>>`
    expect(stripChipSentinels(msg)).toBe("Done.")
  })

  it("does NOT strip inline-prose chips (parser doesn't match them either)", () => {
    const msg = "The sentinel `<<chip:LABEL>>` is documented here."
    // strip is line-anchored same as parser, so inline references survive.
    // This keeps documentation about chip syntax readable in chat.
    expect(stripChipSentinels(msg)).toBe(
      "The sentinel `<<chip:LABEL>>` is documented here."
    )
  })

  it("is a no-op for empty / non-string", () => {
    expect(stripChipSentinels("")).toBe("")
    // @ts-expect-error intentional bad input
    expect(stripChipSentinels(null)).toBe(null)
  })
})
