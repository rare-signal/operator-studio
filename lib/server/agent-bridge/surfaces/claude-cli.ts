import "server-only"

import { spawn } from "node:child_process"

import { listAppSessions } from "../app-sessions"
import { runCommand } from "../exec"
import type { AgentCompositeId } from "../types"
import type {
  AgentSurfaceAdapter,
  SpawnAgentArgs,
  SpawnAgentResult,
  SpawnEvidence,
} from "./types"

/**
 * Claude Code CLI surface — spawns `claude` as a detached subprocess
 * with the kickoff prompt, then reconciles the new session id by
 * polling `listAppSessions("claude")`. The CLI writes its JSONL to
 * `~/.claude/projects/<slug>/<session-id>.jsonl` — the SAME location
 * Claude Code Desktop uses — so the cockpit's existing /spawned-by
 * polling discovers CLI workers without changes.
 *
 * V1 contract:
 *   - Uses `--print` mode (one-shot). The CLI processes the prompt,
 *     runs whatever tools it needs, emits its final response, exits.
 *     The JSONL persists.
 *   - Worker lifecycle = process lifecycle. When the CLI exits,
 *     the binding's `isLive` flips to false on the next cockpit poll.
 *   - Doesn't yet support multi-turn re-engagement — that's V2 work
 *     (will need PTY + stdin write to the live process).
 *
 * Failure model mirrors `createNewAppSessionAndSend`:
 *   - `not-available` when `claude` isn't on PATH (cockpit should
 *     grey out the surface picker entry).
 *   - `subprocess-launch` when spawn(2) itself fails.
 *   - `process-exited-before-jsonl` when the CLI dies without ever
 *     creating a JSONL (auth failure, bad arg, etc.). The binding
 *     can be retried after the operator fixes the underlying issue.
 *
 * Doctrine: plan card `step-cli-tools-first-class-surface`.
 */

const PROMPT_BYTE_CAP = 256_000
const DEFAULT_RECONCILE_BUDGET_MS = 12_000
const DEFAULT_RECONCILE_INTERVAL_MS = 750

async function isAvailable(): Promise<boolean> {
  try {
    const r = await runCommand("claude", ["--version"], { timeoutMs: 5_000 })
    return r.code === 0
  } catch {
    return false
  }
}

async function snapshotIds(limit = 60): Promise<{
  ids: string[]
  byId: Map<string, number>
}> {
  const sessions = await listAppSessions("claude", limit)
  const byId = new Map<string, number>()
  for (const s of sessions) byId.set(s.id, s.mtimeMs)
  return { ids: sessions.map((s) => s.id), byId }
}

