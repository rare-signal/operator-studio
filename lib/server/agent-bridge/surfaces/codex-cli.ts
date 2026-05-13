import "server-only"

import {
  assertCodexCliReady,
  spawnCodexCliWorker,
} from "../codex-cli"
import type {
  AgentSurfaceAdapter,
  SpawnAgentArgs,
  SpawnAgentResult,
} from "./types"

/**
 * Codex CLI surface — drives `codex exec` as a detached subprocess via
 * `spawnCodexCliWorker` (the headless OpenAI Codex CLI pipeline). Like
 * `claude-cli.ts`, this adapter is subscription/key-bound on the host
 * and has no GUI dependency.
 *
 * Reconciliation: `spawnCodexCliWorker` diffs
 * `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` before/after the spawn
 * and returns the rollout UUID as `codex:<uuid>`.
 *
 * Note on submit/reconcile knobs: the Codex CLI is fully one-shot —
 * `submit` is implicit, and the reconcile budget is encoded inside
 * `spawnCodexCliWorker` (4s post-exit poll). The surface API knobs
 * (`submit`, `reconcileBudgetMs`, `reconcileIntervalMs`) are accepted
 * for parity with `claude-cli` but currently ignored.
 *
 * Doctrine: project-wide CLI-only as of 2026-05-12. Claude Desktop and
 * Codex Desktop AX paths have been removed; this adapter is one of the
 * two first-class spawn surfaces.
 */

async function isAvailable(): Promise<boolean> {
  const r = await assertCodexCliReady()
  return r.ok
}

async function spawnSurface(
  args: Omit<SpawnAgentArgs, "surface">
): Promise<SpawnAgentResult> {
  const surface = "codex-cli" as const
  const launchedAt = new Date().toISOString()
  const r = await spawnCodexCliWorker({
    prompt: args.prompt,
    model: args.model,
  })
  if (!r.ok) {
    const stage =
      r.kind === "validate"
        ? "validate"
        : r.kind === "cli-not-ready"
          ? "not-available"
          : r.kind === "spawn-failed"
            ? "subprocess-launch"
            : "subprocess-error"
    const status =
      r.kind === "validate"
        ? 400
        : r.kind === "cli-not-ready"
          ? 503
          : r.kind === "timeout"
            ? 504
            : 500
    return {
      ok: false,
      surface,
      stage,
      error: r.error,
      status,
    }
  }
  const promptPreview = args.prompt.slice(0, 140)
  return {
    ok: true,
    reconciled: true,
    surface,
    agentId: r.agentId,
    launchedAt,
    promptPreview,
    submitted: true,
    evidence: undefined,
  }
}

export const codexCliAdapter: AgentSurfaceAdapter = {
  kind: "codex-cli",
  isAvailable,
  spawn: spawnSurface,
}
