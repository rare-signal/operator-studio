import "server-only"

import type { AgentCompositeId } from "../types"

/**
 * Agent surfaces — the abstracted "where does a worker run" concept.
 * CLI-only as of 2026-05-12; Claude Desktop and Codex Desktop AX paths
 * have been retired. Each surface is a sibling under one dispatcher
 * (`lib/server/agent-bridge/surfaces/index.ts`).
 *
 * Doctrine: project went fully CLI-only on 2026-05-12. Adding a new
 * surface = implementing the `AgentSurfaceAdapter` interface and
 * registering it; nothing else in the system should care which
 * surface a worker came from once it's bound.
 */
export type SurfaceKind = "claude-cli" | "codex-cli"

export interface SpawnAgentArgs {
  surface: SurfaceKind
  prompt: string
  /** Default true. Reserved for parity with the retired Desktop
   *  surfaces (which staged a prompt without submitting); CLI surfaces
   *  always submit on spawn, so this is currently ignored. */
  submit?: boolean
  /** Override the JSONL reconcile-poll window. Default 12s, 750ms tick. */
  reconcileBudgetMs?: number
  reconcileIntervalMs?: number
  /** Model id passed to the CLI via `--model`. Exec-tier callers
   *  should default to `claude-opus-4-7`. */
  model?: string
}

export interface SpawnEvidence {
  preSnapshotIds: string[]
  postSnapshotIds: string[]
  candidateIds: string[]
  pickedId: string | null
  ambiguous: boolean
  pollDurationMs: number
}

export type SpawnAgentResult =
  | {
      ok: true
      reconciled: true
      surface: SurfaceKind
      agentId: AgentCompositeId
      launchedAt: string
      promptPreview: string
      submitted: boolean
      evidence?: SpawnEvidence
    }
  | {
      ok: true
      reconciled: false
      surface: SurfaceKind
      agentId: null
      launchedAt: string
      promptPreview: string
      submitted: boolean
      reason:
        | "no-new-session-found"
        | "multiple-candidates"
        | "process-exited-before-jsonl"
      evidence?: SpawnEvidence
    }
  | {
      ok: false
      surface: SurfaceKind
      stage:
        | "validate"
        | "not-available"
        | "subprocess-launch"
        | "subprocess-error"
        | "not-implemented"
      error: string
      status: number
    }

export interface AgentSurfaceAdapter {
  kind: SurfaceKind
  /** Returns true if this surface's prerequisites are satisfied on the
   *  current host (binary on PATH for CLI, app installed for Desktop).
   *  Cheap; called by the cockpit's surface picker to grey out the
   *  options that won't work. */
  isAvailable(): Promise<boolean>
  /** Spawn a new agent on this surface with the given kickoff prompt.
   *  Reconciles back to an `agentId` (the JSONL session id, prefixed
   *  with the agent kind — same composite id Desktop spawns produce). */
  spawn(args: Omit<SpawnAgentArgs, "surface">): Promise<SpawnAgentResult>
}
