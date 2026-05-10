/**
 * Pre-flight: bring a *specific* Claude Code Desktop / Codex Desktop
 * session to the front before the existing AppleScript paste pipeline
 * fires. Without this, the send route is structurally a "paste into
 * whatever window is frontmost" — phone-only / AFK operation breaks
 * because the wrong chat receives the paste.
 *
 * Path through the existing implementation:
 *   1. activate the target app
 *   2. open its chat picker (default Cmd+K; per-app overridable via env)
 *   3. type the session title to filter the picker
 *   4. press Return to select the first match
 *   5. small wait for the chat input to settle
 *
 * Why GUI scripting and not a URL scheme: per
 * `lib/operator-studio/source-deeplinks.ts:69-75`, neither Claude Code
 * Desktop nor Codex Desktop expose a per-session URL scheme that
 * resumes a local session by UUID. GUI scripting is the only path
 * through the existing implementation.
 *
 * Why CLI is not used: the user runs Desktop apps exclusively for
 * Claude Code and Codex (memory: project_no_clis_only_desktop). CLI
 * subprocess (`claude --resume <id>`) is not an option.
 */

import "server-only"

import { runCommand } from "./exec"

const DEFAULT_PICKER_KEY = "k"

function pickerKeyFor(app: string): string {
  if (app === "Claude") {
    return process.env.OPERATOR_STUDIO_CLAUDE_PICKER_KEY?.trim() || DEFAULT_PICKER_KEY
  }
  if (app === "Codex") {
    return process.env.OPERATOR_STUDIO_CODEX_PICKER_KEY?.trim() || DEFAULT_PICKER_KEY
  }
  return DEFAULT_PICKER_KEY
}

// Per-app override for "skip the GUI nav entirely" — useful if the app
// has no chat picker at all and the caller is OK with frontmost-window
// behavior. Set OPERATOR_STUDIO_<APP>_SKIP_FOCUS=1 to opt out.
function focusEnabled(app: string): boolean {
  if (process.env.OPERATOR_STUDIO_SKIP_SESSION_FOCUS?.trim() === "1") return false
  if (app === "Claude" && process.env.OPERATOR_STUDIO_CLAUDE_SKIP_FOCUS?.trim() === "1")
    return false
  if (app === "Codex" && process.env.OPERATOR_STUDIO_CODEX_SKIP_FOCUS?.trim() === "1")
    return false
  return true
}

export interface FocusSessionArgs {
  app: string
  /** The Desktop app's chat-picker title text. Truncated to ~60 chars
   *  and cleaned of double quotes / backslashes before AppleScript
   *  keystroke injection. */
  sessionTitle: string
}

export type FocusSessionResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { error: string; status: number }

export async function focusDesktopSession(
  args: FocusSessionArgs
): Promise<FocusSessionResult> {
  const { app } = args
  if (!focusEnabled(app)) {
    return { ok: true, skipped: true, reason: `focus disabled for ${app}` }
  }
  const safeTitle = args.sessionTitle
    .slice(0, 60)
    .replace(/[\\"]/g, "")
    .trim()
  if (safeTitle.length === 0) {
    return {
      error: "Session title is empty — can't filter chat picker. Pass sessionTitle in the send body or set OPERATOR_STUDIO_SKIP_SESSION_FOCUS=1.",
      status: 400,
    }
  }

  // 1. Activate app + force frontmost (mirror of sendToApp's pattern).
  const activate = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "${app}" to activate`,
      "-e",
      `tell application "System Events" to set frontmost of (first process whose name is "${app}") to true`,
    ],
    { timeoutMs: 3000 }
  )
  if (activate.code !== 0) {
    return {
      error: `activate ${app} failed: ${activate.stderr.trim() || "unknown"} — is ${app} installed?`,
      status: 500,
    }
  }
  await new Promise((r) => setTimeout(r, 500))

  // 2. Open chat picker.
  const pickerKey = pickerKeyFor(app)
  const openPicker = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "System Events" to keystroke "${pickerKey}" using {command down}`,
    ],
    { timeoutMs: 3000 }
  )
  if (openPicker.code !== 0) {
    return {
      error: `open chat picker (Cmd+${pickerKey.toUpperCase()}) failed: ${openPicker.stderr.trim() || "unknown"} — set OPERATOR_STUDIO_${app.toUpperCase()}_PICKER_KEY if the app uses a different shortcut.`,
      status: 500,
    }
  }
  await new Promise((r) => setTimeout(r, 350))

  // 3. Type the title to filter the picker. Cleared by the picker on
  //    open — it's the standard cmd-palette pattern.
  const type = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "System Events" to keystroke "${safeTitle}"`,
    ],
    { timeoutMs: 5000 }
  )
  if (type.code !== 0) {
    return {
      error: `type session title failed: ${type.stderr.trim() || "unknown"}`,
      status: 500,
    }
  }
  await new Promise((r) => setTimeout(r, 400))

  // 4. Press Return — selects the first (best) match.
  const select = await runCommand(
    "osascript",
    ["-e", `tell application "System Events" to keystroke return`],
    { timeoutMs: 3000 }
  )
  if (select.code !== 0) {
    return {
      error: `select chat (Return) failed: ${select.stderr.trim() || "unknown"}`,
      status: 500,
    }
  }
  // 5. Wait for the chat input to settle before paste fires.
  await new Promise((r) => setTimeout(r, 600))

  return { ok: true }
}
