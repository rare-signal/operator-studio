/**
 * Claude Code session importer
 *
 * Reads sessions from ~/.claude/projects and the Claude Code session store.
 * Each session folder typically contains conversation JSONL files.
 */

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

export interface ParsedClaudeMessage {
  role: "user" | "assistant" | "system"
  content: string
  timestamp?: string
  metadata?: Record<string, unknown>
}

export interface ParsedClaudeSession {
  sourceThreadId: string
  title: string
  messages: ParsedClaudeMessage[]
  createdAt: string | null
  lastActivityAt: string | null
  projectPath: string | null
  metadata: Record<string, unknown>
}

/**
 * Strip <system-reminder>…</system-reminder> blocks and other injected tags
 * that appear inside Claude Code message content. These are internal harness
 * artifacts (hook feedback, context reminders) — not part of the conversation.
 */
function stripSystemTags(text: string): string {
  // Remove <system-reminder>…</system-reminder> blocks (possibly multiline)
  let cleaned = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
  // Remove <task-notification>…</task-notification> blocks
  cleaned = cleaned.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
  // Remove <user-prompt-submit-hook>…</user-prompt-submit-hook> blocks
  cleaned = cleaned.replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "")
  // Collapse runs of 3+ newlines down to 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n")
  return cleaned.trim()
}

// Default roots for Claude Code sessions
const CLAUDE_SESSION_ROOTS = [
  path.join(os.homedir(), ".claude", "projects"),
  path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Claude",
    "claude-code-sessions"
  ),
]

function getSessionRoots(): string[] {
  const envRoots = process.env.OBS_CLAUDE_CHAT_ROOTS
  if (envRoots) {
    return envRoots.split(":").filter(Boolean)
  }
  return CLAUDE_SESSION_ROOTS.filter((r) => {
    try {
      return fs.existsSync(r)
    } catch {
      return false
    }
  })
}

/**
 * Try to parse a JSONL conversation file from Claude Code.
 * Each line is a JSON object with { type, message, ... }
 */
function parseConversationJsonl(
  filePath: string
): ParsedClaudeMessage[] | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const lines = content.split("\n").filter((l) => l.trim())
    const messages: ParsedClaudeMessage[] = []

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)

        // Claude Code JSONL format: { type: "human"|"assistant", message: { content: ... } }
        if (obj.type === "human" || obj.type === "user") {
          const raw =
            typeof obj.message === "string"
              ? obj.message
              : typeof obj.message?.content === "string"
                ? obj.message.content
                : Array.isArray(obj.message?.content)
                  ? obj.message.content
                      .filter(
                        (b: { type: string }) => b.type === "text"
                      )
                      .map((b: { text: string }) => b.text)
                      .join("\n")
                  : JSON.stringify(obj.message)
          const text = stripSystemTags(raw)
          if (text) {
            messages.push({
              role: "user",
              content: text,
              timestamp: obj.timestamp || obj.created_at,
            })
          }
        } else if (obj.type === "assistant") {
          const raw =
            typeof obj.message === "string"
              ? obj.message
              : typeof obj.message?.content === "string"
                ? obj.message.content
                : Array.isArray(obj.message?.content)
                  ? obj.message.content
                      .filter(
                        (b: { type: string }) => b.type === "text"
                      )
                      .map((b: { text: string }) => b.text)
                      .join("\n")
                  : JSON.stringify(obj.message)
          const text = stripSystemTags(raw)
          if (text) {
            messages.push({
              role: "assistant",
              content: text,
              timestamp: obj.timestamp || obj.created_at,
            })
          }
        } else if (obj.role && obj.content) {
          // Alternative format: direct { role, content }
          const rawContent =
              typeof obj.content === "string"
                ? obj.content
                : JSON.stringify(obj.content)
          const cleanedContent = stripSystemTags(rawContent)
          if (cleanedContent) {
            messages.push({
              role: obj.role === "human" ? "user" : obj.role,
              content: cleanedContent,
              timestamp: obj.timestamp || obj.created_at,
            })
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return messages.length > 0 ? messages : null
  } catch {
    return null
  }
}

/**
 * Try to parse a plain JSON conversation file.
 */
