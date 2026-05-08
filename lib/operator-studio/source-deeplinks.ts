import type { OperatorSourceApp, OperatorThread } from "./types"

/**
 * Source-app deep links — "click here to open the conversation back
 * in the app it came from." Modeled after the AIDA Observatory
 * implementation (see `observatory_ingest.py` for the Python flavor):
 * a small registry of per-source URL templates with a sensible
 * fallback chain, plus a `command` variant for CLIs that don't
 * register a URL scheme.
 *
 * Two link levels:
 *   - **Thread** — opens the whole conversation.
 *   - **Message** — opens at a specific turn. Only works for sources
 *     that expose per-turn anchors (today: Codex, when message
 *     metadata carries a `codex_turn_id` populated at ingest).
 */

export type SourceDeepLink =
  | {
      kind: "url"
      url: string
      label: string
      sourceApp: OperatorSourceApp
    }
  | {
      kind: "command"
      command: string
      label: string
      /** One-line operator-facing hint shown in toast / tooltip. */
      hint: string
      /** Best-guess project the command should run in, if known. */
      projectKey?: string
      sourceApp: OperatorSourceApp
    }

// Codex registers itself as the handler for the `codex://` URL
// scheme. AIDA Observatory uses `codex://threads/{id}` as the thread
// fallback shape; mirroring that here keeps both projects in sync.
//
// There is intentionally no per-turn template: Codex doesn't expose a
// "deep link to a specific turn" affordance, and pretending we can
// just produced a link that opened the thread at its tail (same as
// the thread-level link). See `getMessageDeepLink` below.
const CODEX_THREAD_TEMPLATE = "codex://threads/{thread_id}"

export function getThreadDeepLink(
  thread: OperatorThread
): SourceDeepLink | null {
  const app = thread.sourceApp

  if (app === "codex") {
    const threadId =
      thread.sourceThreadKey?.trim() ||
      extractGenericIdFromLocator(thread.sourceLocator) ||
      stripThreadPrefix(thread.id)
    if (!threadId) return null
    return {
      kind: "url",
      url: CODEX_THREAD_TEMPLATE.replace(
        "{thread_id}",
        encodeURIComponent(threadId)
      ),
      label: "Open in Codex",
      sourceApp: app,
    }
  }

  if (app === "claude" || app === "claude-code") {
    // Claude Code is a CLI; there's no URL scheme that resumes an
    // existing local session by UUID. (Tried `claude://claude.ai/chat/
    // <session-id>` — that scheme expects claude.ai conversation IDs,
    // not local Claude Code session UUIDs, and 404s on ours.) The best
    // we can do is hand the operator a resume command and a hint about
    // which project's terminal to run it in.
    //
    // Multiple fallback paths because different import flavors set
    // different fields:
    //   1. sourceLocator → JSONL path (the canonical case).
    //   2. sourceThreadKey → some imports store a base64 of the same
    //      path under this key with a `claude-` prefix.
    //   3. thread.id → some forks/legacy rows lack both above; the
    //      ingest sometimes adopts the session uuid as the thread id.
    const parsed =
      parseClaudeJsonlLocator(thread.sourceLocator) ??
      parseClaudeJsonlLocator(decodeClaudeThreadKey(thread.sourceThreadKey)) ??
      claudeFallbackFromId(thread.id)
    if (!parsed) return null
    return {
      kind: "url",
      url: `claude://code/${encodeURIComponent(parsed.sessionId)}`,
      label: "Open in Claude Code",
      sourceApp: app,
    }
  }

  if (app === "opencode") {
    // OpenCode is CLI-first; no registered URL scheme today (the
    // desktop app at `ai.opencode.desktop` spawns the CLI under the
    // hood). The CLI accepts `opencode --session <id>` to resume — we
    // surface that as a `command` deep link with the same shape we use
    // for Claude Code. The session id is namespaced as `opencode-<id>`
    // in our schema; strip the prefix when handing to the CLI.
    const raw = thread.sourceThreadKey?.trim()
    if (!raw) return null
    const sessionId = raw.startsWith("opencode-")
      ? raw.slice("opencode-".length)
      : raw
    if (!sessionId) return null
    const projectKey = thread.projectSlug?.trim() || null
    return {
      kind: "command",
      command: `opencode --session ${sessionId}`,
      label: "Open in OpenCode",
      hint: projectKey
        ? `Run this in your ${projectKey} terminal.`
        : "Run this in the project terminal where the session was created.",
      projectKey: projectKey ?? undefined,
      sourceApp: app,
    }
  }

  if (app === "chatgpt") {
    const id = thread.sourceThreadKey?.trim()
    if (!id) return null
    return {
      kind: "url",
      url: `https://chatgpt.com/c/${id}`,
      label: "Open in ChatGPT",
      sourceApp: app,
    }
  }

  if (app === "cursor") {
    // Cursor handles `cursor://file/<absolute-path>` to open files /
    // folders. We can open the project root if the locator decodes to
    // a path we recognize. Resuming the chat itself isn't a documented
    // affordance.
    const parsed = parseClaudeJsonlLocator(thread.sourceLocator)
    if (!parsed) return null
    return {
      kind: "url",
      url: `cursor://file/${prettyClaudeProject(parsed.projectKey)}`,
      label: "Open in Cursor",
      sourceApp: app,
    }
  }

  return null
}

