/**
 * Headless OpenAI Codex CLI spawn pipeline — server-triggered sibling of
 * `claude-cli.ts`. The Codex binary's interactive UI is not what we want
 * from a webhook handler / App Runner context, so we drive `codex exec`
 * as a child process.
 *
 * BINARY LOCATION:
 * The Codex CLI is bundled with Codex.app on macOS at
 * `/Applications/Codex.app/Contents/Resources/codex` and is typically NOT
 * on PATH. We resolve in this order:
 *   1. `CODEX_BIN` env var (operator override).
 *   2. `codex` on PATH.
 *   3. `/Applications/Codex.app/Contents/Resources/codex` (mac fallback).
 *
 * AUTH:
 * Either OAuth (via `codex login`, credentials in `~/.codex/auth.json`)
 * or `OPENAI_API_KEY` in the child's env. Either works for `codex exec`.
 *
 * SESSION FILE LAYOUT (verified on codex-cli 0.130.0-alpha.5):
 *   `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<UUID>.jsonl`
 * Reconciliation: snapshot file paths before the spawn, diff after.
 *
 * RELEVANT FLAGS (codex exec):
 *   --json                                    JSONL events on stdout
 *   --dangerously-bypass-approvals-and-sandbox  non-interactive auto-run
 *   -C, --cd <DIR>                            working directory
 *   --skip-git-repo-check                     allow non-repo cwd
 *   -m, --model <MODEL>                       override model
 *   -o, --output-last-message <FILE>          write final assistant msg
 */

import "server-only"

import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import { createWriteStream } from "node:fs"
import os from "node:os"
import path from "node:path"
import { delimiter } from "node:path"
import { constants as fsConstants } from "node:fs"

import type { AgentCompositeId } from "./types"

const DEFAULT_MAX_WALL_MS = 30 * 60_000
const LOG_ROOT = "/tmp/operator-studio-cli-spawns"
const PROMPT_BYTE_CAP = 256_000

const MAC_CODEX_APP_BIN = "/Applications/Codex.app/Contents/Resources/codex"

export interface CodexCliReadyOk {
  ok: true
  version: string
  binaryPath: string
}
export interface CodexCliReadyErr {
  ok: false
  kind: "not-installed" | "version-check-failed"
  error: string
}
export type CodexCliReadyResult = CodexCliReadyOk | CodexCliReadyErr

export interface SpawnCodexCliWorkerArgs {
  prompt: string
  /** Defaults to process.cwd(). */
  cwd?: string
  /** Prepended to `prompt` as a system-context block. Codex `exec` has no
   *  dedicated system-prompt flag; we splice inline. */
  systemPromptAppend?: string
  /** Override the resolved binary. */
  binaryPath?: string
  /** Override model (e.g. `gpt-5-codex`). */
  model?: string
  /** Extra env vars merged onto process.env. `OPENAI_API_KEY` belongs here
   *  if not already exported in the parent process. */
  env?: Record<string, string>
  maxWallMs?: number
  /** Skip approvals + sandbox. Required for non-interactive operation;
   *  the wrapper sets this by default. Set false only for sandboxed
   *  smoke tests where you accept the CLI hanging on a prompt. */
  dangerouslyBypassApprovalsAndSandbox?: boolean
  /** Permit running outside a git repo. Defaults true (server-spawned
   *  workers may operate on scratch dirs). */
  skipGitRepoCheck?: boolean
}

export interface SpawnCodexCliWorkerOk {
  ok: true
  agentId: AgentCompositeId
  /** Absolute path to the reconciled rollout JSONL (if found). */
  jsonlPath: string | null
  /** Path to the stdout+stderr log file. */
  logPath: string
  /** Contents of `--output-last-message` if Codex wrote one. */
  lastMessage: string | null
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}
export interface SpawnCodexCliWorkerErr {
  ok: false
  kind:
    | "validate"
    | "cli-not-ready"
    | "spawn-failed"
    | "timeout"
    | "nonzero-exit"
  error: string
  logPath?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
}
export type SpawnCodexCliWorkerResult =
  | SpawnCodexCliWorkerOk
  | SpawnCodexCliWorkerErr

export function codexSessionsDir(): string {
  return path.join(os.homedir(), ".codex", "sessions")
}

async function fileExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

async function executableOnPath(name: string): Promise<string | null> {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean)
  for (const dir of paths) {
    const candidate = path.join(dir, name)
    if (await fileExecutable(candidate)) return candidate
  }
  return null
}

/** Resolve the codex binary path. See module docstring for resolution order. */
export async function resolveCodexBinary(
  override?: string,
): Promise<string | null> {
  if (override) {
    return (await fileExecutable(override)) ? override : null
  }
  if (process.env.CODEX_BIN) {
    if (await fileExecutable(process.env.CODEX_BIN)) return process.env.CODEX_BIN
  }
  const onPath = await executableOnPath("codex")
  if (onPath) return onPath
  if (await fileExecutable(MAC_CODEX_APP_BIN)) return MAC_CODEX_APP_BIN
  return null
}

