import "server-only"

import { claudeCliAdapter } from "./claude-cli"
import { codexCliAdapter } from "./codex-cli"
import type {
  AgentSurfaceAdapter,
  SpawnAgentArgs,
  SpawnAgentResult,
  SurfaceKind,
} from "./types"

/**
 * Agent surface registry + dispatcher — CLI-only as of 2026-05-12.
 *
 * Operator Studio went fully CLI-only on this date; Claude Desktop and
 * Codex Desktop AppleScript/AX spawn paths were retired. New worker
 * spawns and new chats always go through one of the two CLI adapters:
 *
 *   - `claude-cli` — `claude --print` against the operator's claude.ai
 *     OAuth subscription (env-stripped to bypass pay-per-token API).
 *   - `codex-cli`  — `codex exec` driving the bundled OpenAI Codex CLI.
 *
 * Legacy Desktop threads remain READABLE via `lib/server/agent-bridge/
 * app-sessions.ts` (pure filesystem walk of `~/.claude/projects/` and
 * `~/.codex/sessions/`) and PARTICIPABLE via `claude --resume <id>`
 * (`claude-cli-send.ts`) — the resume path works on any JSONL session
 * regardless of how it was originally created. So an exec can identify
 * a still-running Desktop session and chat into it from Operator Studio
 * without spawning a new AX paste.
 *
 * Adding a new surface = implement `AgentSurfaceAdapter`, register it
 * here, and add its kind to `types.ts`'s `SurfaceKind` union. Nothing
 * else in the system needs to care which surface a worker came from
 * once it's bound.
 */

export const SURFACE_REGISTRY: Record<SurfaceKind, AgentSurfaceAdapter> = {
  "claude-cli": claudeCliAdapter,
  "codex-cli": codexCliAdapter,
}

/**
 * Per-surface availability snapshot — cockpit picker calls this to grey
 * out the entries whose prerequisites aren't met (CLI binary missing).
 * Cheap; aggregates each adapter's `isAvailable`.
 */
export async function listSurfaceAvailability(): Promise<
  Array<{ kind: SurfaceKind; available: boolean }>
> {
  const entries = await Promise.all(
    (Object.keys(SURFACE_REGISTRY) as SurfaceKind[]).map(async (k) => ({
      kind: k,
      available: await SURFACE_REGISTRY[k].isAvailable(),
    }))
  )
  return entries
}

/**
 * Dispatch a spawn to the right adapter. The single entry point that
 * cockpit / spawn-script / API-route code calls. Every surface-specific
 * concern (subprocess lifecycle, JSONL reconciliation, env stripping)
 * lives inside the adapter implementations.
 */
export async function spawnAgent(args: SpawnAgentArgs): Promise<SpawnAgentResult> {
  const adapter = SURFACE_REGISTRY[args.surface]
  if (!adapter) {
    return {
      ok: false,
      surface: args.surface,
      stage: "validate",
      error: `Unknown surface: ${args.surface}`,
      status: 400,
    }
  }
  return adapter.spawn({
    prompt: args.prompt,
    submit: args.submit,
    reconcileBudgetMs: args.reconcileBudgetMs,
    reconcileIntervalMs: args.reconcileIntervalMs,
    model: args.model,
  })
}

export type { SpawnAgentArgs, SpawnAgentResult, SurfaceKind } from "./types"
