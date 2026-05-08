/**
 * tmux read/write helpers for the Bento command center.
 *
 * Read paths: list-sessions, capture-pane.
 * Write paths: send-keys (literal text + named keys, two-phase).
 *
 * No tmux session is created here — operators are expected to start
 * their tmux sessions themselves. If `tmux list-sessions` errors with
 * "no server running", we treat that as an empty list.
 */

import "server-only"

import { isValidSessionName, runCommand } from "./exec"

export interface TmuxSession {
  name: string
  lastActivityAt: string
  attached: boolean
  command: string
  windows: number
}

const DELIM = "|::|"

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  const { stdout, stderr, code } = await runCommand("tmux", [
    "list-sessions",
    "-F",
    `#{session_name}${DELIM}#{session_activity}${DELIM}#{session_attached}${DELIM}#{pane_current_command}${DELIM}#{session_windows}`,
  ])
  if (code !== 0) {
    if (
      /no server running|no sessions|error connecting to .*tmux/i.test(stderr)
    ) {
      return []
    }
    throw new Error(`tmux failed: ${stderr.trim() || "unknown"}`)
  }
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, activity, attached, cmd, windows] = line.split(DELIM)
      const activityNum = Number(activity)
      const lastActivityAt = Number.isFinite(activityNum)
        ? new Date(activityNum * 1000).toISOString()
        : new Date().toISOString()
      return {
        name: name ?? "",
        lastActivityAt,
        attached: Number(attached) > 0,
        command: cmd ?? "",
        windows: Number(windows ?? 1),
      }
    })
    .filter((s) => s.name.length > 0)
}

export interface TmuxCapture {
  name: string
  lines: number
  capturedAt: string
  content: string
}

export async function captureTmuxPane(
  name: string,
  lines: number
): Promise<TmuxCapture | { error: string }> {
  if (!isValidSessionName(name)) return { error: "Invalid session name" }
  const safeLines = Math.min(2000, Math.max(10, lines || 200))
  const { stdout, stderr, code } = await runCommand("tmux", [
    "capture-pane",
    "-p",
    "-S",
    `-${safeLines}`,
    "-t",
    name,
  ])
  if (code !== 0) {
    return { error: `tmux capture failed: ${stderr.trim() || "unknown"}` }
  }
  return {
    name,
    lines: safeLines,
    capturedAt: new Date().toISOString(),
    content: stdout,
  }
}

export interface SendToTmuxArgs {
  name: string
  text?: string
  keys?: string[]
  /** Default: when text is non-empty AND no explicit keys, append Enter. */
  submit?: boolean
}

export async function sendKeysToTmux(
  args: SendToTmuxArgs
): Promise<{ ok: true; sentTextLength: number; sentKeys: string[] } | { error: string }> {
  const { name } = args
  if (!isValidSessionName(name)) return { error: "Invalid session name" }
  const text = typeof args.text === "string" ? args.text : ""
  const keys = (args.keys ?? []).filter((k) => typeof k === "string")
  const submitDefault = text.length > 0 && keys.length === 0
  const submit = args.submit === undefined ? submitDefault : !!args.submit
  if (submit && !keys.includes("Enter")) keys.push("Enter")

  if (text.length > 0) {
    const r = await runCommand(
      "tmux",
      ["send-keys", "-t", name, "-l", text],
      { timeoutMs: 5000 }
    )
    if (r.code !== 0) {
      return { error: `tmux send-keys (text) failed: ${r.stderr.trim()}` }
    }
  }
  if (keys.length > 0) {
    const r = await runCommand(
      "tmux",
      ["send-keys", "-t", name, ...keys],
      { timeoutMs: 5000 }
    )
    if (r.code !== 0) {
      return { error: `tmux send-keys (keys) failed: ${r.stderr.trim()}` }
    }
  }
  return { ok: true, sentTextLength: text.length, sentKeys: keys }
}
