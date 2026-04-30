/**
 * Claude Code session importer.
 *
 * Reads sessions from `~/.claude/projects` (CLI-written JSONL) and the
 * Claude Desktop session-metadata tree (sidecar `local_*.json` files
 * carrying the authoritative UI title). Implements the `ImporterModule`
 * contract — discovery is infallible (returns sessions + skip
 * telemetry), parsing stamps a `sourceFormatVersion`, and root
 * resolution goes through the cross-platform helper.
 */

import * as fs from "fs"
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

export type ParsedClaudeMessage = ParsedMessage
export type ParsedClaudeSession = ParsedSession

// ─── Storage roots ───────────────────────────────────────────────────────────

const CLAUDE_ROOT_SPEC: SourceRootSpec = {
  envVar: "OPERATOR_STUDIO_CLAUDE_ROOTS",
  mac: [
    "~/.claude/projects",
    "~/Library/Application Support/Claude/claude-code-sessions",
  ],
  linux: ["~/.claude/projects"],
  // The Claude CLI on Windows currently writes to `~/.claude/projects`
  // via its node-based runner. Desktop sessions on Windows live under
  // `%APPDATA%/Claude/claude-code-sessions` based on Anthropic's
  // standard packaging — kept here as a best-effort entry, filtered
  // out by `resolveSourceRoots` if the dir doesn't exist.
  windows: [
    "%USERPROFILE%/.claude/projects",
    "%APPDATA%/Claude/claude-code-sessions",
  ],
}

/** Resolve on-disk Claude Code session roots (existing dirs only). */
export function getClaudeSessionRoots(): string[] {
  return resolveSourceRoots(CLAUDE_ROOT_SPEC)
}

// ─── Desktop title index ─────────────────────────────────────────────────────

/**
 * Root for Claude Desktop's per-session metadata. Each `local_<uuid>.json`
 * carries the authoritative UI title (the one shown in the Recents
 * sidebar) plus a `cliSessionId` linking back to the JSONL session id.
 */
function claudeDesktopMetaRoots(): string[] {
  // Same lookup as the CLI roots minus `~/.claude/projects` — the
  // desktop tree is the second entry on Mac/Windows.
  return resolveSourceRoots({
    envVar: "OPERATOR_STUDIO_CLAUDE_DESKTOP_META_ROOTS",
    mac: ["~/Library/Application Support/Claude/claude-code-sessions"],
    linux: [],
    windows: ["%APPDATA%/Claude/claude-code-sessions"],
  })
}

/**
 * Walk the Claude Desktop session-metadata tree and build a map of
 * `cliSessionId → title`. When the same cliSessionId appears in
 * multiple `local_*.json` files (re-titled forks etc.), the entry with
 * the most recent `lastActivityAt` wins.
 */
export function loadClaudeDesktopTitleIndex(): Map<string, string> {
  const tracked = new Map<
    string,
    { title: string; lastActivityAt: number }
  >()

  function walk(dir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
        continue
      }
      if (
        !e.isFile() ||
        !e.name.startsWith("local_") ||
        !e.name.endsWith(".json")
      ) {
        continue
      }
      try {
        const obj = JSON.parse(fs.readFileSync(full, "utf-8")) as {
          cliSessionId?: unknown
          title?: unknown
          lastActivityAt?: unknown
        }
        if (
          typeof obj.cliSessionId === "string" &&
          typeof obj.title === "string" &&
          obj.title.trim()
        ) {
          const ts =
            typeof obj.lastActivityAt === "number" ? obj.lastActivityAt : 0
          const prev = tracked.get(obj.cliSessionId)
          if (!prev || ts > prev.lastActivityAt) {
            tracked.set(obj.cliSessionId, {
              title: obj.title.trim(),
              lastActivityAt: ts,
            })
          }
        }
      } catch {
        // skip unreadable / malformed sidecar files
      }
    }
  }

  for (const root of claudeDesktopMetaRoots()) {
    walk(root)
  }

  const out = new Map<string, string>()
  for (const [k, v] of tracked) out.set(k, v.title)
  return out
}

// ─── Conversation parsing ────────────────────────────────────────────────────

/**
 * Strip `<system-reminder>`-style harness blocks from message content.
 * These are internal Claude Code artifacts (hook feedback, context
 * reminders) — not part of the user-visible conversation.
 */
