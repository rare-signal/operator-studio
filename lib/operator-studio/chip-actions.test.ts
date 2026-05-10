/**
 * Parser tests for the exec chip system. Locks the syntax contract so
 * Worker 4 can implement handlers + UI render against a stable shape.
 *
 * Doesn't test handlers — those are Phase 2 stubs that throw.
 */

import { describe, expect, it } from "vitest"

import {
  isKnownChipActionId,
  parseChipsFromMessage,
  stripChipSentinels,
} from "./chip-actions"

describe("parseChipsFromMessage", () => {
  it("returns empty array on empty / non-string input", () => {
    expect(parseChipsFromMessage("")).toEqual([])
    // @ts-expect-error intentional bad input
    expect(parseChipsFromMessage(null)).toEqual([])
    // @ts-expect-error intentional bad input
    expect(parseChipsFromMessage(undefined)).toEqual([])
  })

  it("extracts a single well-formed chip", () => {
    const msg = `Phase 1 done. <<chip:{"action":"mark-step-covered","label":"Mark covered","params":{"planStepId":"step-x"}}>>`
    const chips = parseChipsFromMessage(msg)
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({
      action: "mark-step-covered",
      label: "Mark covered",
      params: { planStepId: "step-x" },
      index: 0,
    })
  })

  it("extracts multiple chips and indexes them in emission order", () => {
    const msg = [
      "Three options:",
      `<<chip:{"action":"approve-phase-2","label":"Go","params":{"planStepId":"step-a"}}>>`,
      `<<chip:{"action":"view-deliverable","label":"Read it","params":{"path":"foo.md"}}>>`,
      `<<chip:{"action":"mark-step-skipped","label":"Skip","params":{"planStepId":"step-a"}}>>`,
    ].join("\n")
    const chips = parseChipsFromMessage(msg)
    expect(chips).toHaveLength(3)
    expect(chips.map((c) => c.action)).toEqual([
      "approve-phase-2",
      "view-deliverable",
      "mark-step-skipped",
    ])
    expect(chips.map((c) => c.index)).toEqual([0, 1, 2])
  })

  it("falls back to default label when label is missing/blank", () => {
    const msg = `<<chip:{"action":"mark-worker-done","params":{"agentId":"claude:abc"}}>>`
    const chips = parseChipsFromMessage(msg)
    expect(chips).toHaveLength(1)
    expect(chips[0].label).toBe("Mark worker done")
  })

  it("drops malformed JSON silently", () => {
    const msg = `Hi <<chip:{not json}>> still here`
    expect(parseChipsFromMessage(msg)).toEqual([])
  })

  it("drops unknown action ids silently (registry is the allowlist)", () => {
    const msg = `<<chip:{"action":"definitely-not-a-real-action","label":"Hack","params":{}}>>`
    expect(parseChipsFromMessage(msg)).toEqual([])
  })

  it("drops chips with non-string action", () => {
    const msg = `<<chip:{"action":42,"label":"x"}>>`
    expect(parseChipsFromMessage(msg)).toEqual([])
  })

  it("treats missing/non-object params as empty params", () => {
    const a = `<<chip:{"action":"navigate-to-card","label":"Go"}>>`
    const b = `<<chip:{"action":"navigate-to-card","label":"Go","params":[]}>>`
    expect(parseChipsFromMessage(a)[0].params).toEqual({})
    expect(parseChipsFromMessage(b)[0].params).toEqual({})
  })

  it("survives nested braces inside params via lazy regex match", () => {
    // The lazy `\{[^]*?\}` matches the first balanced-looking chunk;
    // valid JSON with nested object should still parse because the
    // sentinel terminator is `>>`, not `}`.
    const msg = `<<chip:{"action":"spawn-worker","label":"Spawn","params":{"prompt":"do {x}","planStepId":"step-y"}}>>`
    const chips = parseChipsFromMessage(msg)
    expect(chips).toHaveLength(1)
    expect((chips[0].params as { prompt: string }).prompt).toBe("do {x}")
  })
})

describe("stripChipSentinels", () => {
  it("removes the sentinel from the rendered body", () => {
    const msg = `Hi.\n\n<<chip:{"action":"mark-step-covered","label":"Mark covered","params":{"planStepId":"x"}}>>\n\nMore text.`
    const stripped = stripChipSentinels(msg)
    expect(stripped).not.toContain("<<chip")
    expect(stripped).toContain("Hi.")
    expect(stripped).toContain("More text.")
  })

  it("collapses 3+ blank lines that the strip created back to a paragraph break", () => {
    const msg = `One.\n\n<<chip:{"action":"mark-step-covered","label":"x","params":{}}>>\n\nTwo.`
    expect(stripChipSentinels(msg)).toBe("One.\n\nTwo.")
  })

  it("is a no-op for empty / non-string", () => {
    expect(stripChipSentinels("")).toBe("")
    // @ts-expect-error intentional bad input
    expect(stripChipSentinels(null)).toBe(null)
  })
})

describe("isKnownChipActionId", () => {
  it("accepts every registered action id", () => {
    const ids = [
      "approve-phase-2",
      "view-deliverable",
      "mark-step-covered",
      "mark-step-skipped",
      "spawn-worker",
      "send-to-agent",
      "navigate-to-card",
      "mark-worker-done",
    ]
    for (const id of ids) expect(isKnownChipActionId(id)).toBe(true)
  })

  it("rejects unknown ids", () => {
    expect(isKnownChipActionId("rm-rf")).toBe(false)
    expect(isKnownChipActionId("")).toBe(false)
  })
})
