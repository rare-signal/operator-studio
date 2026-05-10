import { describe, expect, it } from "vitest"

import {
  groupTurnParts,
  isToolPart,
  type TurnPart,
} from "./cockpit-tool-groups"

const text = (t: string): TurnPart => ({ kind: "text", text: t })
const thinking = (t: string): TurnPart => ({ kind: "thinking", text: t })
const toolUse = (name: string, summary = ""): TurnPart => ({
  kind: "tool_use",
  name,
  summary,
})
const toolResult = (summary: string): TurnPart => ({
  kind: "tool_result",
  summary,
})
const image = (note: string): TurnPart => ({ kind: "image", note })

describe("isToolPart", () => {
  it("classifies tool/image parts as tool, text/thinking as not", () => {
    expect(isToolPart(toolUse("Read"))).toBe(true)
    expect(isToolPart(toolResult("ok"))).toBe(true)
    expect(isToolPart(image("img"))).toBe(true)
    expect(isToolPart(text("hi"))).toBe(false)
    expect(isToolPart(thinking("hmm"))).toBe(false)
  })
})

describe("groupTurnParts", () => {
  it("returns empty array for empty input", () => {
    expect(groupTurnParts([])).toEqual([])
  })

  it("renders a lone text part as a single group", () => {
    const parts = [text("hello")]
    const groups = groupTurnParts(parts)
    expect(groups).toEqual([{ kind: "single", index: 0, part: parts[0] }])
  })

  it("bundles consecutive tool parts into one tool-group", () => {
    const parts = [
      toolUse("Read", "foo.ts"),
      toolResult("ok"),
      toolUse("Bash", "ls"),
    ]
    const groups = groupTurnParts(parts)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe("tool-group")
    if (groups[0].kind !== "tool-group") throw new Error("unreachable")
    expect(groups[0].startIndex).toBe(0)
    expect(groups[0].parts.map((p) => p.index)).toEqual([0, 1, 2])
  })

  it("splits tool runs around text/thinking parts", () => {
    const parts = [
      text("starting"),
      toolUse("Read", "foo"),
      toolResult("ok"),
      text("midway"),
      thinking("hmm"),
      toolUse("Bash", "ls"),
      text("done"),
    ]
    const groups = groupTurnParts(parts)
    expect(groups.map((g) => g.kind)).toEqual([
      "single",
      "tool-group",
      "single",
      "single",
      "tool-group",
      "single",
    ])
    const firstTool = groups[1]
    if (firstTool.kind !== "tool-group") throw new Error("unreachable")
    expect(firstTool.parts.map((p) => p.index)).toEqual([1, 2])
    const secondTool = groups[4]
    if (secondTool.kind !== "tool-group") throw new Error("unreachable")
    expect(secondTool.parts.map((p) => p.index)).toEqual([5])
  })

  it("preserves original part indices across the whole turn", () => {
    const parts = [text("a"), toolUse("Read"), toolResult("ok"), text("b")]
    const groups = groupTurnParts(parts)
    const flatIndices = groups.flatMap((g) =>
      g.kind === "single" ? [g.index] : g.parts.map((p) => p.index)
    )
    expect(flatIndices).toEqual([0, 1, 2, 3])
  })

  it("treats image parts as tool parts (group with adjacent tool runs)", () => {
    const parts = [toolUse("Read"), image("screenshot"), toolResult("ok")]
    const groups = groupTurnParts(parts)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe("tool-group")
  })
})
