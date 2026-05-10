/**
 * Create a brand-new Claude / Codex Desktop session, paste a prompt,
 * submit, then reconcile the new JSONL session id back into Operator
 * Studio's agent surface.
 *
 * This is the "new thread" sibling of `sendToApp` — same clipboard +
 * AppleScript family, but with a pre-send "new chat" shortcut and a
 * post-send poll against `listAppSessions` to discover the freshly-
 * created `claude:<id>` / `codex:<id>`.
 *
 * Failure is explicit and structured so the caller can decide whether
 * to retry, escalate to the user, or fall through to a different
 * launch lane (e.g. tmux). We never invent a session id — if no new
 * id appears within the poll window, we return `reconciled: false`
 * with the candidate set we observed.
 */

import "server-only"

import { runCommand } from "./exec"
import { isValidAppName } from "./exec"
import { listAppSessions, type AppSlug } from "./app-sessions"
import { sendToApp, setClaudeBypassPermissionMode } from "./app-control"
import type { AgentCompositeId } from "./types"

export interface NewSessionAdapter {
  /** macOS app name passed to AppleScript `tell application "..."`. */
  appName: string
  /** Keystroke for "new chat / new conversation". Claude Desktop and
   *  Codex Desktop both ship Cmd+N at present. Adapter-scoped so we
   *  can adjust per-app without touching call sites. */
  newSessionShortcut: { key: string; modifiers: Array<"command" | "shift" | "option" | "control"> }
  /** Milliseconds to wait after the new-session shortcut before
   *  pasting. Empirically 600ms covers Claude Desktop's window
   *  transition without flake. */
  postShortcutDelayMs: number
}

const ADAPTERS: Record<AppSlug, NewSessionAdapter> = {
  claude: {
    appName: "Claude",
    newSessionShortcut: { key: "n", modifiers: ["command"] },
    postShortcutDelayMs: 600,
  },
  codex: {
    appName: "Codex",
    newSessionShortcut: { key: "n", modifiers: ["command"] },
    postShortcutDelayMs: 600,
  },
}

export interface CreateNewAppSessionArgs {
  appKind: AppSlug
  prompt: string
  /** Optional override of the macOS app name (e.g. "Claude" vs a
   *  side-channel build name). Validated as a regular app name. */
  appName?: string
  /** Default true. When false the prompt is pasted but not submitted —
   *  useful for "stage and let me eyeball it" launches. */
  submit?: boolean
  /** Override poll budget. Defaults to 12s with 750ms ticks; Claude
   *  Desktop usually flushes the JSONL within 2–4s of first user turn. */
  reconcileBudgetMs?: number
  reconcileIntervalMs?: number
}

export interface NewSessionEvidence {
  preSnapshotIds: string[]
  postSnapshotIds: string[]
  candidateIds: string[]
  pickedId: string | null
  ambiguous: boolean
  pollDurationMs: number
}

export type CreateNewAppSessionResult =
  | {
      ok: true
      reconciled: true
      appKind: AppSlug
      agentId: AgentCompositeId
      launchedAt: string
      promptPreview: string
      submitted: boolean
      evidence: NewSessionEvidence
    }
  | {
      ok: true
      reconciled: false
      appKind: AppSlug
      agentId: null
      launchedAt: string
      promptPreview: string
      submitted: boolean
      reason:
        | "no-new-session-found"
        | "multiple-candidates"
      evidence: NewSessionEvidence
    }
  | {
      ok: false
      appKind: AppSlug
      stage:
        | "validate"
        | "activate"
        | "new-session-shortcut"
        | "paste-and-submit"
      error: string
      status: number
    }

const PROMPT_BYTE_CAP = 256_000

function modifierClause(
  mods: NewSessionAdapter["newSessionShortcut"]["modifiers"]
): string {
  if (mods.length === 0) return ""
  const tokens = mods.map((m) => `${m} down`).join(", ")
  return ` using {${tokens}}`
}

async function fireShortcut(
  shortcut: NewSessionAdapter["newSessionShortcut"]
): Promise<{ ok: true } | { error: string; status: number }> {
  const script = `tell application "System Events" to keystroke "${shortcut.key}"${modifierClause(
    shortcut.modifiers
  )}`
  const r = await runCommand("osascript", ["-e", script], { timeoutMs: 3000 })
  if (r.code !== 0) {
    return {
      error: `new-session shortcut failed: ${
        r.stderr.trim() || "unknown"
      } — Accessibility permission needed.`,
      status: 500,
    }
  }
  return { ok: true }
}

async function activateApp(
  app: string
): Promise<{ ok: true } | { error: string; status: number }> {
  const r = await runCommand(
    "osascript",
    [
      "-e",
      `tell application "${app}" to activate`,
      "-e",
      `tell application "System Events" to set frontmost of (first process whose name is "${app}") to true`,
    ],
    { timeoutMs: 3000 }
  )
  if (r.code !== 0) {
    return {
      error: `activate failed: ${r.stderr.trim() || "unknown"} — is "${app}" installed?`,
      status: 500,
    }
  }
  return { ok: true }
}

async function snapshotIds(app: AppSlug, limit = 60): Promise<{
  ids: string[]
  byId: Map<string, number>
}> {
  const sessions = await listAppSessions(app, limit)
  const byId = new Map<string, number>()
  for (const s of sessions) byId.set(s.id, s.mtimeMs)
  return { ids: sessions.map((s) => s.id), byId }
}

