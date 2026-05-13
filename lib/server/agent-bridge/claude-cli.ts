/**
 * Headless Claude Code CLI spawn pipeline — server-triggered sibling of
 * the Desktop GUI pipeline (`app-new-session.ts`).
 *
 * WHY THIS EXISTS:
 * The Desktop pipeline drives Claude Code Desktop via AppleScript. That
 * cannot run from a server context (App Runner / Lambda / EC2 webhook
 * handler) because no GUI session exists. This wrapper drives the
 * `@anthropic-ai/claude-code` CLI as a child process so an Azure DevOps
 * webhook can fire a worker without any human GUI interaction.
 *
 * See `memory/project_no_clis_only_desktop.md` (scoping update 2026-05-10).
 *
 * INSTALL + AUTH STEPS (operator setup):
 *
 *   1. `npm install -g @anthropic-ai/claude-code`
 *   2. `claude` (first interactive run prompts to authenticate via
 *      anthropic.com OAuth flow — opens browser; sign in with the
 *      account that has Claude Code Max / Pro entitlements)
 *   3. Verify: `claude --version` should print a version line.
 *   4. Verify auth: `claude --print "what is 2+2"` should return "4"
 *      with no auth prompt.
 *
 * The CLI keeps credentials under `~/.claude/` (same data dir the
 * Desktop apps use). Once auth'd interactively, headless `--print`
 * invocations reuse those credentials.
 *
 * OUTPUT FORMAT (verified on CLI v0.2.65, 2026-05-10):
 * The installed CLI supports `--print`, `--json`, `--dangerously-skip-
 * permissions`, `--allowedTools`. It does NOT support `--output-format
 * stream-json`, `--append-system-prompt`, or `--resume` (those are on
 * later builds). So this wrapper:
 *
 *   - Uses `--print --json` to get `{cost_usd, duration_ms,
 *     duration_api_ms, result}` on stdout.
 *   - Reconciles the session id by snapshotting JSONL files in
 *     `~/.claude/projects/<cwd-slug>/` before and after the invocation
 *     and picking the new UUID.
 *   - Implements "append system prompt" as a prefix tucked into the
 *     prompt body, since the flag isn't available. Newer CLIs (with
 *     `--append-system-prompt`) should swap this for the native flag.
 */

import "server-only"

import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import { createWriteStream } from "node:fs"
import os from "node:os"
import path from "node:path"

import type { AgentCompositeId } from "./types"

/** Default wall-time bound on a CLI spawn. ADO webhook handlers can
 *  legitimately need a long-running worker (multi-file refactor, repo-
 *  wide grep, etc.), but unbounded subprocesses are a footgun. 30 min
 *  matches the upper bound on a typical ticket batch. */
const DEFAULT_MAX_WALL_MS = 30 * 60_000

/** Where we stream stdout/stderr per invocation. Persisting outside
 *  the request lifecycle is important: an HTTP handler may return
 *  before the CLI exits (we wait, but ops needs the log file regardless
 *  to investigate hangs). */
const LOG_ROOT = "/tmp/operator-studio-cli-spawns"

export interface ClaudeCliReadyOk {
  ok: true
  version: string
  binaryPath: string
}
export interface ClaudeCliReadyErr {
  ok: false
  kind: "not-installed" | "version-check-failed"
  error: string
}
export type ClaudeCliReadyResult = ClaudeCliReadyOk | ClaudeCliReadyErr

export interface SpawnClaudeCliWorkerArgs {
  prompt: string
  /** Working directory for the spawned CLI. Defaults to process.cwd().
   *  The CLI's project-scoped session JSONLs land under
   *  `~/.claude/projects/<slugified-cwd>/<UUID>.jsonl`. */
  cwd?: string
  /** Optional system prompt prepended to `prompt`. Older CLIs lack
   *  `--append-system-prompt`, so we splice it inline. */
  systemPromptAppend?: string
  /** Extra env vars passed to the child. Merged onto process.env. */
  env?: Record<string, string>
  /** Override wall-time bound (ms). */
  maxWallMs?: number
  /** Skip permission prompts. Required for non-interactive operation;
   *  the wrapper sets this by default. Set false only for sandboxed
   *  smoke tests. */
  dangerouslySkipPermissions?: boolean
}

export interface SpawnClaudeCliWorkerOk {
  ok: true
  agentId: AgentCompositeId
  /** Absolute path to the reconciled JSONL session file (if found).
   *  Null when no new file appeared within the reconcile budget — the
   *  CLI may have errored before writing one. */
  jsonlPath: string | null
  /** Path to the log file capturing stdout+stderr. */
  logPath: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}
