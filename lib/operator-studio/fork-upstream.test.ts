import { describe, it, expect } from "vitest"

import { planUpstreamFork } from "./fork-upstream"
import type { OperatorSourceApp } from "./types"

/**
 * These tests exist because `fork-with-upstream` used to silently fall
 * back to a plain fork on any failure — which made the UI lie to users
 * ("forked with updates!" when we actually used the stored copy). The
 * decision logic is now a pure function so we can lock it down.
 */

function makeParent(overrides: {
  sourceApp: OperatorSourceApp
  sourceLocator: string | null
}) {
  return {
    sourceApp: overrides.sourceApp,
    sourceLocator: overrides.sourceLocator,
  }
}

describe("planUpstreamFork", () => {
  it("returns attempt-reparse for claude with a locator", () => {
    const plan = planUpstreamFork(
      makeParent({ sourceApp: "claude", sourceLocator: "/path/to/session.jsonl" })
    )
    expect(plan.status).toBe("attempt-reparse")
    if (plan.status === "attempt-reparse") {
      expect(plan.filePath).toBe("/path/to/session.jsonl")
      expect(plan.sourceApp).toBe("claude")
    }
  })

  it("returns attempt-reparse for claude-code with a locator", () => {
    const plan = planUpstreamFork(
      makeParent({
        sourceApp: "claude-code",
        sourceLocator: "/x/y.jsonl",
      })
    )
    expect(plan.status).toBe("attempt-reparse")
  })

  it("returns attempt-reparse for codex with a locator", () => {
    const plan = planUpstreamFork(
      makeParent({ sourceApp: "codex", sourceLocator: "/path/codex.jsonl" })
    )
    expect(plan.status).toBe("attempt-reparse")
  })

  it("returns no-locator when sourceLocator is null", () => {
    const plan = planUpstreamFork(
      makeParent({ sourceApp: "claude", sourceLocator: null })
    )
    expect(plan.status).toBe("no-locator")
    if (plan.status === "no-locator") {
      expect(plan.reason).toMatch(/sourceLocator/i)
    }
  })

  it("returns unsupported-source for paste-only sources even with a locator", () => {
    // Paste-mode threads sometimes have a `sourceLocator` set to the
    // display filename; that doesn't mean we can re-parse the file.
    // Guard against pretending we can.
    const plan = planUpstreamFork(
      makeParent({
        sourceApp: "gemini",
        sourceLocator: "uploaded.txt",
      })
    )
    expect(plan.status).toBe("unsupported-source")
    if (plan.status === "unsupported-source") {
      expect(plan.sourceApp).toBe("gemini")
      expect(plan.reason).toMatch(/gemini/)
    }
  })

  it("returns unsupported-source for chatgpt with a locator", () => {
    const plan = planUpstreamFork(
      makeParent({
        sourceApp: "chatgpt",
        sourceLocator: "/x/y.json",
      })
    )
    expect(plan.status).toBe("unsupported-source")
  })

  it("respects a custom supportedSources override (for tests)", () => {
    const plan = planUpstreamFork(
      makeParent({
        sourceApp: "gemini",
        sourceLocator: "/x/y.json",
      }),
      { supportedSources: new Set(["gemini"]) }
    )
    expect(plan.status).toBe("attempt-reparse")
  })

  it("is pure: calling twice with same input returns equivalent shape", () => {
    const input = makeParent({
      sourceApp: "claude",
      sourceLocator: "/foo.jsonl",
    })
    const a = planUpstreamFork(input)
    const b = planUpstreamFork(input)
    expect(a).toEqual(b)
  })
})