function stripSystemTags(text: string): string {
  let cleaned = text.replace(
    /<system-reminder>[\s\S]*?<\/system-reminder>/g,
    ""
  )
  cleaned = cleaned.replace(
    /<task-notification>[\s\S]*?<\/task-notification>/g,
    ""
  )
  cleaned = cleaned.replace(
    /<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g,
    ""
  )
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n")
  return cleaned.trim()
}

interface ParsedJsonlResult {
  messages: ParsedMessage[]
  /** Claude Code's own `{type:"ai-title"}` line, when present. */
  aiTitle: string | null
  /** Which on-disk format we recognized — informs `sourceFormatVersion`. */
  formatVersion: "cli-jsonl-v1" | "direct-role-content-v0" | "unknown"
}

function parseConversationJsonl(filePath: string): ParsedJsonlResult | null {
  let content: string
  try {
    content = fs.readFileSync(filePath, "utf-8")
  } catch {
    return null
  }

  const messages: ParsedMessage[] = []
  let aiTitle: string | null = null
  let sawTypedRecord = false
  let sawDirectRoleContent = false

  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (obj.type === "ai-title" && typeof obj.aiTitle === "string") {
      const t = obj.aiTitle.trim()
      if (t) aiTitle = t
      continue
    }

    if (obj.type === "human" || obj.type === "user") {
      sawTypedRecord = true
      const text = stripSystemTags(extractClaudeContent(obj.message))
      if (text) {
        messages.push({
          role: "user",
          content: text,
          timestamp: pickTimestamp(obj),
        })
      }
    } else if (obj.type === "assistant") {
      sawTypedRecord = true
      const text = stripSystemTags(extractClaudeContent(obj.message))
      if (text) {
        messages.push({
          role: "assistant",
          content: text,
          timestamp: pickTimestamp(obj),
        })
      }
    } else if (obj.role && obj.content) {
      sawDirectRoleContent = true
      const raw =
        typeof obj.content === "string"
          ? obj.content
          : JSON.stringify(obj.content)
      const cleaned = stripSystemTags(raw)
      if (cleaned) {
        messages.push({
          role: normalizeRole(obj.role as string),
          content: cleaned,
          timestamp: pickTimestamp(obj),
        })
      }
    }
  }

  if (messages.length === 0) return null
  return {
    messages,
    aiTitle,
    formatVersion: sawTypedRecord
      ? "cli-jsonl-v1"
      : sawDirectRoleContent
        ? "direct-role-content-v0"
        : "unknown",
  }
}

function parseConversationJson(filePath: string): ParsedJsonlResult | null {
  let content: string
  try {
    content = fs.readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return null
  }

  const msgArray = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.messages)
      ? data.messages
      : isRecord(data) && Array.isArray(data.conversation)
        ? data.conversation
        : null

  if (!msgArray) return null

  const messages: ParsedMessage[] = []
  for (const msg of msgArray) {
    if (isRecord(msg) && msg.role && msg.content) {
      messages.push({
        role: normalizeRole(msg.role as string),
        content:
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content),
        timestamp: pickTimestamp(msg),
      })
    }
  }

  if (messages.length === 0) return null
  return { messages, aiTitle: null, formatVersion: "direct-role-content-v0" }
}

function extractClaudeContent(message: unknown): string {
  if (typeof message === "string") return message
  if (isRecord(message)) {
    if (typeof message.content === "string") return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .filter(
          (b): b is { type: string; text: string } =>
            isRecord(b) && b.type === "text" && typeof b.text === "string"
        )
        .map((b) => b.text)
        .join("\n")
    }
    return JSON.stringify(message)
  }
  return ""
}

function pickTimestamp(obj: Record<string, unknown>): string | undefined {
  const t = obj.timestamp ?? obj.created_at
  return typeof t === "string" ? t : undefined
}

