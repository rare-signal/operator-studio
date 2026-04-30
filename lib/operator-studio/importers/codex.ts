/**
 * Codex session importer.
 *
 * Reads sessions from the local Codex session stores. Implements the
 * `ImporterModule` contract — discovery returns infallible results
 * (sessions + skip telemetry, never throws), parsing stamps a
 * `sourceFormatVersion` into per-thread metadata, and root resolution
 * goes through the cross-platform helper.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { resolveSourceRoots, type SourceRootSpec } from "./_paths"
import type {
  DiscoveryResult,
  ImporterModule,
  ParsedMessage,
  ParsedSession,
  ParseResult,
  SkippedItem,
} from "./_registry"

// ─── Backward-compat type aliases ────────────────────────────────────────────
//
// Existing callers (threads route, sync route, scripts) import these names.
// Today they're identical to the unified shape; keeping the aliases means we
// can refactor those callers later without breaking them now. Per-message
// metadata (e.g. Codex's `turn_id`) lives on `metadata.codex_turn_id` —
// `codex-backfill.ts` reads through there.

export type ParsedCodexMessage = ParsedMessage
export type ParsedCodexSession = ParsedSession

// ─── Storage roots ───────────────────────────────────────────────────────────

const CODEX_ROOT_SPEC: SourceRootSpec = {
  envVar: "OPERATOR_STUDIO_CODEX_ROOTS",
  mac: ["~/.codex/sessions", "~/.codex/archived_sessions"],
  linux: ["~/.codex/sessions", "~/.codex/archived_sessions"],
  // Codex on Windows uses the same `~/.codex` layout via its node-based
  // CLI. If a future release moves it under `%APPDATA%`, add the path
  // here as a higher-priority entry — `resolveSourceRoots` walks them
  // in order and the existence filter drops missing ones.
  windows: ["%USERPROFILE%/.codex/sessions", "%USERPROFILE%/.codex/archived_sessions"],
}

/** Resolve on-disk Codex session roots (existing dirs only). */
export function getCodexSessionRoots(): string[] {
  return resolveSourceRoots(CODEX_ROOT_SPEC)
}

// ─── Internals ───────────────────────────────────────────────────────────────

const LEGACY_SESSION_FILES = new Set([
  "conversation.jsonl",
  "conversation.json",
  "messages.jsonl",
  "messages.json",
  "session.json",
])

interface CodexParseResult {
  sessionId: string | null
  createdAt: string | null
  projectPath: string | null
  messages: ParsedMessage[]
  /**
   * Which on-disk format we recognized — either the modern Codex
   * Desktop event-stream JSONL (`event_msg` records) or the legacy
   * direct `{role,content}` shape. Stamped into thread metadata so we
   * can target re-parses when Codex changes its format.
   */
  formatVersion: "event-stream-v1" | "legacy-message-v0" | "unknown"
}

/**
 * Codex's AI-generated thread title sidecar:
 * `~/.codex/session_index.jsonl` with lines `{id, thread_name, updated_at}`.
 * Loaded once per discovery so per-session parsing can look up its title
 * by session id instead of falling back to the first user prompt.
 */
function loadCodexTitleIndex(): Map<string, string> {
  const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl")
  const map = new Map<string, string>()
  let content: string
  try {
    content = fs.readFileSync(indexPath, "utf-8")
  } catch {
    return map
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as {
        id?: unknown
        thread_name?: unknown
      }
      if (
        typeof obj.id === "string" &&
        typeof obj.thread_name === "string" &&
        obj.thread_name.trim()
      ) {
        map.set(obj.id, obj.thread_name.trim())
      }
    } catch {
      // skip malformed lines
    }
  }
  return map
}

function isCodexSessionFile(name: string): boolean {
  return (
    name.endsWith(".jsonl") ||
    name.endsWith(".json") ||
    LEGACY_SESSION_FILES.has(name)
  )
}

function safeRealPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath)
  } catch {
    return filePath
  }
}