export interface SpawnClaudeCliWorkerErr {
  ok: false
  kind:
    | "validate"
    | "cli-not-ready"
    | "spawn-failed"
    | "timeout"
    | "nonzero-exit"
  error: string
  /** Populated when the failure happened after spawn (timeout / nonzero
   *  exit), so the caller can investigate. */
  logPath?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
}
export type SpawnClaudeCliWorkerResult =
  | SpawnClaudeCliWorkerOk
  | SpawnClaudeCliWorkerErr

const PROMPT_BYTE_CAP = 256_000

/**
 * TODO (step-claude-code-cli-spawn-pipeline): when the server-triggered
 * CLI spawn path lands an inbox-event → factory-route → spawn handler,
 * thread the matched `FactoryEntry` through to that handler and build
 * the prompt via `buildKickoffForFactory` from
 * `lib/operator-studio/berthier-flavors`. Today `spawnClaudeCliWorker`
 * takes a pre-built prompt only — flavor selection happens upstream at
 * the route layer (`app/api/operator-studio/work-lanes/[id]/exec`).
 * Acceptance for the JSA flavor wire-up is mocked at that route layer
 * via `scripts/jsa-berthier-flavor-acceptance.ts`.
 */

/** Slug for `~/.claude/projects/<slug>/` from an absolute cwd. The CLI
 *  uses path-with-slashes-replaced-by-dashes (verified by inspecting
 *  `~/.claude/projects/-Users-smackbook-operator-studio/` against the
 *  repo's actual absolute path). */
