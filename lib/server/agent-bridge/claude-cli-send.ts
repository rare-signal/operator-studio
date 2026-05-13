import "server-only"

import { spawn } from "node:child_process"

/**
 * Send a follow-up message to a Claude CLI session via `claude --resume
 * <session-id> --print <text>`, with the API-key env vars stripped so
 * the CLI uses the operator's claude.ai OAuth subscription instead of
 * pay-per-token API billing.
 *
 * Replaces the AX-driven clipboard+paste path (`sendToApp`) for any
 * agent whose binding carries `surface = 'claude-cli'`. Same idempotent
 * append semantics — the CLI writes the user turn AND the assistant
 * response to the existing session JSONL. The cockpit's existing JSONL
 * poll renders the new turns within ~4s of completion.
 *
 * Why this exists: AX-driven sends to Claude Code Desktop were the
 * dominant source of pain in remote-from-MBA operation (Universal
 * Clipboard collisions, AX-sleepy timeouts, focus race, "launch/v1-init
 * picker state" failures). CLI sends are pure programmatic stdin/stdout
 * — no GUI to compete with, no focus to lose, no clipboard to fight.
 *
 * Doctrine: plan card `step-cli-subscription-bound-default`. CLI is the
 * first-class send path; Desktop adapter is the emergency fallback.
 */
export interface SendToClaudeCliArgs {
  sessionId: string
  text: string
  /** Per-call timeout in ms. The default 5 min matches the spawn-script
   *  pattern; tighten for chat-back where you'd rather time out fast
   *  than have the operator wait on a hung resume. */
  timeoutMs?: number
}

export type SendToClaudeCliResult =
  | {
      ok: true
      sessionId: string
      sentTextLength: number
      durationMs: number
      stdoutTail: string
    }
  | {
      ok: false
      sessionId: string
      stage: "validate" | "subprocess-launch" | "subprocess-exit" | "timeout"
      error: string
      status: number
      stderr?: string
    }

const DEFAULT_TIMEOUT_MS = 5 * 60_000

export async function sendToClaudeCli(
  args: SendToClaudeCliArgs
): Promise<SendToClaudeCliResult> {
  const text = typeof args.text === "string" ? args.text : ""
  if (text.trim().length === 0) {
    return {
      ok: false,
      sessionId: args.sessionId,
      stage: "validate",
      error: "Empty text",
      status: 400,
    }
  }
  if (!/^[a-f0-9-]{32,}$/i.test(args.sessionId)) {
    return {
      ok: false,
      sessionId: args.sessionId,
      stage: "validate",
      error: "Invalid session id format",
      status: 400,
    }
  }

  // Strip env vars that force API-key billing — same pattern as the
  // claude-cli surface adapter for spawn. Without this, every chat-send
  // hits the pay-per-token API instead of the operator's subscription.
  const childEnv: NodeJS.ProcessEnv = { ...process.env }
  delete childEnv.ANTHROPIC_API_KEY
  delete childEnv.ANTHROPIC_BASE_URL
  delete childEnv.ANTHROPIC_AUTH_TOKEN
  delete childEnv.ANTHROPIC_BEDROCK_BASE_URL
  delete childEnv.ANTHROPIC_VERTEX_PROJECT_ID

  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const startedAt = Date.now()

  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    const child = spawn(
      "claude",
      [
        "--resume",
        args.sessionId,
        "--print",
        "--dangerously-skip-permissions",
        text,
      ],
      {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
      }
    )
    child.stdout.on("data", (d) => {
      stdout += d.toString()
    })
    child.stderr.on("data", (d) => {
      stderr += d.toString()
    })
    const t = setTimeout(() => {
      child.kill("SIGTERM")
      resolve({
        ok: false,
        sessionId: args.sessionId,
        stage: "timeout",
        error: `claude --resume exceeded ${timeoutMs}ms`,
        status: 504,
        stderr: stderr.slice(-500),
      })
    }, timeoutMs)
    child.on("exit", (code) => {
      clearTimeout(t)
      const durationMs = Date.now() - startedAt
      if (code === 0) {
        resolve({
          ok: true,
          sessionId: args.sessionId,
          sentTextLength: text.length,
          durationMs,
          stdoutTail: stdout.slice(-2000),
        })
      } else {
        resolve({
          ok: false,
          sessionId: args.sessionId,
          stage: "subprocess-exit",
          error: `claude --resume exited with code=${code}`,
          status: 500,
          stderr: stderr.slice(-500),
        })
      }
    })
    child.on("error", (e) => {
      clearTimeout(t)
      resolve({
        ok: false,
        sessionId: args.sessionId,
        stage: "subprocess-launch",
        error: e.message,
        status: 500,
      })
    })
  })
}