function parseConversationJson(
  filePath: string
): ParsedClaudeMessage[] | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const data = JSON.parse(content)

    // Array of messages
    const msgArray = Array.isArray(data)
      ? data
      : Array.isArray(data.messages)
        ? data.messages
        : Array.isArray(data.conversation)
          ? data.conversation
          : null

    if (!msgArray) return null

    const messages: ParsedClaudeMessage[] = []
    for (const msg of msgArray) {
      if (msg.role && msg.content) {
        messages.push({
          role:
            msg.role === "human"
              ? "user"
              : msg.role === "assistant"
                ? "assistant"
                : "system",
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content),
          timestamp: msg.timestamp || msg.created_at,
        })
      }
    }

    return messages.length > 0 ? messages : null
  } catch {
    return null
  }
}

/**
 * Discover all Claude Code sessions from the default roots.
 */
export function discoverClaudeSessions(): ParsedClaudeSession[] {
  const roots = getSessionRoots()
  const sessions: ParsedClaudeSession[] = []

  for (const root of roots) {
    try {
      // Walk one or two levels deep looking for conversation files
      const entries = fs.readdirSync(root, { withFileTypes: true })

      for (const entry of entries) {
        const entryPath = path.join(root, entry.name)

        if (entry.isDirectory()) {
          // Look for conversation files inside project directories
          try {
            const subEntries = fs.readdirSync(entryPath, {
              withFileTypes: true,
            })
            for (const sub of subEntries) {
              if (sub.isFile() && isConversationFile(sub.name)) {
                const session = tryParseSessionFile(
                  path.join(entryPath, sub.name),
                  entry.name
                )
                if (session) sessions.push(session)
              }
              // One more level for project subdirs
              if (sub.isDirectory()) {
                try {
                  const deepEntries = fs.readdirSync(
                    path.join(entryPath, sub.name),
                    { withFileTypes: true }
                  )
                  for (const deep of deepEntries) {
                    if (
                      deep.isFile() &&
                      isConversationFile(deep.name)
                    ) {
                      const session = tryParseSessionFile(
                        path.join(entryPath, sub.name, deep.name),
                        `${entry.name}/${sub.name}`
                      )
                      if (session) sessions.push(session)
                    }
                  }
                } catch {
                  // skip inaccessible dirs
                }
              }
            }
          } catch {
            // skip inaccessible dirs
          }
        } else if (entry.isFile() && isConversationFile(entry.name)) {
          const session = tryParseSessionFile(entryPath, root)
          if (session) sessions.push(session)
        }
      }
    } catch {
      // Root doesn't exist or isn't accessible
    }
  }

  return sessions
}

function isConversationFile(name: string): boolean {
  return (
    name.endsWith(".jsonl") ||
    name.endsWith(".json") ||
    name === "conversation" ||
    name === "messages.json" ||
    name === "conversation.json"
  )
}

function tryParseSessionFile(
  filePath: string,
  projectHint: string
): ParsedClaudeSession | null {
  const messages = filePath.endsWith(".jsonl")
    ? parseConversationJsonl(filePath)
    : parseConversationJson(filePath)

  if (!messages || messages.length === 0) return null

  // Derive title from first user message
  const firstUser = messages.find((m) => m.role === "user")
  const title = firstUser
    ? firstUser.content.slice(0, 120).replace(/\n/g, " ")
    : path.basename(filePath, path.extname(filePath))

  // Derive timestamps
  const timestamps = messages
    .map((m) => m.timestamp)
    .filter(Boolean)
    .sort()
  const stat = fs.statSync(filePath)

  return {
    sourceThreadId: `claude-${Buffer.from(filePath).toString("base64url")}`,
    title,
    messages,
    createdAt: timestamps[0] ?? stat.birthtime.toISOString(),
    lastActivityAt:
      timestamps[timestamps.length - 1] ?? stat.mtime.toISOString(),
    projectPath: projectHint,
    metadata: {
      filePath,
      fileSize: stat.size,
      projectHint,
    },
  }
}

/**
 * Import a single file as a Claude Code session (for manual import).
 */
export function parseClaudeFile(filePath: string): ParsedClaudeSession | null {
  return tryParseSessionFile(filePath, path.dirname(filePath))
}
