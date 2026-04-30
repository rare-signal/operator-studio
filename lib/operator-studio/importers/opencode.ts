/**
 * OpenCode session importer.
 *
 * OpenCode (sst/opencode) stores sessions in a SQLite database — the
 * first source we ingest that isn't a JSONL/JSON file tree. The DB
 * lives at `~/.local/share/opencode/opencode.db` (XDG data dir on
 * Mac/Linux; `%LOCALAPPDATA%` flavor on Windows). The CLI is the
 * source of truth; the desktop app spawns the CLI under the hood and
 * writes to the same store.
 *
 * Schema highlights (drizzle-managed by OpenCode):
 *   - `session(id, title, slug, directory, time_created, time_archived, ...)`
 *     — title is AI-generated and authoritative.
 *   - `message(id, session_id, time_created, data)` — `data` is JSON
 *     `{role, time, agent, model, ...}`. Note: visible content is NOT
 *     here.
 *   - `part(id, message_id, session_id, time_created, data)` — many
 *     per message, `data.type ∈ {text, reasoning, tool, step-start,
 *     step-finish}`. Visible content is the concat of `text`-type
 *     parts. Reasoning/tool parts are dropped for v1 (they're useful
 *     for richer rendering later but not for the textual conversation).
 *
 * Concurrency: OpenCode writes to this DB while we read it. We open
 * read-only with WAL-aware semantics and a busy_timeout so we don't
 * deadlock against in-flight writes.
 *
 * Append-on-grow still applies — message rows are append-only, ordered
 * by `time_created`, so positional equivalence by turn index works the
 * same as for the JSONL sources.
 */

import * as fs from "fs"
import * as path from "path"

import Database from "better-sqlite3"

import { resolveSourceRoots, type SourceRootSpec } from "./_paths"
import type {
  DiscoveryResult,
  ImporterModule,
  ParsedMessage,
  ParsedSession,
  ParseResult,
  SkippedItem,
} from "./_registry"

// ─── Storage roots ───────────────────────────────────────────────────────────

const OPENCODE_ROOT_SPEC: SourceRootSpec = {
  envVar: "OPERATOR_STUDIO_OPENCODE_ROOTS",
  // OpenCode follows XDG; the data dir is `$XDG_DATA_HOME/opencode`
  // (default `~/.local/share/opencode`) on both Mac and Linux. We list
  // both forms so a user with XDG_DATA_HOME set lands on the explicit
  // path first.
  mac: ["$XDG_DATA_HOME/opencode", "~/.local/share/opencode"],
  linux: ["$XDG_DATA_HOME/opencode", "~/.local/share/opencode"],
  // Windows packaging convention: per-user app data under
  // `%LOCALAPPDATA%`. If a future release picks a different home, add
  // the path here and the existence filter handles the rest.
  windows: ["%LOCALAPPDATA%/opencode", "%APPDATA%/opencode"],
}

/** Resolve on-disk OpenCode storage roots (existing dirs only). */
export function getOpencodeStorageRoots(): string[] {
  return resolveSourceRoots(OPENCODE_ROOT_SPEC)
}

/**
 * Resolve the path to the OpenCode SQLite database file. Returns null
 * when no storage root contains an `opencode.db`. Stable across calls
 * within a single discovery — caller may close-after-use.
 */
function resolveOpencodeDbPath(): string | null {
  for (const root of getOpencodeStorageRoots()) {
    const candidate = path.join(root, "opencode.db")
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // not present in this root; try next
    }
  }
  return null
}

// ─── DB row shapes ───────────────────────────────────────────────────────────

interface SessionRow {
  id: string
  project_id: string
  parent_id: string | null
  slug: string
  directory: string
  title: string
  time_created: number
  time_updated: number
  time_archived: number | null
}

interface ProjectRow {
  id: string
  worktree: string
  name: string | null
}

/**
 * Joined message+part row. We pull all rows for a session in one
 * query and group in JS — small N per session (tens to hundreds of
 * rows), and keeps the SQL trivial.
 */