function parseCodexJsonl(content: string): CodexParseResult {
  const messages: ParsedMessage[] = []
  let sessionId: string | null = null
  let createdAt: string | null = null
  let projectPath: string | null = null
  // task_started carries `turn_id` for the upcoming exchange; remember
  // it so the next user_message / agent_message events inherit.
  let currentTurnId: string | undefined
  let sawEventMsg = false

  const pushMessage = (msg: ParsedMessage | null) => {
    if (!msg) return
    if (!msg.content.trim()) return
    const meta: Record<string, unknown> = { ...(msg.metadata ?? {}) }
    if (currentTurnId && !meta.codex_turn_id) {
      meta.codex_turn_id = currentTurnId
    }
    messages.push({
      ...msg,
      content: msg.content.trim(),
      metadata: Object.keys(meta).length ? meta : undefined,
    })
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const meta = extractSessionMeta(obj)
      sessionId = sessionId ?? meta.sessionId
      createdAt = createdAt ?? meta.createdAt
      projectPath = projectPath ?? meta.projectPath

      if (obj.type === "event_msg" && isRecord(obj.payload)) {
        sawEventMsg = true
        const payload = obj.payload
        if (
          payload.type === "task_started" &&
          typeof payload.turn_id === "string" &&
          payload.turn_id.trim()
        ) {
          currentTurnId = payload.turn_id.trim()
        }
      }

      pushMessage(extractMessage(obj))
    } catch {
      // skip malformed lines
    }
  }

  return {
    sessionId,
    createdAt,
    projectPath,
    messages,
    formatVersion: sawEventMsg
      ? "event-stream-v1"
      : messages.length > 0
        ? "legacy-message-v0"
        : "unknown",
  }
}

function parseCodexJson(content: string): CodexParseResult {
  const data = JSON.parse(content) as Record<string, unknown>
  const msgArray = Array.isArray(data)
    ? data
    : Array.isArray(data.messages)
      ? data.messages
      : Array.isArray(data.conversation)
        ? data.conversation
        : null
  const messages: ParsedMessage[] = []

  if (msgArray) {
    for (const obj of msgArray) {
      if (isRecord(obj)) {
        const msg = extractMessage(obj)
        if (msg?.content.trim()) {
          messages.push({ ...msg, content: msg.content.trim() })
        }
      }
    }
  }

  return {
    sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
    createdAt:
      typeof data.createdAt === "string"
        ? data.createdAt
        : typeof data.timestamp === "string"
          ? data.timestamp
          : null,
    projectPath:
      typeof data.cwd === "string"
        ? data.cwd
        : typeof data.projectPath === "string"
          ? data.projectPath
          : null,
    messages,
    formatVersion: messages.length > 0 ? "legacy-message-v0" : "unknown",
  }
}

function extractSessionMeta(obj: Record<string, unknown>) {
  if (obj.type !== "session_meta" || !isRecord(obj.payload)) {
    return { sessionId: null, createdAt: null, projectPath: null }
  }
  const payload = obj.payload
  return {
    sessionId: typeof payload.id === "string" ? payload.id : null,
    createdAt:
      typeof payload.timestamp === "string"
        ? payload.timestamp
        : typeof obj.timestamp === "string"
          ? obj.timestamp
          : null,
    projectPath: typeof payload.cwd === "string" ? payload.cwd : null,
  }
}

function extractMessage(obj: Record<string, unknown>): ParsedMessage | null {
  if (obj.type === "event_msg" && isRecord(obj.payload)) {
    const payload = obj.payload
    const timestamp =
      typeof obj.timestamp === "string"
        ? obj.timestamp
        : typeof payload.timestamp === "string"
          ? payload.timestamp
          : undefined

    if (
      payload.type === "user_message" &&
      typeof payload.message === "string"
    ) {
      return { role: "user", content: payload.message, timestamp }
    }
    if (
      payload.type === "agent_message" &&
      typeof payload.message === "string"
    ) {
      return { role: "assistant", content: payload.message, timestamp }
    }
  }

  // Legacy: { type: "message", message: { role, content } }
  if (obj.type === "message" && obj.message) {
    const m = obj.message as Record<string, unknown>
    if (m.role && m.content) {
      return {
        role: normalizeRole(m.role as string),
        content: extractContentText(m.content),
        timestamp: (obj.timestamp || obj.created_at) as string | undefined,
      }
    }
  }

  // Direct { role, content }
  if (obj.role && obj.content) {
    return {
      role: normalizeRole(obj.role as string),
      content: extractContentText(obj.content),
      timestamp: (obj.timestamp || obj.created_at) as string | undefined,
    }
  }

  return null
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!isRecord(item)) return null
        if (typeof item.text === "string") return item.text
        if (item.type === "input_text" && typeof item.text === "string") return item.text
        if (item.type === "output_text" && typeof item.text === "string") return item.text
        return null
      })
      .filter((p): p is string => Boolean(p))
    if (parts.length > 0) return parts.join("\n")
  }
  return JSON.stringify(content)
}

function inferSessionIdFromPath(filePath: string): string | null {
  const base = path.basename(filePath, path.extname(filePath))
  const match = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  )
  return match?.[1] ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeRole(role: string): "user" | "assistant" | "system" {
  if (role === "human" || role === "user") return "user"
  if (role === "assistant" || role === "ai" || role === "bot") return "assistant"
  return "system"
}