export function claudeProjectSlugForCwd(cwd: string): string {
  return cwd.replace(/\//g, "-")
}

export function claudeProjectsDir(cwd: string): string {
  return path.join(os.homedir(), ".claude", "projects", claudeProjectSlugForCwd(cwd))
}

export async function assertClaudeCliReady(): Promise<ClaudeCliReadyResult> {
  return new Promise((resolve) => {
    const child = spawn("claude", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout?.on("data", (b) => (out += b.toString("utf8")))
    child.stderr?.on("data", (b) => (err += b.toString("utf8")))
    child.on("error", (e) => {
      const msg = e instanceof Error ? e.message : String(e)
      resolve({
        ok: false,
        kind: "not-installed",
        error: `claude binary not found on PATH. Install with: npm install -g @anthropic-ai/claude-code  (raw: ${msg})`,
      })
    })
    child.on("exit", (code) => {
      if (code === 0) {
        const version = out.trim().split(/\s+/)[0] ?? out.trim()
        resolve({ ok: true, version, binaryPath: "claude" })
      } else {
        resolve({
          ok: false,
          kind: "version-check-failed",
          error: `claude --version exited ${code}: ${err.trim() || out.trim() || "unknown"}`,
        })
      }
    })
  })
}

async function snapshotJsonlIds(projectDir: string): Promise<Set<string>> {
  const out = new Set<string>()
  let entries: import("fs").Dirent[]
  try {
    entries = (await fs.readdir(projectDir, {
      withFileTypes: true,
    })) as unknown as import("fs").Dirent[]
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isFile()) continue
    if (!e.name.endsWith(".jsonl")) continue
    out.add(e.name.slice(0, -".jsonl".length))
  }
  return out
}

export async function spawnClaudeCliWorker(
  args: SpawnClaudeCliWorkerArgs
): Promise<SpawnClaudeCliWorkerResult> {
  // ---- validate ---------------------------------------------------------
  const prompt = typeof args.prompt === "string" ? args.prompt : ""
  if (prompt.trim().length === 0) {
    return { ok: false, kind: "validate", error: "prompt is required" }
  }
  if (Buffer.byteLength(prompt, "utf8") > PROMPT_BYTE_CAP) {
    return {
      ok: false,
      kind: "validate",
      error: `prompt exceeds ${PROMPT_BYTE_CAP} bytes`,
    }
  }
  const cwd = args.cwd ?? process.cwd()
  // Resolve to absolute so the project-slug logic is stable regardless
  // of what the caller passed.
  const absCwd = path.resolve(cwd)
  try {
    const st = await fs.stat(absCwd)
    if (!st.isDirectory()) {
      return { ok: false, kind: "validate", error: `cwd is not a directory: ${absCwd}` }
    }
  } catch (e) {
    return {
      ok: false,
      kind: "validate",
      error: `cwd does not exist: ${absCwd} (${e instanceof Error ? e.message : "unknown"})`,
    }
  }

  // ---- preflight: is the CLI usable? ------------------------------------
  const ready = await assertClaudeCliReady()
  if (!ready.ok) {
    return { ok: false, kind: "cli-not-ready", error: ready.error }
  }

  // ---- prepare log sink + JSONL pre-snapshot ---------------------------
  await fs.mkdir(LOG_ROOT, { recursive: true })
  const provisionalId = `pending-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const logPath = path.join(LOG_ROOT, `${provisionalId}.log`)
  const logStream = createWriteStream(logPath, { flags: "a" })

  const projectDir = claudeProjectsDir(absCwd)
  const beforeIds = await snapshotJsonlIds(projectDir)

  // ---- splice optional system prompt ------------------------------------
  const finalPrompt = args.systemPromptAppend
    ? `[SYSTEM CONTEXT]\n${args.systemPromptAppend}\n\n[USER PROMPT]\n${prompt}`
    : prompt

  // ---- spawn ------------------------------------------------------------
  const skipPerms = args.dangerouslySkipPermissions !== false
  const cliArgs: string[] = ["--print", "--json"]
  if (skipPerms) cliArgs.push("--dangerously-skip-permissions")
  // Pass prompt as a positional arg. CLI also accepts stdin, but argv
  // keeps the invocation visible in ps output for debugging — and the
  // 256KB cap keeps us well clear of ARG_MAX on macOS/Linux.
  cliArgs.push(finalPrompt)

  const maxWallMs = Math.max(60_000, args.maxWallMs ?? DEFAULT_MAX_WALL_MS)
  const startedAt = Date.now()

  let child: ReturnType<typeof spawn>
  try {
    child = spawn("claude", cliArgs, {
      cwd: absCwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(args.env ?? {}) },
    })
  } catch (e) {
    logStream.end()
    return {
      ok: false,
      kind: "spawn-failed",
      error: e instanceof Error ? e.message : String(e),
      logPath,
    }
  }

  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (b: Buffer) => {
    stdout += b.toString("utf8")
    logStream.write(b)
  })
  child.stderr?.on("data", (b: Buffer) => {
    stderr += b.toString("utf8")
    logStream.write(b)
  })

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      child.kill("SIGKILL")
    } catch {
      /* ignore */
    }
  }, maxWallMs)

  // Make sure we kill the child if this process exits unexpectedly.
  const parentExitHandler = () => {
    try {
      child.kill("SIGKILL")
    } catch {
      /* ignore */
    }
  }
  process.once("exit", parentExitHandler)

  const exitCode: number | null = await new Promise((resolve) => {
    child.on("exit", (code) => resolve(code))
    child.on("error", () => resolve(null))
  })
  clearTimeout(timer)
  process.off("exit", parentExitHandler)
  logStream.end()
  const durationMs = Date.now() - startedAt

  if (timedOut) {
    return {
      ok: false,
      kind: "timeout",
      error: `claude CLI exceeded ${maxWallMs}ms wall budget; SIGKILLed`,
      logPath,
      stdout,
      stderr,
      exitCode,
    }
  }
  if (exitCode !== 0) {
    return {
      ok: false,
      kind: "nonzero-exit",
      error: `claude CLI exited ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown"}`,
      logPath,
      stdout,
      stderr,
      exitCode,
    }
  }

  // ---- reconcile new session id ----------------------------------------
  // The CLI flushes its JSONL on exit. Snapshot once; if nothing new
  // appears, poll briefly — on fast machines the file is there but the
  // dir listing may have stale stat cache.
  let agentRef: string | null = null
  let jsonlPath: string | null = null
  const reconcileDeadline = Date.now() + 4_000
  while (Date.now() < reconcileDeadline) {
    const afterIds = await snapshotJsonlIds(projectDir)
    for (const id of afterIds) {
      if (!beforeIds.has(id)) {
        agentRef = id
        jsonlPath = path.join(projectDir, `${id}.jsonl`)
        break
      }
    }
    if (agentRef) break
    await new Promise((r) => setTimeout(r, 250))
  }

  if (!agentRef) {
    // The CLI succeeded but we couldn't see a new JSONL. Synthesize a
    // composite id from the provisional so the caller has something to
    // record; jsonlPath stays null so the cockpit shows it as unreconciled.
    agentRef = provisionalId
  }
  const agentId = `claude:${agentRef}` as AgentCompositeId

  return {
    ok: true,
    agentId,
    jsonlPath,
    logPath,
    stdout,
    stderr,
    exitCode: 0,
    durationMs,
  }
}
