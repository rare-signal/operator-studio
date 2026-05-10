import { describe, expect, it } from "vitest"

import { inferFallowNextPrompt } from "./fallow-next-prompt"
import type { OperatorPlanStep } from "./types"

const card: OperatorPlanStep = {
  id: "step-foo",
  title: "Wire fallow next-prompt engine",
  description: "Build the inference engine that grounds suggestions in card + tail + intent.",
  order: 1,
  status: "in-motion",
  parentStepId: null,
  positionX: null,
  positionY: null,
  coverImageUrl: null,
}

describe("inferFallowNextPrompt", () => {
  it("returns null for tmux panes (no semantic tail)", () => {
    expect(
      inferFallowNextPrompt({
        workerKind: "tmux",
        card,
        lastAssistantText: "anything",
      })
    ).toBeNull()
  })

  it("classifies a blocker tail and instructs a blocker note instead of retry", () => {
    const out = inferFallowNextPrompt({
      workerKind: "claude",
      card,
      lastAssistantText: "I cannot proceed — permission denied on the file.",
    })
    expect(out).not.toBeNull()
    expect(out!.signal).toBe("blocker")
    expect(out!.prompt).toContain("blocker note")
    expect(out!.prompt).not.toContain("Resume from where you stopped")
  })

  it("classifies a verify_result tail and gates on acceptance", () => {
    const out = inferFallowNextPrompt({
      workerKind: "claude",
      card,
      lastAssistantText: "pnpm typecheck passes; tests are green.",
    })
    expect(out!.signal).toBe("verify_result")
    expect(out!.prompt).toContain("pnpm plan:card status --id=step-foo --status=covered")
  })

  it("classifies a completion claim and asks for acceptance verification", () => {
    const out = inferFallowNextPrompt({
      workerKind: "claude",
      card,
      lastAssistantText: "I've implemented the feature. Ready for review.",
    })
    expect(out!.signal).toBe("completion_claim")
    expect(out!.prompt).toContain("acceptance criteria")
  })

  it("classifies needs_instruction and points back to the card body", () => {
    const out = inferFallowNextPrompt({
      workerKind: "codex",
      card,
      lastAssistantText: "Standing by — what would you like me to do next?",
    })
    expect(out!.signal).toBe("needs_instruction")
    expect(out!.prompt).toContain("Re-read the card body")
  })

  it("falls through to stale_assistant for an unclassified tail and includes intent + card", () => {
    const out = inferFallowNextPrompt({
      workerKind: "claude",
      card,
      lastAssistantText: "Reviewing the bridge layer to see how it composes.",
      lastToolName: "Read",
      workspaceIntent: {
        planTitle: "Valikharlia Engine — Agentic Studio Buildout",
        planGoal: "Per-pane semantic resume.",
        hotStepTitles: ["Operations reset", "Tactical operations screen"],
      },
    })
    expect(out!.signal).toBe("stale_assistant")
    expect(out!.prompt).toContain("Wire fallow next-prompt engine")
    expect(out!.prompt).toContain("Active plan: Valikharlia Engine")
    expect(out!.prompt).toContain("Last tool you used: Read")
    expect(out!.basis.usedWorkspaceIntent).toBe(true)
  })

  it("returns null when there's no card and no tail", () => {
    expect(
      inferFallowNextPrompt({
        workerKind: "claude",
        card: null,
        lastAssistantText: "",
      })
    ).toBeNull()
  })
})
