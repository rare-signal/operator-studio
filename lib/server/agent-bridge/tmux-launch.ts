/**
 * Fresh tmux worker launch primitive.
 *
 * Creates a new detached tmux session, boots Claude inside it (via a
 * shell command that survives the v18/v22 nvm trap on this box), and
 * sends the approved prompt as the first message.
 *
 * Two-phase send: we use `send-keys -l` for the prompt body so it is
 * passed literally (no shell expansion, no metacharacter risk), then
 * a separate `send-keys Enter` to submit. The launch command itself
 * goes through `-l` followed by `Enter` for the same reason.
 *
 * The launch command template is configurable via
 * `OPERATOR_STUDIO_CLAUDE_LAUNCH_CMD` so we don't hardcode one
 * fragile shell invocation. Default sources nvm and runs claude under
 * node 22 — claude's shebang re-resolves node via env, so the v18
 * install path keeps working as long as a v22 node is in PATH.
 */

import "server-only"

import { isValidSessionName, runCommand } from "./exec"

const DEFAULT_CLAUDE_LAUNCH_CMD =
  "source ~/.nvm/nvm.sh >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1 && claude"

export function defaultClaudeLaunchCommand(): string {
  const env = process.env.OPERATOR_STUDIO_CLAUDE_LAUNCH_CMD?.trim()
  return env && env.length > 0 ? env : DEFAULT_CLAUDE_LAUNCH_CMD
}

/** Conservative cwd validator. We don't want to support shell
 *  metacharacters or whitespace in launch paths — operators can pass
 *  an absolute filesystem path with the usual filename charset. */
export function isValidCwd(cwd: string): boolean {
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > 512) {
    return false
  }
  if (!cwd.startsWith("/")) return false
  // No shell metacharacters; allow letters, digits, and a small set
  // of safe punctuation including spaces are NOT allowed because
  // tmux -c forwards the path through its own parser.
  return /^[A-Za-z0-9_./\-]+$/.test(cwd)
}

/** Build a deterministic tmux session name for an executive
 *  recommendation. Output is always `exec-<12-char-id>` and matches
 *  isValidSessionName. */
export function deriveLaunchSessionName(recommendationId: string): string {
  const hexish = recommendationId.replace(/[^A-Za-z0-9]/g, "")
  const suffix = hexish.slice(0, 12) || "anon"
  return `exec-${suffix}`
}

export interface CreateTmuxSessionArgs {
  name: string
  cwd?: string | null
}

export interface CreateTmuxSessionResult {
  ok: true
  name: string
  /** True if we created a brand-new session, false if the named
   *  session already existed (caller decided to reuse). */
  created: boolean
}

async function tmuxSessionExists(name: string): Promise<boolean> {
  const r = await runCommand("tmux", ["has-session", "-t", name], {
    timeoutMs: 3000,
  })
  return r.code === 0
}

/**
 * Create a detached tmux session. Returns { created: false } if a
 * session with the same name already exists — caller chooses whether
 * to reuse or surface an error.
 */
export async function createTmuxSession(
  args: CreateTmuxSessionArgs
): Promise<CreateTmuxSessionResult | { error: string }> {
  const { name } = args
  if (!isValidSessionName(name)) {
    return { error: `Invalid tmux session name: ${name}` }
  }
  const cwd = args.cwd?.trim() || ""
  if (cwd && !isValidCwd(cwd)) {
    return { error: `Invalid cwd: ${cwd}` }
  }

  if (await tmuxSessionExists(name)) {
    return { ok: true, name, created: false }
  }

  const argv = ["new-session", "-d", "-s", name]
  if (cwd) argv.push("-c", cwd)
  const r = await runCommand("tmux", argv, { timeoutMs: 5000 })
  if (r.code !== 0) {
    return {
      error: `tmux new-session failed: ${r.stderr.trim() || r.stdout.trim() || "unknown"}`,
    }
  }
  return { ok: true, name, created: true }
}

export interface LaunchClaudeWorkerArgs {
  /** Recommendation id used for deterministic session naming + audit. */
  recommendationId: string
  /** Working directory for the new session. Optional; tmux inherits
   *  the server's cwd otherwise. */
  cwd?: string | null
  /** The prompt that will be sent into claude's first input. */
  prompt: string
  /** Override the launch command template. Defaults to
   *  `defaultClaudeLaunchCommand()`. */
  launchCommand?: string | null
  /** Milliseconds to wait between starting claude and sending the
   *  prompt. Claude's interactive UI takes a couple of seconds to
   *  attach stdin. Defaults to 4500ms. */
  promptDelayMs?: number
  /** Reuse-vs-collide policy. `error` (default) refuses to launch if
   *  the session already exists. `reuse` sends the launch command +
   *  prompt into the existing session anyway. */
  collisionPolicy?: "error" | "reuse"
}

export interface LaunchClaudeWorkerResult {
  ok: true
  sessionName: string
  /** Composite agent id, e.g. `tmux:exec-abc123`. Lines up with the
   *  format used by /api/operator-studio/agents and Bento. */
  agentId: `tmux:${string}`
  cwd: string | null
  launchCommand: string
  /** The portion of the prompt that was sent. Captured for audit. */
  promptPreview: string
  launchedAt: string
}

const PROMPT_PREVIEW_CHARS = 200
const CLAUDE_READY_RE = /Claude Code v\d|\bWelcome back!\b|Try "write a test for/
const SHELL_FAILURE_RE =
  /(zsh|bash|sh):\s*(command not found|exec format error)|Credit balance too low|Add funds/i

