/**
 * Stage → plain-English failure copy for the new-session launch path.
 *
 * The new-session route returns these strings verbatim to the client
 * (and persists them on the launch-attempt record), so they are the
 * only thing the operator reads when System Events refuses a key
 * stroke or Claude Desktop never flushes a JSONL session. They MUST
 * tell the operator (a) what specifically failed and (b) the next
 * concrete action — copy the prompt, send into an existing pane, or
 * fix the OS-level permission.
 *
 * Keep these short and surgical. They are NOT a substitute for the
 * structured `stage` field — that's what the UI switches on.
 */

import "server-only"

import type { LaunchAttemptStage } from "@/lib/operator-studio/launch-attempts"

export interface StageCopy {
  // Headline rendered above the prompt-recovery surface.
  headline: string
  // Body paragraph explaining what to do next.
  body: string
  // Suggested operator actions, in priority order. The fallback
  // panel surfaces these as buttons.
  suggestedActions: Array<
    | "copy-prompt"
    | "send-to-existing-agent"
    | "fix-accessibility-permission"
    | "arm-hot-mode"
    | "retry"
  >
}

const COPY: Record<LaunchAttemptStage, StageCopy> = {
  "hot-mode": {
    headline: "Hot mode is not armed.",
    body:
      "Lift the cover in Bento and enter the PIN to arm hot mode, then retry. Your prompt is saved here so you don't have to retype it.",
    suggestedActions: ["arm-hot-mode", "copy-prompt", "send-to-existing-agent"],
  },
  validate: {
    headline: "Launch input was rejected.",
    body:
      "The launch never reached macOS — the request body failed validation (empty prompt, oversized prompt, or unknown app kind). Your prompt is saved; copy it and try again with a smaller payload or send it into an existing pane.",
    suggestedActions: ["copy-prompt", "send-to-existing-agent"],
  },
  activate: {
    headline: "Couldn't bring the app forward.",
    body:
      "macOS refused to activate the target app. It may not be installed, or it crashed mid-launch. Your prompt is saved; open the app yourself and paste it into an existing thread, or send it into a pane that's already running.",
    suggestedActions: ["send-to-existing-agent", "copy-prompt"],
  },
  "new-session-shortcut": {
    headline: "macOS Accessibility blocked the new-thread keystroke.",
    body:
      "System Events isn't allowed to send Cmd+N to the app. Open System Settings → Privacy & Security → Accessibility and grant access to the process running this server (Node / Terminal / iTerm), then retry. Until then, send the prompt into an existing pane — that path doesn't need new-thread keystrokes.",
    suggestedActions: [
      "send-to-existing-agent",
      "fix-accessibility-permission",
      "copy-prompt",
    ],
  },
  "focus-after-activate": {
    headline: "Another app stole focus before the new thread could open.",
    body:
      "We brought the target app forward but a different window was frontmost when we re-checked, so we refused to fire Cmd+N — that keystroke would have opened a new tab in the wrong app. Close the foreground app (Spotlight, a notification, a TCC dialog) and retry, or send the prompt into an existing pane.",
    suggestedActions: [
      "send-to-existing-agent",
      "retry",
      "copy-prompt",
    ],
  },
  "focus-after-new-session": {
    headline: "Focus moved away after Cmd+N — refused to paste blind.",
    body:
      "A new thread may have opened, but a different app was frontmost when we re-verified, so we did NOT paste your prompt. Nothing was typed into the wrong app. Bring the target app forward and retry, or send the prompt into an existing pane.",
    suggestedActions: [
      "send-to-existing-agent",
      "retry",
      "copy-prompt",
    ],
  },
  "clipboard-stage": {
    headline: "Couldn't stage the prompt on the clipboard.",
    body:
      "pbcopy failed before we could paste anything — usually a transient pasteboard server issue. The new thread may already be open and empty in the app. Retry, or send the prompt into an existing pane.",
    suggestedActions: [
      "send-to-existing-agent",
      "retry",
      "copy-prompt",
    ],
  },
  paste: {
    headline: "Cmd+V was rejected — prompt did NOT land in the composer.",
    body:
      "macOS Accessibility blocked the paste keystroke. A new empty thread is sitting in the app, but your prompt is not in it. Grant Accessibility to the server process and retry, or send the prompt into an existing pane.",
    suggestedActions: [
      "send-to-existing-agent",
      "fix-accessibility-permission",
      "copy-prompt",
    ],
  },
  submit: {
    headline: "Prompt is staged — but Return didn't fire.",
    body:
      "Your prompt is in the new thread's composer (paste landed with the target app frontmost). The submit keystroke failed or focus moved before it could fire, so the prompt is sitting unsent. Bring the new thread forward and press Return, or send a fresh copy into an existing pane.",
    suggestedActions: [
      "send-to-existing-agent",
      "fix-accessibility-permission",
      "copy-prompt",
    ],
  },
  "paste-and-submit": {
    headline: "Paste or submit failed after the new thread opened.",
    body:
      "A new thread was created but the paste/return keystrokes were rejected (typically the same Accessibility permission). Fix the permission and resend, or paste manually into the new thread.",
    suggestedActions: [
      "send-to-existing-agent",
      "fix-accessibility-permission",
      "copy-prompt",
    ],
  },
  "launcher-unavailable": {
    headline: "Requested worker launcher isn't ready.",
    body:
      "We refused to start a new session because the requested launcher is missing, mismatched with the requested planner brain, or not one /agents/new-session can drive. Your prompt is saved here verbatim. Send it into an existing pane, fix the launcher (install the CLI, start the local model server, grant Accessibility), or pick a supported launcher and retry.",
    suggestedActions: ["send-to-existing-agent", "copy-prompt", "retry"],
  },
  reconcile: {
    headline: "Couldn't match the new thread to a JSONL session.",
    body:
      "The prompt was sent — the app accepted it — but no fresh JSONL session id appeared in the poll window (or several appeared and we couldn't disambiguate). Your work landed in the app; bind the existing thread you can see, or pick the new pane manually.",
    suggestedActions: ["send-to-existing-agent", "copy-prompt"],
  },
  manual: {
    headline: "Prompt stashed for manual handoff.",
    body:
      "You captured this prompt without launching. Send it into the pane of your choice when you're ready.",
    suggestedActions: ["send-to-existing-agent", "copy-prompt"],
  },
}

export function copyForStage(stage: LaunchAttemptStage): StageCopy {
  return COPY[stage] ?? COPY.manual
}