interface MessagePartRow {
  message_id: string
  message_data: string
  message_time_created: number
  part_id: string | null
  part_type: string | null
  part_data: string | null
  part_time_created: number | null
}

// ─── DB lifecycle ────────────────────────────────────────────────────────────

/**
 * Open the OpenCode database read-only with WAL-aware semantics. We
 * apply a generous busy_timeout because the OpenCode CLI may hold a
 * write lock briefly during turn commits; better to wait than to fail
 * the discovery run.
 */
function openOpencodeDb(dbPath: string): Database.Database {
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  })
  db.pragma("busy_timeout = 5000")
  // Even read-only connections benefit from declaring WAL awareness so
  // SQLite consults the -wal file rather than serving a stale view of
  // the main database.
  db.pragma("journal_mode")
  return db
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

/**
 * Reconstruct a single message's visible content by concatenating the
 * text parts in part-order. Parts of type `reasoning`, `tool`,
 * `step-start`, `step-finish` are dropped here — they're useful for
 * future richer rendering but not for the textual conversation.
 */
function reconstructMessageContent(parts: MessagePartRow[]): string {
  const chunks: string[] = []
  for (const p of parts) {
    if (p.part_type !== "text" || !p.part_data) continue
    try {
      const obj = JSON.parse(p.part_data) as { type?: string; text?: string }
      if (typeof obj.text === "string" && obj.text) {
        chunks.push(obj.text)
      }
    } catch {
      // Malformed part JSON — silent skip. The session-level skip path
      // is reserved for cases where we couldn't read ANY of the message.
    }
  }
  return chunks.join("\n\n").trim()
}

