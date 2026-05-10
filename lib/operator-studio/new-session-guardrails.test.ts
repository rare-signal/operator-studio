import { describe, expect, it } from "vitest"

import {
  deriveDefaultLauncher,
  resolveRequestedLauncher,
} from "./new-session-guardrails"
import type { BackendCapability, BackendInventory, WorkerLauncherKind } from "./planner-backends"

function cap(kind: WorkerLauncherKind, available: boolean, overrides: Partial<BackendCapability> = {}): BackendCapability {
  return {
    kind,
    available,
    label: kind,
    detail: overrides.detail ?? `${kind} probe detail`,
    backendKinds: [],
    nextAction: overrides.nextAction ?? null,
    ...overrides,
  }
}

function inventory(launchers: BackendCapability[]): BackendInventory {
  return { plannerBrains: [], workerLaunchers: launchers }
}

const FULL = inventory([
  cap("claude-desktop", true),
  cap("claude-cli", true),
  cap("codex-app", true),
  cap("codex-cli", false),
  cap("tmux", true),
  cap("lm-studio", false, { nextAction: "Start LM Studio." }),
  cap("ollama", false),
])

describe("deriveDefaultLauncher", () => {
  it("maps claude → claude-desktop", () => {
    expect(deriveDefaultLauncher("claude")).toBe("claude-desktop")
  })
  it("maps codex → codex-app", () => {
    expect(deriveDefaultLauncher("codex")).toBe("codex-app")
  })
})

describe("resolveRequestedLauncher", () => {
  it("derives claude-desktop when requestedLauncher is omitted for appKind=claude", () => {
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: null,
      inventory: FULL,
    })
    expect(decision).toEqual({ ok: true, launcher: "claude-desktop" })
  })

  it("accepts an explicit codex-app for appKind=codex", () => {
    const decision = resolveRequestedLauncher({
      appKind: "codex",
      requestedLauncher: "codex-app",
      inventory: FULL,
    })
    expect(decision).toEqual({ ok: true, launcher: "codex-app" })
  })

  it("rejects unknown launcher kinds with a concrete reason", () => {
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: "nope",
      inventory: FULL,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.kind).toBe("unknown-launcher")
  })

  it("refuses to substitute Codex launcher when appKind is claude", () => {
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: "codex-app",
      inventory: FULL,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.kind).toBe("brain-mismatch")
      expect(decision.reason).toMatch(/silently substitute/i)
    }
  })

  it("refuses to substitute an LM Studio launcher when appKind is claude", () => {
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: "lm-studio",
      inventory: FULL,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.kind).toBe("brain-mismatch")
  })

  it("rejects launchers this route cannot drive (claude-cli) even when planner brain matches", () => {
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: "claude-cli",
      inventory: FULL,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.kind).toBe("route-unsupported")
  })

  it("rejects when the requested launcher is unavailable in the inventory", () => {
    const inv = inventory([
      cap("claude-desktop", false, { nextAction: "Start Operator Studio." }),
      cap("codex-app", true),
    ])
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: "claude-desktop",
      inventory: inv,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) {
      expect(decision.kind).toBe("launcher-unavailable")
      expect(decision.reason).toMatch(/Start Operator Studio/)
    }
  })

  it("rejects when the launcher is missing from the inventory entirely", () => {
    const inv = inventory([cap("codex-app", true)])
    const decision = resolveRequestedLauncher({
      appKind: "claude",
      requestedLauncher: "claude-desktop",
      inventory: inv,
    })
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.kind).toBe("launcher-unavailable")
  })
})