function normalizeRole(role: string): "user" | "assistant" | "system" {
  if (role === "human" || role === "user") return "user"
  if (role === "assistant" || role === "ai" || role === "bot") return "assistant"
  return "system"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isConversationFile(name: string): boolean {
  // `local_<uuid>.json` files are Claude Desktop's title-metadata
  // sidecars (consumed by `loadClaudeDesktopTitleIndex`), not
  // conversations. Including them here would parse-fail every desktop
  // session with a misleading "no recognizable messages" skip.
  if (name.startsWith("local_") && name.endsWith(".json")) return false
  return (
    name.endsWith(".jsonl") ||
    name.endsWith(".json") ||
    name === "conversation" ||
    name === "messages.json" ||
    name === "conversation.json"
  )
}

function parseClaudeFileInternal(
  filePath: string,
  projectHint: string,
  desktopTitles: Map<string, string>
): ParseResult {
  const parsed = filePath.endsWith(".jsonl")
    ? parseConversationJsonl(filePath)
    : parseConversationJson(filePath)

  if (!parsed) {
    return {
      ok: false,
      locator: filePath,
      reason: "could not parse — unreadable, malformed, or no recognizable messages",
    }
  }

  const sessionUuid = path.basename(filePath, path.extname(filePath))
  const desktopTitle = desktopTitles.get(sessionUuid)
  const firstUser = parsed.messages.find((m) => m.role === "user")
  // Title priority: Desktop UI title (most authoritative) → CLI ai-title
  // → first-user-message slice → session uuid as last resort.
  const title =
    desktopTitle ??
    parsed.aiTitle ??
    (firstUser
      ? firstUser.content.slice(0, 120).replace(/\n/g, " ")
      : sessionUuid)

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

  return {
    ok: true,
    session: {
      sourceThreadId: `claude-${Buffer.from(filePath).toString("base64url")}`,
      title,
      messages: parsed.messages,
      createdAt: timestamps[0] ?? stat.birthtime.toISOString(),
      lastActivityAt:
        timestamps[timestamps.length - 1] ?? stat.mtime.toISOString(),
      projectPath: projectHint,
      metadata: {
        filePath,
        fileSize: stat.size,
        projectHint,
        sourceFormatVersion: parsed.formatVersion,
      },
    },
  }
}

function discoverInternal(): DiscoveryResult {
  const roots = getClaudeSessionRoots()
  const desktopTitles = loadClaudeDesktopTitleIndex()
  const sessions: ParsedSession[] = []
  const skipped: SkippedItem[] = []

  function consume(filePath: string, projectHint: string) {
    const result = parseClaudeFileInternal(filePath, projectHint, desktopTitles)
    if (result.ok) sessions.push(result.session)
    else skipped.push({ locator: result.locator, reason: result.reason })
  }

  for (const root of roots) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name)
      if (entry.isFile() && isConversationFile(entry.name)) {
        consume(entryPath, root)
        continue
      }
      if (!entry.isDirectory()) continue

      let subEntries: fs.Dirent[]
      try {
        subEntries = fs.readdirSync(entryPath, { withFileTypes: true })
      } catch {
        continue
      }
      for (const sub of subEntries) {
        if (sub.isFile() && isConversationFile(sub.name)) {
          consume(path.join(entryPath, sub.name), entry.name)
          continue
        }
        if (!sub.isDirectory()) continue
        // One more level for project subdirs.
        let deepEntries: fs.Dirent[]
        try {
          deepEntries = fs.readdirSync(path.join(entryPath, sub.name), {
            withFileTypes: true,
          })
        } catch {
          continue
        }
        for (const deep of deepEntries) {
          if (deep.isFile() && isConversationFile(deep.name)) {
            consume(
              path.join(entryPath, sub.name, deep.name),
              `${entry.name}/${sub.name}`
            )
          }
        }
      }
    }
  }

  return { sessions, skipped }
}

// ─── ImporterModule + compat exports ─────────────────────────────────────────

export const claudeCodeImporter: ImporterModule = {
  id: "claude-code",
  // `claude` is the legacy enum value used by older rows. Aliasing means
  // both ids resolve to this module so dedupe and parse work uniformly.
  aliases: ["claude"],
  supportsSingleImport: true,

  discover(): DiscoveryResult {
    return discoverInternal()
  },

  parseOne(filePath: string): ParseResult {
    return parseClaudeFileInternal(
      filePath,
      path.dirname(filePath),
      loadClaudeDesktopTitleIndex()
    )
  },
}

/** @deprecated use `claudeCodeImporter.discover()` via the registry. */
export function discoverClaudeSessions(): ParsedSession[] {
  return claudeCodeImporter.discover().sessions
}

/** @deprecated use `claudeCodeImporter.parseOne(filePath)` via the registry. */
export function parseClaudeFile(filePath: string): ParsedSession | null {
  const result = claudeCodeImporter.parseOne(filePath)
  return result.ok ? result.session : null
}