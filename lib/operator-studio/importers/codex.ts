/**
 * Codex session importer
 *
 * Reads sessions from the local Codex session stores.
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export interface ParsedCodexMessage {
  role: "user" | "assistant" | "system"
  content: string
  timestamp?: string
}

export interface ParsedCodexSession {
  sourceThreadId: string
  title: string
  messages: ParsedCodexMessage[]
  createdAt: string | null
  lastActivityAt: string | null
  projectPath: string | null
  metadata: Record<string, unknown>
}

interface CodexParseResult {
  sessionId: string | null
  createdAt: string | null
  projectPath: string | null
  messages: ParsedCodexMessage[]
}

const CODEX_SESSION_ROOTS = [
  path.join(os.homedir(), ".codex", "sessions"),
  path.join(os.homedir(), ".codex", "archived_sessions"),
]

const LEGACY_SESSION_FILES = new Set([
  "conversation.jsonl",
  "conversation.json",
  "messages.jsonl",
  "messages.json",
  "session.json",
])

function getSessionRoots(): string[] {
  const envRoots = process.env.OPERATOR_STUDIO_CODEX_ROOTS
  if (envRoots) {
    return envRoots.split(":").filter(Boolean)
  }
  return CODEX_SESSION_ROOTS.filter((r) => {
    try {
      return fs.existsSync(r)
    } catch {
      return false
    }
  })
}

/**
 * Discover all Codex sessions from the default roots.
 */
export function discoverCodexSessions(): ParsedCodexSession[] {
  const roots = getSessionRoots()
  const sessions: ParsedCodexSession[] = []
  const seenPaths = new Set<string>()

  for (const root of roots) {
    walkCodexFiles(root, sessions, seenPaths)
  }

  return sessions
}

function walkCodexFiles(
  dirPath: string,
  sessions: ParsedCodexSession[],
  seenPaths: Set<string>
) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name === ".DS_Store") continue

      const entryPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        walkCodexFiles(entryPath, sessions, seenPaths)
        continue
      }

      if (!entry.isFile() || !isCodexSessionFile(entry.name)) {
        continue
      }

      const realPath = safeRealPath(entryPath)
      if (seenPaths.has(realPath)) {
        continue
      }
      seenPaths.add(realPath)

      const session = tryParseCodexFile(entryPath)
      if (session) {
        sessions.push(session)
      }
    }
  } catch {
    // Root doesn't exist or isn't accessible
  }
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

function tryParseCodexFile(filePath: string): ParsedCodexSession | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const parsed = filePath.endsWith(".jsonl")
      ? parseCodexJsonl(content)
      : parseCodexJson(content)
    const { messages } = parsed

    if (messages.length === 0) return null

    const firstUser = messages.find((m) => m.role === "user")
    const title = firstUser
      ? firstUser.content.slice(0, 120).replace(/\n/g, " ")
      : path.basename(filePath, path.extname(filePath))
    const stat = fs.statSync(filePath)
    const timestamps = messages
      .map((m) => m.timestamp)
      .filter((value): value is string => Boolean(value))
      .sort()
    const sessionId = parsed.sessionId ?? inferSessionIdFromPath(filePath)

    return {
      sourceThreadId:
        sessionId
          ? `codex-${sessionId}`
          : `codex-${Buffer.from(filePath).toString("base64url").slice(0, 32)}`,
      title,
      messages,
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
      },
    }
  } catch {
    return null
  }
}

function parseCodexJsonl(content: string): CodexParseResult {
  const messages: ParsedCodexMessage[] = []
  let sessionId: string | null = null
  let createdAt: string | null = null
  let projectPath: string | null = null

  const pushMessage = (msg: ParsedCodexMessage | null) => {
    if (!msg) return
    if (!msg.content.trim()) return
    messages.push({
      ...msg,
      content: msg.content.trim(),
    })
  }

  const lines = content.split("\n").filter((l) => l.trim())
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      const meta = extractSessionMeta(obj)
      sessionId = sessionId ?? meta.sessionId
      createdAt = createdAt ?? meta.createdAt
      projectPath = projectPath ?? meta.projectPath
      pushMessage(extractMessage(obj))
    } catch {
      // Skip malformed lines
    }
  }

  return {
    sessionId,
    createdAt,
    projectPath,
    messages,
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
  const messages: ParsedCodexMessage[] = []

  if (msgArray) {
    for (const obj of msgArray) {
      if (isRecord(obj)) {
        const msg = extractMessage(obj)
        if (msg?.content.trim()) {
          messages.push({
            ...msg,
            content: msg.content.trim(),
          })
        }
      }
    }
  }

  return {
    sessionId:
      typeof data.sessionId === "string" ? data.sessionId : null,
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
  }
}

function extractSessionMeta(obj: Record<string, unknown>) {
  if (obj.type !== "session_meta" || !isRecord(obj.payload)) {
    return {
      sessionId: null,
      createdAt: null,
      projectPath: null,
    }
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

function extractMessage(obj: Record<string, unknown>): ParsedCodexMessage | null {
  // Current Codex Desktop transcripts emit visible turns as event_msg records.
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
      return {
        role: "user",
        content: payload.message,
        timestamp,
      }
    }

    if (
      payload.type === "agent_message" &&
      typeof payload.message === "string"
    ) {
      return {
        role: "assistant",
        content: payload.message,
        timestamp,
      }
    }
  }

  // Legacy Codex JSONL: { type: "message", message: { role, content } }
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

  // Direct { role, content } format
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
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (!isRecord(item)) return null
        if (typeof item.text === "string") return item.text
        if (
          item.type === "input_text" &&
          typeof item.text === "string"
        ) {
          return item.text
        }
        if (
          item.type === "output_text" &&
          typeof item.text === "string"
        ) {
          return item.text
        }
        return null
      })
      .filter((part): part is string => Boolean(part))

    if (parts.length > 0) {
      return parts.join("\n")
    }
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
 * Import a single file as a Codex session.
 */
export function parseCodexFile(filePath: string): ParsedCodexSession | null {
  return tryParseCodexFile(filePath)
}
