import { describe, expect, it } from "vitest"

import {
  getPowerStrings,
  getPowerStringsByTrigger,
  matchPowerString,
  matchesPowerString,
  type PowerStringSpec,
} from "./power-strings"

const exactUserSpec: PowerStringSpec = {
  id: "test-exact",
  label: "test exact",
  phrase: "All done in this chat, TY!",
  role: "user",
  match: "exact",
  trigger: "mark-thread-done",
}

const containsAssistantSpec: PowerStringSpec = {
  id: "test-contains",
  label: "test contains",
  phrase: "task_done",
  role: "assistant",
  match: "contains",
  trigger: "mark-thread-done",
}

describe("matchesPowerString — exact mode", () => {
  it("matches whole-message equality, case + whitespace insensitive", () => {
    expect(matchesPowerString(exactUserSpec, "user", "all done in this chat, ty!")).toBe(true)
    expect(matchesPowerString(exactUserSpec, "user", "  All Done   in this chat, TY!  ")).toBe(true)
  })

  it("rejects substring quotes inside larger messages", () => {
    expect(
      matchesPowerString(
        exactUserSpec,
        "user",
        "the phrase is: All done in this chat, TY!"
      )
    ).toBe(false)
  })

  it("rejects wrong role", () => {
    expect(matchesPowerString(exactUserSpec, "assistant", "All done in this chat, TY!")).toBe(false)
  })
})

describe("matchesPowerString — contains mode (word-bounded)", () => {
  it("matches the bare token in assistant output", () => {
    expect(matchesPowerString(containsAssistantSpec, "assistant", "task_done")).toBe(true)
  })

  it("matches the token embedded in surrounding prose", () => {
    expect(
      matchesPowerString(
        containsAssistantSpec,
        "assistant",
        "Wrapping up — task_done. Anything else?"
      )
    ).toBe(true)
    expect(
      matchesPowerString(
        containsAssistantSpec,
        "assistant",
        "All set:\ntask_done\n"
      )
    ).toBe(true)
  })

  it("does NOT match inside a longer identifier", () => {
    expect(
      matchesPowerString(
        containsAssistantSpec,
        "assistant",
        "register a task_done_handler"
      )
    ).toBe(false)
    expect(
      matchesPowerString(
        containsAssistantSpec,
        "assistant",
        "the marked_task_done_at column"
      )
    ).toBe(false)
    expect(
      matchesPowerString(
        containsAssistantSpec,
        "assistant",
        "xtask_donex"
      )
    ).toBe(false)
  })

  it("rejects when role is wrong (user-typed task_done shouldn't fire)", () => {
    expect(matchesPowerString(containsAssistantSpec, "user", "task_done")).toBe(false)
  })

  it("is case-insensitive", () => {
    expect(matchesPowerString(containsAssistantSpec, "assistant", "TASK_DONE")).toBe(true)
  })
})

describe("matchPowerString — registry walk", () => {
  it("finds the operator-typed phrase on user turns", () => {
    const m = matchPowerString("user", "All done in this chat, TY!")
    expect(m?.id).toBe("done-phrase")
  })

  it("finds the task_done sentinel on assistant turns", () => {
    const m = matchPowerString("assistant", "Final: task_done")
    expect(m?.id).toBe("task-done-token")
  })

  it("returns null when nothing matches", () => {
    expect(matchPowerString("assistant", "Some unrelated reply.")).toBeNull()
    expect(matchPowerString("user", "Some unrelated reply.")).toBeNull()
  })
})

describe("registry shape", () => {
  it("ships at least the two seeded mark-thread-done specs", () => {
    const specs = getPowerStringsByTrigger("mark-thread-done")
    const ids = specs.map((s) => s.id)
    expect(ids).toContain("done-phrase")
    expect(ids).toContain("task-done-token")
  })

  it("getPowerStrings returns specs with all required fields", () => {
    for (const s of getPowerStrings()) {
      expect(s.id).toBeTruthy()
      expect(s.label).toBeTruthy()
      expect(s.phrase).toBeTruthy()
      expect(["user", "assistant", "any"]).toContain(s.role)
      expect(["exact", "contains"]).toContain(s.match)
      expect(s.trigger).toBe("mark-thread-done")
    }
  })
})