async function pollForNewSession(
  beforeIds: Set<string>,
  beforeMaxMtime: number,
  budgetMs: number,
  intervalMs: number
): Promise<{ id: string | null; candidates: string[]; durationMs: number }> {
  const start = Date.now()
  const deadline = start + budgetMs
  let bestCandidates: string[] = []
  while (Date.now() < deadline) {
    const after = await snapshotIds(60)
    const candidates: string[] = []
    for (const id of after.ids) {
      if (beforeIds.has(id)) continue
      const m = after.byId.get(id) ?? 0
      // Only consider files whose mtime is newer than the snapshot
      // baseline — guards against stale ids that happened to drop out
      // of the top-60 between snapshots.
      if (m > beforeMaxMtime) candidates.push(id)
    }
    if (candidates.length === 1) {
      return { id: candidates[0], candidates, durationMs: Date.now() - start }
    }
    if (candidates.length > 1) {
      bestCandidates = candidates
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return { id: null, candidates: bestCandidates, durationMs: Date.now() - start }
}

async function spawnCli(
  args: Omit<SpawnAgentArgs, "surface">
): Promise<SpawnAgentResult> {
  const surface = "claude-cli" as const
  const prompt = typeof args.prompt === "string" ? args.prompt : ""
  if (prompt.trim().length === 0) {
    return {
      ok: false,
      surface,
      stage: "validate",
      error: "Prompt is required",
      status: 400,
    }
  }
  if (Buffer.byteLength(prompt, "utf8") > PROMPT_BYTE_CAP) {
    return {
      ok: false,
      surface,
      stage: "validate",
      error: `Prompt exceeds ${PROMPT_BYTE_CAP} bytes`,
      status: 413,
    }
  }

  if (!(await isAvailable())) {
    return {
      ok: false,
      surface,
      stage: "not-available",
      error: "`claude` CLI not found on PATH (install with: npm install -g @anthropic-ai/claude-code)",
      status: 503,
    }
  }

  // Snapshot before so the post-spawn diff identifies the new file.
  const before = await snapshotIds(60)
  const beforeMaxMtime = before.byId.size === 0
    ? 0
    : Math.max(...Array.from(before.byId.values()))
  const beforeIdSet = new Set(before.ids)

  const launchedAt = new Date().toISOString()

  // Spawn `claude` as detached subprocess with the prompt as the
  // positional argument. `--print` makes it one-shot non-interactive
  // (runs the prompt, generates JSONL, exits). stdio:'ignore' so the
  // child can be detached without hanging on its open file
  // descriptors. detached:true puts it in its own process group so
  // killing the parent won't take it down.
  //
  // CRITICAL: strip ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL from the
  // child env. When those are set, Claude Code CLI ignores its OAuth /
  // subscription credentials and uses pay-per-token API billing
  // instead. Stripping them lets the CLI fall back to the operator's
  // claude.ai subscription (verified 2026-05-12 via `claude auth status`
  // with env stripped — still returns `authMethod: "claude.ai"`).
  // Lifts every CLI-spawned worker onto the Max subscription bucket.
  const childEnv: NodeJS.ProcessEnv = { ...process.env }
  delete childEnv.ANTHROPIC_API_KEY
  delete childEnv.ANTHROPIC_BASE_URL
  // Anthropic SDK also reads these aliases; remove for completeness.
  delete childEnv.ANTHROPIC_AUTH_TOKEN
  delete childEnv.ANTHROPIC_BEDROCK_BASE_URL
  delete childEnv.ANTHROPIC_VERTEX_PROJECT_ID

  const modelArgs = args.model ? ["--model", args.model] : []

  let child
  try {
    child = spawn("claude", ["--print", ...modelArgs, prompt], {
      detached: true,
      stdio: "ignore",
      env: childEnv,
    })
    child.unref() // let the parent exit independently
  } catch (e) {
    return {
      ok: false,
      surface,
      stage: "subprocess-launch",
      error: e instanceof Error ? e.message : "spawn failed",
      status: 500,
    }
  }

  // Watch for early exit — if the process dies before the JSONL
  // appears, we want to surface that distinctly from "we couldn't find
  // the new id" (which usually means the JSONL is in flight).
  let earlyExitCode: number | null = null
  child.on("exit", (code) => {
    earlyExitCode = code ?? 0
  })

  const budgetMs = args.reconcileBudgetMs ?? DEFAULT_RECONCILE_BUDGET_MS
  const intervalMs = args.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS

  const polled = await pollForNewSession(
    beforeIdSet,
    beforeMaxMtime,
    budgetMs,
    intervalMs
  )

  const after = await snapshotIds(60)
  const evidence: SpawnEvidence = {
    preSnapshotIds: before.ids,
    postSnapshotIds: after.ids,
    candidateIds: polled.candidates,
    pickedId: polled.id,
    ambiguous: polled.candidates.length > 1,
    pollDurationMs: polled.durationMs,
  }
  const promptPreview = prompt.slice(0, 140)

  if (polled.id) {
    const agentId: AgentCompositeId = `claude:${polled.id}` as AgentCompositeId
    return {
      ok: true,
      reconciled: true,
      surface,
      agentId,
      launchedAt,
      promptPreview,
      submitted: true,
      evidence,
    }
  }

  if (earlyExitCode !== null && earlyExitCode !== 0) {
    return {
      ok: true,
      reconciled: false,
      surface,
      agentId: null,
      launchedAt,
      promptPreview,
      submitted: true,
      reason: "process-exited-before-jsonl",
      evidence,
    }
  }

  return {
    ok: true,
    reconciled: false,
    surface,
    agentId: null,
    launchedAt,
    promptPreview,
    submitted: true,
    reason:
      polled.candidates.length > 1 ? "multiple-candidates" : "no-new-session-found",
    evidence,
  }
}

/** Default model for exec-tier CLI spawns. Pass this via `spawnAgent({ model: DEFAULT_EXEC_MODEL })`. */
export const DEFAULT_EXEC_MODEL = "claude-opus-4-7"

export const claudeCliAdapter: AgentSurfaceAdapter = {
  kind: "claude-cli",
  isAvailable,
  spawn: spawnCli,
}
