/**
 * Pre-flight: bring a *specific* Claude Code Desktop session to the
 * front via Claude Desktop's `claude://` URL handler. Replaces the
 * earlier `app-session-focus.ts` chat-picker dance — that path required
 * a keyboard shortcut Claude Desktop doesn't actually expose, so it
 * was disabled by default and the send route degenerated to "paste
 * into whatever chat is frontmost", causing cross-thread routing bugs
 * in 50/50 split views.
 *
 * Discovery (2026-05-09): Claude.app's main process registers a
 * `claude://` URL scheme. Inside `app.asar`, claudeURLHandler dispatches
 * on `t.host`. `resume` is itself a host value — NOT a path under
 * `claude.ai` — and takes a `session=<uuid>` query param:
 *
 *     claude://resume?session=<uuid>
 *
 * (The earlier `claude://claude.ai/resume?...` reading of the handler
 * was wrong — verified empirically: the correct URL produces a
 * `Resume deep link: importing CLI session <uuid>` info log entry in
 * `~/Library/Logs/Claude/main.log`; the wrong URL produces nothing.)
 *
 * The handler calls LocalSessionManager.importCliSession(<uuid>) and
 * dispatches `setFocusedSession`. importCliSession is idempotent — if
 * the session is already imported, it unarchives and returns the
 * existing internal id. Result: clicking that URL focuses the right
 * session in the visible UI without creating dupes.
 *
 * For Codex Desktop the equivalent path is not yet known; for now this
 * helper only handles `claude` agents and falls through silently for
 * anything else (sendToApp will use its existing frontmost-window
 * behavior, same as before).
 */

import "server-only"

import { runCommand } from "./exec"

const SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface DeepLinkFocusArgs {
  /** Source app kind. Currently only "claude" is supported via deep
   *  link; other kinds short-circuit with `{ ok: true, skipped: true }`. */
  kind: "claude" | "codex" | string
  /** CLI session UUID (the `ref` portion of a composite agent id). */
  sessionId: string
}

export type DeepLinkFocusResult =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { error: string; status: number }

/** Window for Claude Desktop to import + render the session before paste
 *  fires. Tuned conservatively: importCliSession reads the JSONL and
 *  hydrates state; the renderer needs a beat after dispatchNavigate to
 *  mount the session view and focus its composer. Override via
 *  OPERATOR_STUDIO_CLAUDE_DEEPLINK_SETTLE_MS. */
const DEFAULT_SETTLE_MS = 900

export async function focusByDeepLink(
  args: DeepLinkFocusArgs
): Promise<DeepLinkFocusResult> {
  if (process.env.OPERATOR_STUDIO_DEEPLINK_FOCUS_DISABLED?.trim() === "1") {
    return { ok: true, skipped: true, reason: "deeplink focus disabled" }
  }
  if (args.kind !== "claude") {
    return {
      ok: true,
      skipped: true,
      reason: `no deep-link handler known for kind=${args.kind}`,
    }
  }
  if (!SESSION_UUID_RE.test(args.sessionId)) {
    return {
      error: `invalid session UUID: ${args.sessionId}`,
      status: 400,
    }
  }

  const url = `claude://resume?session=${encodeURIComponent(args.sessionId)}`
  // `open <url>` triggers the registered protocol handler. We don't pass
  // -a so Claude is selected by URL scheme registration, not by name —
  // matches macOS conventions and survives app rename.
  const opened = await runCommand("open", [url], { timeoutMs: 3000 })
  if (opened.code !== 0) {
    return {
      error: `open ${url} failed: ${opened.stderr.trim() || "unknown"}`,
      status: 500,
    }
  }

  const settleMs = (() => {
    const raw = process.env.OPERATOR_STUDIO_CLAUDE_DEEPLINK_SETTLE_MS
    const n = raw ? Number.parseInt(raw, 10) : NaN
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SETTLE_MS
  })()
  await new Promise((r) => setTimeout(r, settleMs))

  return { ok: true }
}
