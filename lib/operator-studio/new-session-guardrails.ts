/**
 * Guardrails for /api/operator-studio/agents/new-session.
 *
 * The new-session route can drive a brand-new desktop thread via Cmd+N
 * for two surfaces today: Claude Desktop and Codex Desktop. Anything
 * else (Claude CLI/tmux, Codex CLI/tmux, LM Studio, Ollama, Hermes) is
 * a different launch lane and must NOT be silently substituted into
 * this route — Berthier's planner-vs-launcher inventory exists so that
 * a request for `claude-desktop` never quietly becomes a Codex subagent.
 *
 * This module is the pure decision shim that the route uses to
 * (1) pick a worker launcher (explicit or derived conservatively from
 * appKind), (2) verify the requested launcher matches the appKind's
 * planner brain, (3) verify the launcher is supported by this route,
 * and (4) verify the inventory reports it as available right now.
 *
 * It is deliberately pure (inventory passed in) so it is unit-testable
 * without spawning probes.
 */

import type { BackendInventory, WorkerLauncherKind } from "./planner-backends"

export type AppKind = "claude" | "codex"

export type GuardrailFailureKind =
  | "unknown-launcher"
  | "brain-mismatch"
  | "route-unsupported"
  | "launcher-unavailable"

export type GuardrailDecision =
  | { ok: true; launcher: WorkerLauncherKind }
  | {
      ok: false
      kind: GuardrailFailureKind
      requestedLauncher: WorkerLauncherKind | string
      reason: string
    }

const LAUNCHER_BRAIN: Record<
  WorkerLauncherKind,
  "claude" | "codex" | "lm-studio" | "ollama" | "any"
> = {
  "claude-desktop": "claude",
  "claude-cli": "claude",
  "codex-app": "codex",
  "codex-cli": "codex",
  tmux: "any",
  "lm-studio": "lm-studio",
  ollama: "ollama",
}

const ROUTE_SUPPORTED: ReadonlySet<WorkerLauncherKind> = new Set([
  "claude-desktop",
  "codex-app",
])

export function deriveDefaultLauncher(appKind: AppKind): WorkerLauncherKind {
  return appKind === "claude" ? "claude-desktop" : "codex-app"
}

export function isWorkerLauncherKind(value: unknown): value is WorkerLauncherKind {
  return (
    typeof value === "string" && Object.prototype.hasOwnProperty.call(LAUNCHER_BRAIN, value)
  )
}

export function resolveRequestedLauncher(args: {
  appKind: AppKind
  requestedLauncher: WorkerLauncherKind | string | null | undefined
  inventory: BackendInventory
}): GuardrailDecision {
  const { appKind, requestedLauncher, inventory } = args

  let launcher: WorkerLauncherKind
  if (requestedLauncher == null || requestedLauncher === "") {
    launcher = deriveDefaultLauncher(appKind)
  } else if (isWorkerLauncherKind(requestedLauncher)) {
    launcher = requestedLauncher
  } else {
    return {
      ok: false,
      kind: "unknown-launcher",
      requestedLauncher: String(requestedLauncher),
      reason: `Unknown worker launcher kind "${String(requestedLauncher)}". Recognized launchers: ${Object.keys(LAUNCHER_BRAIN).join(", ")}.`,
    }
  }

  const brain = LAUNCHER_BRAIN[launcher]
  if (brain !== "any" && brain !== appKind) {
    return {
      ok: false,
      kind: "brain-mismatch",
      requestedLauncher: launcher,
      reason: `Worker launcher "${launcher}" is a ${brain} backend; appKind="${appKind}" requires a ${appKind} launcher. Refusing to silently substitute a different planner brain.`,
    }
  }

  if (!ROUTE_SUPPORTED.has(launcher)) {
    return {
      ok: false,
      kind: "route-unsupported",
      requestedLauncher: launcher,
      reason: `Worker launcher "${launcher}" cannot be driven by /agents/new-session today. This route drives Cmd+N on the desktop apps only (${[...ROUTE_SUPPORTED].join(", ")}). Use a different launch surface or pick a supported launcher.`,
    }
  }

  const capability = inventory.workerLaunchers.find((entry) => entry.kind === launcher)
  if (!capability) {
    return {
      ok: false,
      kind: "launcher-unavailable",
      requestedLauncher: launcher,
      reason: `Worker launcher "${launcher}" is not in the backend inventory.`,
    }
  }
  if (!capability.available) {
    const next = capability.nextAction ? ` Next: ${capability.nextAction}` : ""
    return {
      ok: false,
      kind: "launcher-unavailable",
      requestedLauncher: launcher,
      reason: `Worker launcher "${launcher}" is not available right now. ${capability.detail}${next}`.trim(),
    }
  }

  return { ok: true, launcher }
}
