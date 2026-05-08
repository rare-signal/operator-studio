/**
 * Shared spawn helper for agent-bridge code paths.
 *
 * Always invoke shell-style tools through `runCommand` so user input
 * lands in argv (via execve) and never traverses a shell. Mirrors the
 * design used by the gitignored beta surface but lives in a public
 * module so the in-app Bento command center can lean on it without
 * cross-referencing the gitignored tree.
 */

import "server-only"

import { spawn } from "node:child_process"

export interface RunResult {
  stdout: string
  stderr: string
  code: number
}

export function runCommand(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string } = {}
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timeout = setTimeout(
      () => {
        if (settled) return
        settled = true
        try {
          child.kill("SIGKILL")
        } catch {
          // ignored
        }
        resolve({ stdout, stderr: stderr + "\n[timeout]", code: 124 })
      },
      opts.timeoutMs ?? 8000
    )
    child.stdout.on("data", (d) => {
      stdout += d.toString("utf8")
    })
    child.stderr.on("data", (d) => {
      stderr += d.toString("utf8")
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ stdout, stderr, code: code ?? 0 })
    })
    if (opts.input) {
      child.stdin.write(opts.input)
      child.stdin.end()
    } else {
      child.stdin.end()
    }
  })
}

/** tmux session names are user-controlled — validate before
 *  interpolating into argv. Matches tmux's allowed chars. */
export function isValidSessionName(name: string): boolean {
  return /^[A-Za-z0-9_.\-]{1,64}$/.test(name)
}

/** Claude/Codex JSONL session ids (the file basename). UUIDs and
 *  Codex's rollout-… filenames both match this. */
export function isValidJsonlId(id: string): boolean {
  return /^[A-Za-z0-9_.\-]{8,80}$/.test(id)
}

/** macOS app names. Letters / digits / spaces / common punctuation. */
const APP_NAME_RE = /^[A-Za-z0-9 _.\-]{1,64}$/
export function isValidAppName(name: string): boolean {
  return APP_NAME_RE.test(name)
}
