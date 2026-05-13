/**
 * Indirection over `runCommand` so tests can swap the macOS primitives
 * (pbcopy / pbpaste / osascript) without monkey-patching globals or
 * spawning real processes.
 *
 * Production: `runCommand` here delegates straight to `./exec`'s real
 * spawn-based implementation. Acceptance tests call `setCommandRunner`
 * with a synthetic state machine, then restore via `resetCommandRunner`.
 *
 * Keep the surface tiny — the only thing app-control.ts needs is
 * `runCommand`. Everything else stays in `./exec`.
 */

import "server-only"

import {
  runCommand as realRunCommand,
  type RunResult,
} from "./exec"

export type CommandRunner = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string }
) => Promise<RunResult>

let current: CommandRunner = realRunCommand

export const runCommand: CommandRunner = (command, args, opts) =>
  current(command, args, opts)

export function setCommandRunner(next: CommandRunner): void {
  current = next
}

export function resetCommandRunner(): void {
  current = realRunCommand
}