/**
 * Parse one Codex session file. Never throws — returns a `ParseResult`
 * tagged with success/skip + reason. The caller decides whether to
 * surface the skip or quietly drop it.
 */
function parseCodexFileInternal(
  filePath: string,
  titleIndex: Map<string, string>
): ParseResult {
  let content: string
  try {
    content = fs.readFileSync(filePath, "utf-8")
  } catch (err) {
    return {
      ok: false,
      locator: filePath,
      reason: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  let parsed: CodexParseResult
  try {
    parsed = filePath.endsWith(".jsonl")
      ? parseCodexJsonl(content)
      : parseCodexJson(content)
  } catch (err) {
    return {
      ok: false,
      locator: filePath,
      reason: `parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  if (parsed.messages.length === 0) {
    return { ok: false, locator: filePath, reason: "no messages found in file" }
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(filePath)
  } catch (err) {
    return {
      ok: false,
      locator: filePath,
      reason: `stat failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const timestamps = parsed.messages
    .map((m) => m.timestamp)
    .filter((value): value is string => Boolean(value))
    .sort()
  const sessionId = parsed.sessionId ?? inferSessionIdFromPath(filePath)
  const indexed = sessionId ? titleIndex.get(sessionId) : undefined
  const firstUser = parsed.messages.find((m) => m.role === "user")
  const title =
    indexed ??
    (firstUser
      ? firstUser.content.slice(0, 120).replace(/\n/g, " ")
      : path.basename(filePath, path.extname(filePath)))

  return {
    ok: true,
    session: {
      sourceThreadId: sessionId
        ? `codex-${sessionId}`
        : `codex-${Buffer.from(filePath).toString("base64url").slice(0, 32)}`,
      title,
      messages: parsed.messages,
      createdAt:
        timestamps[0] ?? parsed.createdAt ?? stat.birthtime.toISOString(),
      lastActivityAt:
        timestamps[timestamps.length - 1] ?? stat.mtime.toISOString(),
      projectPath: parsed.projectPath,
      metadata: {
        filePath,
        fileSize: stat.size,
        projectPath: parsed.projectPath,
        sessionId,
        sourceFormatVersion: parsed.formatVersion,
      },
    },
  }
}

function walkCodexFiles(
  dirPath: string,
  sessions: ParsedSession[],
  skipped: SkippedItem[],
  seenPaths: Set<string>,
  titleIndex: Map<string, string>
): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    // Root-or-subdir is gone or unreadable — silent. Roots are pre-filtered
    // for existence; transient errors here aren't worth a per-dir skip line.
    return
  }

  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue
    const entryPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      walkCodexFiles(entryPath, sessions, skipped, seenPaths, titleIndex)
      continue
    }

    if (!entry.isFile() || !isCodexSessionFile(entry.name)) {
      continue
    }

    const realPath = safeRealPath(entryPath)
    if (seenPaths.has(realPath)) continue
    seenPaths.add(realPath)

    const result = parseCodexFileInternal(entryPath, titleIndex)
    if (result.ok) {
      sessions.push(result.session)
    } else {
      skipped.push({ locator: result.locator, reason: result.reason })
    }
  }
}

// ─── ImporterModule + compat exports ─────────────────────────────────────────

export const codexImporter: ImporterModule = {
  id: "codex",
  supportsSingleImport: true,

  discover(): DiscoveryResult {
    const roots = getCodexSessionRoots()
    const titleIndex = loadCodexTitleIndex()
    const sessions: ParsedSession[] = []
    const skipped: SkippedItem[] = []
    const seenPaths = new Set<string>()
    for (const root of roots) {
      walkCodexFiles(root, sessions, skipped, seenPaths, titleIndex)
    }
    return { sessions, skipped }
  },

  parseOne(filePath: string): ParseResult {
    return parseCodexFileInternal(filePath, loadCodexTitleIndex())
  },

  deriveMessageMetadata(msg) {
    const turnId = msg.metadata?.codex_turn_id
    return typeof turnId === "string" && turnId
      ? { codex_turn_id: turnId }
      : null
  },
}

/** @deprecated use `codexImporter.discover()` via the registry. */
export function discoverCodexSessions(): ParsedSession[] {
  return codexImporter.discover().sessions
}

/** @deprecated use `codexImporter.parseOne(filePath)` via the registry. */
export function parseCodexFile(filePath: string): ParsedSession | null {
  const result = codexImporter.parseOne(filePath)
  return result.ok ? result.session : null
}