async function capturePaneTail(sessionName: string): Promise<string> {
  const r = await runCommand(
    "tmux",
    ["capture-pane", "-pt", sessionName, "-S", "-80"],
    { timeoutMs: 5000 }
  )
  return `${r.stdout}\n${r.stderr}`.trim()
}

function summarizePane(text: string): string {
  return text
    .split(/\r?\n/)
    .slice(-18)
    .join("\n")
    .trim()
    .slice(-2000)
}

async function pasteTextIntoTmux(
  sessionName: string,
  text: string,
  timeoutMs: number
): Promise<{ ok: true } | { error: string }> {
  const load = await runCommand("tmux", ["load-buffer", "-"], {
    input: text,
    timeoutMs,
  })
  if (load.code !== 0) {
    return {
      error: `tmux load-buffer failed: ${load.stderr.trim() || load.stdout.trim() || "unknown"}`,
    }
  }
  const paste = await runCommand("tmux", ["paste-buffer", "-t", sessionName], {
    timeoutMs,
  })
  if (paste.code !== 0) {
    return {
      error: `tmux paste-buffer failed: ${paste.stderr.trim() || paste.stdout.trim() || "unknown"}`,
    }
  }
  return { ok: true }
}

export async function launchClaudeWorker(
  args: LaunchClaudeWorkerArgs
): Promise<LaunchClaudeWorkerResult | { error: string }> {
  const { recommendationId } = args
  if (typeof recommendationId !== "string" || recommendationId.length === 0) {
    return { error: "recommendationId required" }
  }
  const prompt = typeof args.prompt === "string" ? args.prompt : ""
  if (prompt.trim().length === 0) {
    return { error: "prompt is empty — refusing to launch a blank worker" }
  }

  const sessionName = deriveLaunchSessionName(recommendationId)
  if (!isValidSessionName(sessionName)) {
    return { error: `Derived session name invalid: ${sessionName}` }
  }

  const launchCommand =
    args.launchCommand?.trim() || defaultClaudeLaunchCommand()
  if (launchCommand.length === 0 || launchCommand.length > 2000) {
    return { error: "launch command must be 1..2000 chars" }
  }

  const cwd = args.cwd?.trim() || null
  if (cwd && !isValidCwd(cwd)) {
    return { error: `Invalid cwd: ${cwd}` }
  }

  const policy = args.collisionPolicy ?? "error"
  const created = await createTmuxSession({ name: sessionName, cwd })
  if ("error" in created) return { error: created.error }
  if (!created.created && policy === "error") {
    return {
      error: `tmux session ${sessionName} already exists. Pick collisionPolicy=reuse to send into it anyway.`,
    }
  }

  // Step 1 — kick off claude inside the session.
  const sendLaunchText = await runCommand(
    "tmux",
    ["send-keys", "-t", sessionName, "-l", launchCommand],
    { timeoutMs: 5000 }
  )
  if (sendLaunchText.code !== 0) {
    return {
      error: `tmux send-keys (launch text) failed: ${sendLaunchText.stderr.trim()}`,
    }
  }
  const sendLaunchEnter = await runCommand(
    "tmux",
    ["send-keys", "-t", sessionName, "Enter"],
    { timeoutMs: 5000 }
  )
  if (sendLaunchEnter.code !== 0) {
    return {
      error: `tmux send-keys (launch enter) failed: ${sendLaunchEnter.stderr.trim()}`,
    }
  }

  // Step 2 — wait for claude to attach stdin, then send the prompt.
  const delay = Math.max(
    500,
    Math.min(20_000, args.promptDelayMs ?? 4500)
  )
  await new Promise<void>((resolve) => setTimeout(resolve, delay))

  const beforePrompt = await capturePaneTail(sessionName)
  if (SHELL_FAILURE_RE.test(beforePrompt)) {
    return {
      error: `Claude launch failed before prompt was sent. Pane tail:\n${summarizePane(beforePrompt)}`,
    }
  }
  if (!CLAUDE_READY_RE.test(beforePrompt)) {
    return {
      error: `Claude did not appear ready before prompt send. Refusing to paste into an unknown tmux pane. Pane tail:\n${summarizePane(beforePrompt)}`,
    }
  }

  const sendPromptText = await pasteTextIntoTmux(sessionName, prompt, 10_000)
  if ("error" in sendPromptText) return sendPromptText

  const sendPromptEnter = await runCommand(
    "tmux",
    ["send-keys", "-t", sessionName, "Enter"],
    { timeoutMs: 5000 }
  )
  if (sendPromptEnter.code !== 0) {
    return {
      error: `tmux send-keys (prompt enter) failed: ${sendPromptEnter.stderr.trim()}`,
    }
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 1500))
  const afterPrompt = await capturePaneTail(sessionName)
  if (SHELL_FAILURE_RE.test(afterPrompt)) {
    return {
      error: `Claude launch did not produce a usable worker after prompt submit. Pane tail:\n${summarizePane(afterPrompt)}`,
    }
  }

  return {
    ok: true,
    sessionName,
    agentId: `tmux:${sessionName}`,
    cwd,
    launchCommand,
    promptPreview:
      prompt.length > PROMPT_PREVIEW_CHARS
        ? `${prompt.slice(0, PROMPT_PREVIEW_CHARS)}…`
        : prompt,
    launchedAt: new Date().toISOString(),
  }
}