function isoFromMs(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function buildSession(
  row: SessionRow,
  project: ProjectRow | undefined,
  rows: MessagePartRow[]
): ParsedSession | null {
  // Group rows by message_id, preserving message order.
  const byMessage = new Map<string, MessagePartRow[]>()
  const messageOrder: string[] = []
  for (const r of rows) {
    if (!byMessage.has(r.message_id)) {
      byMessage.set(r.message_id, [])
      messageOrder.push(r.message_id)
    }
    byMessage.get(r.message_id)!.push(r)
  }

  const messages: ParsedMessage[] = []
  for (const messageId of messageOrder) {
    const parts = byMessage.get(messageId)!
    const head = parts[0]

    let role: "user" | "assistant" | "system" = "system"
    try {
      const data = JSON.parse(head.message_data) as { role?: unknown }
      if (data.role === "user" || data.role === "assistant") role = data.role
    } catch {
      // Malformed message envelope — keep going as system; the next
      // turn's role will reset whatever wandered context we built up.
    }

    const content = reconstructMessageContent(parts)
    if (!content) continue // tool-only / no-text turn — drop for v1

    messages.push({
      role,
      content,
      timestamp: isoFromMs(head.message_time_created) ?? undefined,
      metadata: { opencode_message_id: messageId },
    })
  }

  if (messages.length === 0) return null

  return {
    sourceThreadId: `opencode-${row.id}`,
    title: row.title,
    messages,
    createdAt: isoFromMs(row.time_created),
    lastActivityAt: isoFromMs(row.time_updated),
    projectPath: project?.worktree ?? row.directory,
    metadata: {
      // The session id IS the locator for re-parse — store it under
      // `filePath` for compatibility with code that reads sourceLocator
      // expecting a path-shaped string. (parseOne accepts the bare id.)
      filePath: row.id,
      opencodeSessionId: row.id,
      opencodeProjectId: row.project_id,
      opencodeSlug: row.slug,
      opencodeProjectName: project?.name ?? null,
      sourceFormatVersion: "opencode-sqlite-v1",
    },
  }
}

// ─── Discover + parseOne ─────────────────────────────────────────────────────

const SELECT_SESSION_BASE = `
  SELECT id, project_id, parent_id, slug, directory, title,
         time_created, time_updated, time_archived
  FROM session
`

const SELECT_MESSAGES_PARTS = `
  SELECT m.id          AS message_id,
         m.data        AS message_data,
         m.time_created AS message_time_created,
         p.id          AS part_id,
         json_extract(p.data, '$.type') AS part_type,
         p.data        AS part_data,
         p.time_created AS part_time_created
  FROM message m
  LEFT JOIN part p ON p.message_id = m.id
  WHERE m.session_id = ?
  ORDER BY m.time_created ASC, m.id ASC,
           p.time_created ASC, p.id ASC
`

function discoverInternal(): DiscoveryResult {
  const dbPath = resolveOpencodeDbPath()
  if (!dbPath) return { sessions: [], skipped: [] }

  let db: Database.Database
  try {
    db = openOpencodeDb(dbPath)
  } catch (err) {
    return {
      sessions: [],
      skipped: [
        {
          locator: dbPath,
          reason: `could not open OpenCode database: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    }
  }

  const sessions: ParsedSession[] = []
  const skipped: SkippedItem[] = []

  try {
    // Skip archived sessions — OpenCode's UI hides them, so should we.
    const sessionRows = db
      .prepare(
        `${SELECT_SESSION_BASE}
         WHERE time_archived IS NULL
         ORDER BY time_created ASC`
      )
      .all() as SessionRow[]

    const projectRows = db
      .prepare(`SELECT id, worktree, name FROM project`)
      .all() as ProjectRow[]
    const projects = new Map(projectRows.map((p) => [p.id, p]))

    const stmt = db.prepare(SELECT_MESSAGES_PARTS)
    for (const row of sessionRows) {
      try {
        const parts = stmt.all(row.id) as MessagePartRow[]
        const session = buildSession(row, projects.get(row.project_id), parts)
        if (session) sessions.push(session)
        else
          skipped.push({
            locator: `opencode:${row.id}`,
            reason: "no text-bearing messages in session",
          })
      } catch (err) {
        skipped.push({
          locator: `opencode:${row.id}`,
          reason: `parse failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  } finally {
    db.close()
  }

  return { sessions, skipped }
}

function parseOneInternal(sessionId: string): ParseResult {
  const dbPath = resolveOpencodeDbPath()
  if (!dbPath) {
    return {
      ok: false,
      locator: sessionId,
      reason: "OpenCode storage not found on this machine",
    }
  }

  let db: Database.Database
  try {
    db = openOpencodeDb(dbPath)
  } catch (err) {
    return {
      ok: false,
      locator: sessionId,
      reason: `could not open OpenCode database: ${
        err instanceof Error ? err.message : String(err)
      }`,
    }
  }

  try {
    const row = db
      .prepare(`${SELECT_SESSION_BASE} WHERE id = ?`)
      .get(sessionId) as SessionRow | undefined

    if (!row) {
      return {
        ok: false,
        locator: sessionId,
        reason: "session not found in OpenCode database",
      }
    }

    const project = db
      .prepare(`SELECT id, worktree, name FROM project WHERE id = ?`)
      .get(row.project_id) as ProjectRow | undefined

    const parts = db.prepare(SELECT_MESSAGES_PARTS).all(row.id) as MessagePartRow[]
    const session = buildSession(row, project, parts)
    if (!session) {
      return {
        ok: false,
        locator: sessionId,
        reason: "no text-bearing messages in session",
      }
    }
    return { ok: true, session }
  } catch (err) {
    return {
      ok: false,
      locator: sessionId,
      reason: `parse failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    db.close()
  }
}

// ─── ImporterModule export ───────────────────────────────────────────────────

export const opencodeImporter: ImporterModule = {
  id: "opencode",
  // For v1 we treat OpenCode CLI + Desktop as one source — the desktop
  // app writes to the same DB. If a future split materializes (e.g.
  // desktop gets its own db file) we can introduce an `opencode-desktop`
  // enum value and a sibling module without disturbing this one.
  supportsSingleImport: true,

  discover(): DiscoveryResult {
    return discoverInternal()
  },

  parseOne(sessionId: string): ParseResult {
    return parseOneInternal(sessionId)
  },

  deriveMessageMetadata(msg) {
    const id = msg.metadata?.opencode_message_id
    return typeof id === "string" && id ? { opencode_message_id: id } : null
  },
}