export async function assertCodexCliReady(
  binaryPath?: string,
): Promise<CodexCliReadyResult> {
  const bin = await resolveCodexBinary(binaryPath)
  if (!bin) {
    return {
      ok: false,
      kind: "not-installed",
      error:
        "codex binary not found. Set CODEX_BIN, put codex on PATH, or install Codex.app (mac fallback resolves /Applications/Codex.app/Contents/Resources/codex).",
    }
  }
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout?.on("data", (b) => (out += b.toString("utf8")))
    child.stderr?.on("data", (b) => (err += b.toString("utf8")))
    child.on("error", (e) => {
      resolve({
        ok: false,
        kind: "version-check-failed",
        error: e instanceof Error ? e.message : String(e),
      })
    })
    child.on("exit", (code) => {
      if (code === 0) {
        const version = out.trim() || err.trim()
        resolve({ ok: true, version, binaryPath: bin })
      } else {
        resolve({
          ok: false,
          kind: "version-check-failed",
          error: `${bin} --version exited ${code}: ${err.trim() || out.trim() || "unknown"}`,
        })
      }
    })
  })
}

async function snapshotRolloutPaths(): Promise<Set<string>> {
  const root = codexSessionsDir()
  const out = new Set<string>()
  async function walk(dir: string): Promise<void> {
    let entries: import("fs").Dirent[]
    try {
      entries = (await fs.readdir(dir, {
        withFileTypes: true,
      })) as unknown as import("fs").Dirent[]
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        out.add(full)
      }
    }
  }
  await walk(root)
  return out
}

/** Extract the trailing UUID from a rollout filename like
 *  `rollout-2026-04-02T16-07-13-019d5073-67d3-7372-a3bd-b4efcc1b160c.jsonl`.
 *  The UUID is the last five dash-separated groups before `.jsonl`. */
export function rolloutIdFromPath(filePath: string): string | null {
  const base = path.basename(filePath, ".jsonl")
  if (!base.startsWith("rollout-")) return null
  const parts = base.split("-")
  if (parts.length < 6) return null
  const uuid = parts.slice(-5).join("-")
  return /^[0-9a-f-]{32,}$/i.test(uuid) ? uuid : null
}

export async function spawnCodexCliWorker(
  args: SpawnCodexCliWorkerArgs,
): Promise<SpawnCodexCliWorkerResult> {
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

  // ---- preflight --------------------------------------------------------
  const ready = await assertCodexCliReady(args.binaryPath)
  if (!ready.ok) {
    return { ok: false, kind: "cli-not-ready", error: ready.error }
  }
  const binaryPath = ready.binaryPath

  // ---- prepare log sink + session pre-snapshot --------------------------
  await fs.mkdir(LOG_ROOT, { recursive: true })
  const provisionalId = `pending-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const logPath = path.join(LOG_ROOT, `${provisionalId}.log`)
  const lastMessagePath = path.join(LOG_ROOT, `${provisionalId}.last-message.txt`)
  const logStream = createWriteStream(logPath, { flags: "a" })

  const beforePaths = await snapshotRolloutPaths()

  // ---- splice optional system prompt ------------------------------------
  const finalPrompt = args.systemPromptAppend
    ? `[SYSTEM CONTEXT]\n${args.systemPromptAppend}\n\n[USER PROMPT]\n${prompt}`
    : prompt

  // ---- build argv -------------------------------------------------------
  const bypass = args.dangerouslyBypassApprovalsAndSandbox !== false
  const skipGit = args.skipGitRepoCheck !== false
  const cliArgs: string[] = ["exec", "--json", "-C", absCwd, "-o", lastMessagePath]
  if (bypass) cliArgs.push("--dangerously-bypass-approvals-and-sandbox")
  if (skipGit) cliArgs.push("--skip-git-repo-check")
  if (args.model) cliArgs.push("-m", args.model)
  cliArgs.push(finalPrompt)

  const maxWallMs = Math.max(60_000, args.maxWallMs ?? DEFAULT_MAX_WALL_MS)
  const startedAt = Date.now()

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(binaryPath, cliArgs, {
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
      error: `codex CLI exceeded ${maxWallMs}ms wall budget; SIGKILLed`,
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
      error: `codex CLI exited ${exitCode}: ${stderr.trim() || stdout.trim() || "unknown"}`,
      logPath,
      stdout,
      stderr,
      exitCode,
    }
  }

  // ---- reconcile new rollout file ---------------------------------------
  let agentRef: string | null = null
  let jsonlPath: string | null = null
  const reconcileDeadline = Date.now() + 4_000
  while (Date.now() < reconcileDeadline) {
    const afterPaths = await snapshotRolloutPaths()
    for (const p of afterPaths) {
      if (!beforePaths.has(p)) {
        const id = rolloutIdFromPath(p)
        if (id) {
          agentRef = id
          jsonlPath = p
          break
        }
      }
    }
    if (agentRef) break
    await new Promise((r) => setTimeout(r, 250))
  }

  if (!agentRef) agentRef = provisionalId
  const agentId = `codex:${agentRef}` as AgentCompositeId

  let lastMessage: string | null = null
  try {
    lastMessage = await fs.readFile(lastMessagePath, "utf8")
  } catch {
    lastMessage = null
  }

  return {
    ok: true,
    agentId,
    jsonlPath,
    logPath,
    lastMessage,
    stdout,
    stderr,
    exitCode: 0,
    durationMs,
  }
}