export async function createNewAppSessionAndSend(
  args: CreateNewAppSessionArgs
): Promise<CreateNewAppSessionResult> {
  const adapter = ADAPTERS[args.appKind]
  if (!adapter) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "validate",
      error: `Unknown appKind: ${args.appKind}`,
      status: 400,
    }
  }
  const appName = args.appName ?? adapter.appName
  if (!isValidAppName(appName)) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "validate",
      error: "Invalid app name",
      status: 400,
    }
  }
  const prompt = typeof args.prompt === "string" ? args.prompt : ""
  if (prompt.trim().length === 0) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "validate",
      error: "Prompt is required for new-session creation",
      status: 400,
    }
  }
  if (Buffer.byteLength(prompt, "utf8") > PROMPT_BYTE_CAP) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "validate",
      error: `Prompt exceeds ${PROMPT_BYTE_CAP} bytes`,
      status: 413,
    }
  }
  const submit = args.submit === undefined ? true : !!args.submit

  // Snapshot pre-launch so we can identify the new file by set diff.
  // listAppSessions stat-walks the whole projects/ tree; cap at 60 to
  // keep the round-trip cheap.
  const before = await snapshotIds(args.appKind, 60)

  const launchedAt = new Date().toISOString()
  const launchedAtMs = Date.now()

  const activated = await activateApp(appName)
  if ("error" in activated) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "activate",
      error: activated.error,
      status: activated.status,
    }
  }
  // Same focus-settle window sendToApp uses; otherwise the Cmd+N can
  // race the address bar of whatever browser tab fired this request.
  await new Promise((r) => setTimeout(r, 500))

  const shortcut = await fireShortcut(adapter.newSessionShortcut)
  if ("error" in shortcut) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "new-session-shortcut",
      error: shortcut.error,
      status: shortcut.status,
    }
  }
  await new Promise((r) => setTimeout(r, adapter.postShortcutDelayMs))

  // Switch the FRESHLY-OPENED new chat to bypass-permissions mode
  // BEFORE pasting the prompt. This must happen AFTER Cmd+N (so the
  // keystroke targets the new chat, not the previously-shown one) and
  // BEFORE the paste (so the worker's first action sees bypass).
  //
  // Earlier attempts placed this BEFORE Cmd+N, relying on bypass
  // propagating from one chat to all subsequent new chats in the app
  // session. That works only when the user hasn't reset Claude's
  // default mode for new threads. With the default reset to ask-
  // permissions (the more common case for fresh app launches), the
  // new chat ignores the previous chat's mode and starts at ask.
  //
  // Picker handling lives in setClaudeBypassPermissionMode — generous
  // delays + Up x 5 (defensive ceiling-clamp) + Down x 4 to land on
  // Bypass + Enter to confirm. ~3.5s total.
  //
  // Codex skipped (no equivalent picker). Failure is non-fatal —
  // worker still spawns at default permission level if anything goes
  // wrong; David babysits prompts in that case.
  //
  // Set OPERATOR_STUDIO_AUTO_BYPASS=0 to disable.
  if (
    args.appKind === "claude" &&
    process.env.OPERATOR_STUDIO_AUTO_BYPASS !== "0"
  ) {
    const bypass = await setClaudeBypassPermissionMode()
    if (!bypass.ok) {
      console.warn(
        `[app-new-session] bypass-mode toggle failed: ${bypass.error}`
      )
    }
  }

  // Reuse sendToApp for the paste + submit dance. The app is already
  // frontmost and on a fresh chat (now with bypass-permissions mode
  // set explicitly when enabled), so re-activating is harmless and
  // helps restore focus to the chat input after the picker dismissed.
  const sent = await sendToApp({
    app: appName,
    text: prompt,
    submit,
  })
  if ("error" in sent) {
    return {
      ok: false,
      appKind: args.appKind,
      stage: "paste-and-submit",
      error: sent.error,
      status: sent.status,
    }
  }

  const promptPreview = prompt.slice(0, 200)
  const budgetMs = Math.max(1000, args.reconcileBudgetMs ?? 12_000)
  const intervalMs = Math.max(200, args.reconcileIntervalMs ?? 750)
  const pollStart = Date.now()
  let candidates: string[] = []
  let pickedId: string | null = null
  let postIds: string[] = before.ids

  while (Date.now() - pollStart < budgetMs) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const after = await snapshotIds(args.appKind, 60)
    postIds = after.ids
    candidates = []
    for (const id of after.ids) {
      const wasPresent = before.byId.has(id)
      const mtime = after.byId.get(id) ?? 0
      // New file id, OR a file whose mtime advanced past launch and
      // wasn't in the pre-snapshot top window. Codex sometimes lands a
      // rollout file that wasn't in the top 60 a moment ago.
      if (!wasPresent && mtime >= launchedAtMs - 1000) {
        candidates.push(id)
      }
    }
    if (candidates.length === 1) {
      pickedId = candidates[0]
      break
    }
    if (candidates.length > 1) {
      // Multiple candidates — pick the most-recent and keep polling
      // briefly to see if it stabilizes. If we exit the loop with
      // multiple, we report ambiguous below.
      pickedId = candidates[0]
    }
  }

  const evidence: NewSessionEvidence = {
    preSnapshotIds: before.ids,
    postSnapshotIds: postIds,
    candidateIds: candidates,
    pickedId,
    ambiguous: candidates.length > 1,
    pollDurationMs: Date.now() - pollStart,
  }

  if (pickedId && candidates.length === 1) {
    return {
      ok: true,
      reconciled: true,
      appKind: args.appKind,
      agentId: `${args.appKind}:${pickedId}` as AgentCompositeId,
      launchedAt,
      promptPreview,
      submitted: sent.submitted,
      evidence,
    }
  }

  return {
    ok: true,
    reconciled: false,
    appKind: args.appKind,
    agentId: null,
    launchedAt,
    promptPreview,
    submitted: sent.submitted,
    reason: candidates.length > 1 ? "multiple-candidates" : "no-new-session-found",
    evidence,
  }
}