/**
 * Per-message deep linking is intentionally a no-op.
 *
 * None of our supported sources have a real "open this specific
 * turn" affordance:
 *   - **Codex** doesn't expose per-turn anchors in its URL scheme;
 *     a constructed `codex://threads/<id>/turns/<turn_id>` URL just
 *     opens the thread at its tail (same as thread-level).
 *   - **Claude Code** is a CLI; `claude --resume <session>` always
 *     lands at session-end regardless of which message you'd want.
 *   - **Web sources (ChatGPT, Claude.ai)** anchor at the conversation
 *     root, not a turn.
 *
 * We keep the function around so the per-message UI doesn't have to
 * special-case "do we even have this concept" — it just calls and
 * gets null. The Codex parser still captures `turn_id` into
 * `metadataJson.codex_turn_id` because the data is small, harmless,
 * and might be useful for in-app navigation later (e.g., a "jump to
 * turn" affordance that doesn't depend on the source app).
 */
export function getMessageDeepLink(
  _thread: OperatorThread,
  _message: { metadataJson?: Record<string, unknown> | null }
): SourceDeepLink | null {
  return null
}

// ───────────────────────── helpers ─────────────────────────────────


function takeString(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t ? t : null
}

function stripThreadPrefix(id: string): string | null {
  return id.startsWith("thread-") ? id.slice("thread-".length) : id || null
}

/**
 * Pulls the trailing 32+-char hex/uuid token out of a sourceLocator —
 * works for both Claude Code (`<UUID>.jsonl`) and Codex equivalents
 * that store the conversation ID in the filename.
 */
function extractGenericIdFromLocator(locator: string | null): string | null {
  if (!locator) return null
  const m = locator.match(/([0-9a-f][0-9a-f-]{30,})(?:\.[a-z]+)?$/i)
  return m ? m[1] : null
}

/**
 * Claude Code stores sessions at:
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 * where `<encoded-cwd>` is the absolute working directory with each
 * `/` replaced by `-`. The encoding is technically lossy when the
 * cwd contained both `/` and `-`, but the project key is still
 * recognizable, so we surface it as a hint rather than fight to
 * fully reverse it.
 */
function parseClaudeJsonlLocator(
  locator: string | null
): { sessionId: string; projectKey: string } | null {
  if (!locator) return null
  const m = locator.match(/projects\/([^/]+)\/([0-9a-f-]{20,})\.jsonl$/i)
  if (!m) return null
  return { projectKey: m[1], sessionId: m[2] }
}

/**
 * `-Users-alice-foo-bar` → `/Users/alice/foo/bar`.
 *
 * Lossy (we can't tell if the original cwd had its own `-`s) but
 * good enough as a "you probably know which project this is" hint.
 */
function prettyClaudeProject(encoded: string): string {
  if (!encoded) return ""
  return encoded.replace(/-/g, "/").replace(/^\//, "/")
}

/**
 * Some Claude imports store the JSONL path base64-encoded under
 * `sourceThreadKey` (often with a `claude-` prefix). Decode so the
 * regex parser can find a session uuid even when `sourceLocator` is
 * null.
 */
function decodeClaudeThreadKey(key: string | null): string | null {
  if (!key) return null
  const stripped = key.replace(/^claude-/, "").trim()
  if (!stripped) return null
  try {
    if (typeof atob !== "undefined") {
      return atob(stripped)
    }
    // Node fallback (server-side helper invocation).
    return Buffer.from(stripped, "base64").toString("utf-8")
  } catch {
    return null
  }
}

/**
 * Last-resort fallback for legacy/fork rows where neither locator
 * nor key parses. If the thread id itself looks like a UUID we use
 * it as the session id; the project hint stays empty so the toast
 * just reads "Run this in your project terminal."
 */
function claudeFallbackFromId(
  id: string
): { sessionId: string; projectKey: string } | null {
  const stripped = id.replace(/^thread-/, "")
  // Only accept canonical UUID shape so we don't hand a synthetic id
  // (e.g. fork-1234567890-abc) into a `claude --resume` command.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      stripped
    )
  ) {
    return null
  }
  return { sessionId: stripped, projectKey: "" }
}
