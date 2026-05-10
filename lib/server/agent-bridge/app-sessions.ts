/**
 * Read helpers for native-app JSONL sessions: Claude Code and Codex.
 *
 * Walks the local data dirs (~/.claude/projects, ~/.codex/sessions)
 * for sessions, parses the tail of each JSONL into a compact turn
 * list, and derives a coarse "status" enum (idle / thinking /
 * streaming / tool-running) the Bento panes can render as a pulse.
 *
 * Mirrors the parsing the gitignored beta `/api/beta/app/*` routes
 * use today, but lives in a non-gitignored module so the in-app
 * Bento command center isn't coupled to the gitignored tree.
 */

import "server-only"

import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"

export type AppSlug = "claude" | "codex"

export interface AppSessionEntry {
  id: string
  app: AppSlug
  project: string | null
  title: string | null
  mtimeMs: number
  mtimeAgeMs: number
  sizeBytes: number
  isLive: boolean
  /** Absolute file path on disk — server-side only, never returned to clients. */
  file: string
}

export interface Turn {
  role: "user" | "assistant" | "system" | "tool"
  at: string | null
  parts: Array<
    | { kind: "text"; text: string }
    | { kind: "image"; note: string }
    | { kind: "tool_use"; name: string; summary: string }
    | { kind: "tool_result"; summary: string }
    | { kind: "thinking"; text: string }
  >
  /** Model id reported by the source app for this turn, when present
   *  (Claude JSONL puts it on `message.model`). Codex JSONL does not
   *  currently expose model per-event, so this stays undefined there.
   *  The Bento UI surfaces it as a subtle suffix on the role label. */
  model?: string
}

export type AppStatus = "idle" | "thinking" | "streaming" | "tool-running"

export function claudeProjectsRoot() {
  return path.join(os.homedir(), ".claude", "projects")
}
export function codexSessionsRoot() {
  return path.join(os.homedir(), ".codex", "sessions")
}

async function listAllJsonl(
  root: string
): Promise<Array<{ file: string; mtimeMs: number; size: number; project: string | null }>> {
  const out: Array<{
    file: string
    mtimeMs: number
    size: number
    project: string | null
  }> = []
  async function walk(dir: string, depth: number, projectHint: string | null) {
    if (depth > 5) return
    let entries: import("fs").Dirent[]
    try {
      entries = (await fs.readdir(dir, {
        withFileTypes: true,
      })) as unknown as import("fs").Dirent[]
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        const nextHint = projectHint ?? e.name
        await walk(full, depth + 1, nextHint)
      } else if (e.isFile() && e.name.endsWith(".jsonl")) {
        try {
          const st = await fs.stat(full)
          out.push({
            file: full,
            mtimeMs: st.mtimeMs,
            size: st.size,
            project: projectHint ?? path.basename(path.dirname(full)),
          })
        } catch {
          /* ignored */
        }
      }
    }
  }
  await walk(root, 0, null)
  return out
}

export async function firstUserText(file: string, app: AppSlug): Promise<string | null> {
  let handle: fs.FileHandle
  try {
    handle = await fs.open(file, "r")
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(16_384)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    const text = buf.subarray(0, bytesRead).toString("utf8")
    const lines = text.split("\n")
    if (bytesRead === buf.length) lines.pop()
    for (const line of lines) {
      if (!line) continue
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        const extracted = extractUserText(obj, app)
        if (extracted) return extracted.slice(0, 120)
      } catch {
        /* keep scanning */
      }
    }
    return null
  } finally {
    await handle.close()
  }
}

function extractUserText(obj: Record<string, unknown>, app: AppSlug): string | null {
  if (app === "claude") {
    if (obj.type !== "user") return null
    const message = obj.message as Record<string, unknown> | undefined
    const content = message?.content
    if (typeof content === "string") return content.trim() || null
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>
          if (b.type === "text" && typeof b.text === "string") {
            const t = b.text.trim()
            if (t) return t
          }
        }
      }
    }
    return null
  }
  if (obj.type !== "event_msg") return null
  const payload = obj.payload as Record<string, unknown> | undefined
  if (payload?.type !== "user_message") return null
  return typeof payload.message === "string" ? payload.message.trim() : null
}

export async function listAppSessions(
  app: AppSlug,
  limit = 30
): Promise<AppSessionEntry[]> {
  const root = app === "codex" ? codexSessionsRoot() : claudeProjectsRoot()
  const files = await listAllJsonl(root)
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const top = files.slice(0, Math.max(1, Math.min(200, limit)))
  const now = Date.now()
  const entries: AppSessionEntry[] = []
  for (const f of top) {
    const id = path.basename(f.file).replace(/\.jsonl$/, "")
    const title = await firstUserText(f.file, app)
    const mtimeAgeMs = Math.max(0, now - f.mtimeMs)
    entries.push({
      id,
      app,
      project: f.project ? f.project.replace(/^-/, "") : null,
      title,
      mtimeMs: f.mtimeMs,
      mtimeAgeMs,
      sizeBytes: f.size,
      isLive: mtimeAgeMs < 5000,
      file: f.file,
    })
  }
  return entries
}

/** Look up a single session entry by id regardless of recency window.
 *  Used by /api/operator-studio/cockpit/spawned-by to enrich worker
 *  bindings whose JSONL has aged past the top-N recent list. Returns
 *  null when the JSONL has been deleted. */
export async function getAppSessionEntry(
  app: AppSlug,
  sessionId: string
): Promise<AppSessionEntry | null> {
  const found = await findAppSessionFile(app, sessionId)
  if (!found) return null
  let sizeBytes = 0
  try {
    const st = await fs.stat(found.file)
    sizeBytes = st.size
  } catch {
    return null
  }
  const title = await firstUserText(found.file, app)
  const project = path.basename(path.dirname(found.file))
  const now = Date.now()
  const mtimeAgeMs = Math.max(0, now - found.mtimeMs)
  return {
    id: sessionId,
    app,
    project: project ? project.replace(/^-/, "") : null,
    title,
    mtimeMs: found.mtimeMs,
    mtimeAgeMs,
    sizeBytes,
    isLive: mtimeAgeMs < 5000,
    file: found.file,
  }
}

// Path cache: keyed by `${app}:${sessionId}`. JSONL files don't move
// once written, so a 5-minute TTL is safe and prevents the SSE stream
// from re-walking ~/.claude/projects on every tick (16 panes × 2 Hz =
// hundreds of recursive readdirs/sec without this). On miss or expiry
// we fall back to the directory walk, then refresh the entry's mtime
// from the resolved file. If the file was deleted, we drop the cached
// entry on the next stat failure inside the caller.
interface FilePathCacheEntry {
  file: string
  mtimeMs: number
  expiresAt: number
}
const FILE_PATH_CACHE = new Map<string, FilePathCacheEntry>()
const FILE_PATH_TTL_MS = 5 * 60_000

export async function findAppSessionFile(
  app: AppSlug,
  sessionId: string
): Promise<{ file: string; mtimeMs: number } | null> {
  const cacheKey = `${app}:${sessionId}`
  const now = Date.now()
  const cached = FILE_PATH_CACHE.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    try {
      const st = await fs.stat(cached.file)
      cached.mtimeMs = st.mtimeMs
      return { file: cached.file, mtimeMs: st.mtimeMs }
    } catch {
      // File vanished — drop and fall through to full search.
      FILE_PATH_CACHE.delete(cacheKey)
    }
  }
  const root = app === "codex" ? codexSessionsRoot() : claudeProjectsRoot()
  const target = `${sessionId}.jsonl`
  let hit: { file: string; mtimeMs: number } | null = null
  async function walk(dir: string, depth: number) {
    if (hit || depth > 5) return
    let entries: import("fs").Dirent[]
    try {
      entries = (await fs.readdir(dir, {
        withFileTypes: true,
      })) as unknown as import("fs").Dirent[]
    } catch {
      return
    }
    for (const e of entries) {
      if (hit) return
      if (e.name.startsWith(".")) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (e.isFile() && e.name === target) {
        try {
          const st = await fs.stat(full)
          hit = { file: full, mtimeMs: st.mtimeMs }
        } catch {
          /* ignored */
        }
      }
    }
  }
  await walk(root, 0)
  // TS can't see the closure mutation, so re-bind through a local.
  const resolved = hit as { file: string; mtimeMs: number } | null
  if (resolved) {
    FILE_PATH_CACHE.set(cacheKey, {
      file: resolved.file,
      mtimeMs: resolved.mtimeMs,
      expiresAt: now + FILE_PATH_TTL_MS,
    })
  }
  return resolved
}

async function tailLines(file: string, maxBytes = 2_000_000): Promise<string[]> {
  const handle = await fs.open(file, "r")
  try {
    const stat = await handle.stat()
    const size = stat.size
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, start)
    const text = buf.toString("utf8")
    const lines = text.split("\n")
    if (start > 0) lines.shift()
    return lines.filter(Boolean)
  } finally {
    await handle.close()
  }
}

function parseClaudeTurn(obj: Record<string, unknown>): Turn | null {
  const type = obj.type
  if (type !== "user" && type !== "assistant" && type !== "system") return null
  const timestamp = typeof obj.timestamp === "string" ? obj.timestamp : null
  const message = obj.message as Record<string, unknown> | undefined
  const parts: Turn["parts"] = []
  function ingestContent(content: unknown) {
    if (typeof content === "string") {
      if (content.trim().length > 0) parts.push({ kind: "text", text: content })
      return
    }
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (!block || typeof block !== "object") continue
      const b = block as Record<string, unknown>
      const t = b.type
      if (t === "text" && typeof b.text === "string") {
        parts.push({ kind: "text", text: b.text })
      } else if (t === "thinking" && typeof b.thinking === "string") {
        parts.push({ kind: "thinking", text: b.thinking })
      } else if (t === "image") {
        parts.push({ kind: "image", note: "(image omitted)" })
      } else if (t === "tool_use") {
        const name = typeof b.name === "string" ? b.name : "tool"
        const input = b.input ?? {}
        const summary =
          typeof input === "object"
            ? JSON.stringify(input).slice(0, 200)
            : String(input).slice(0, 200)
        parts.push({ kind: "tool_use", name, summary })
      } else if (t === "tool_result") {
        const out =
          typeof b.content === "string"
            ? b.content
            : JSON.stringify(b.content ?? "").slice(0, 400)
        parts.push({ kind: "tool_result", summary: out.slice(0, 400) })
      }
    }
  }
  if (type === "user" || type === "assistant") {
    if (message && message.content !== undefined) ingestContent(message.content)
    else if (typeof obj.content === "string") ingestContent(obj.content)
  } else if (type === "system") {
    return null
  }
  if (parts.length === 0) return null
  // Claude's protocol echoes tool results as `type: "user"` turns whose
  // only content is tool_result blocks. Relabel them so the bento UI
  // doesn't show "USER" next to "← ran some-tool" output.
  let role: Turn["role"] = type as Turn["role"]
  if (
    role === "user" &&
    parts.every((p) => p.kind === "tool_result" || p.kind === "tool_use")
  ) {
    role = "tool"
  }
  const model =
    typeof message?.model === "string" && message.model.length > 0
      ? message.model
      : undefined
  return { role, at: timestamp, parts, model }
}

function parseCodexTurn(obj: Record<string, unknown>): Turn | null {
  if (obj.type !== "event_msg" || !obj.payload) return null
  const payload = obj.payload as Record<string, unknown>
  const ptype = payload.type
  const at = typeof obj.timestamp === "string" ? obj.timestamp : null
  const text = typeof payload.message === "string" ? payload.message : ""
  if (!text) return null
  if (ptype === "user_message") {
    return { role: "user", at, parts: [{ kind: "text", text }] }
  }
  if (ptype === "agent_message") {
    return { role: "assistant", at, parts: [{ kind: "text", text }] }
  }
  return null
}

function codexRawStatus(
  obj: Record<string, unknown> | null
): AppStatus | null {
  if (!obj) return null
  const type = obj.type
  const payload =
    obj.payload && typeof obj.payload === "object"
      ? (obj.payload as Record<string, unknown>)
      : null
  const ptype = typeof payload?.type === "string" ? payload.type : null
  if (type === "response_item") {
    const itemType = typeof payload?.type === "string" ? payload.type : null
    if (itemType === "reasoning") return "thinking"
    if (itemType === "function_call") return "tool-running"
    if (itemType === "message") return "streaming"
  }
  if (type === "event_msg") {
    if (ptype === "user_message") return "thinking"
    if (ptype === "agent_message") return "streaming"
    if (ptype === "token_count") return "thinking"
    if (ptype?.includes("exec_command") || ptype?.includes("tool")) {
      return ptype.includes("end") || ptype.includes("output")
        ? "thinking"
        : "tool-running"
    }
  }
  return null
}

export interface AppSessionTail {
  app: AppSlug
  file: string
  fileMtime: string
  mtimeAgeMs: number
  pendingBytes: number
  status: AppStatus
  turns: Turn[]
}

/** Tail and parse a JSONL file. Honors `limit` for the number of
 *  most-recent turns to keep. Resolves the file by id when sessionId
 *  is set; otherwise picks the most-recent JSONL under the app root. */
export async function getAppSessionTail(
  app: AppSlug,
  sessionId: string,
  limit = 40
): Promise<AppSessionTail | { error: string; status: number }> {
  const found = await findAppSessionFile(app, sessionId)
  if (!found) return { error: `Session not found: ${sessionId}`, status: 404 }
  let lines: string[]
  let pendingBytes = 0
  try {
    lines = await tailLines(found.file)
    const handle = await fs.open(found.file, "r")
    try {
      const stat = await handle.stat()
      const lookback = Math.min(stat.size, 8192)
      if (lookback > 0) {
        const buf = Buffer.alloc(lookback)
        await handle.read(buf, 0, lookback, stat.size - lookback)
        const lastNl = buf.lastIndexOf(0x0a)
        pendingBytes = lastNl < 0 ? lookback : lookback - 1 - lastNl
      }
    } finally {
      await handle.close()
    }
  } catch (e) {
    return {
      error: `tail failed: ${e instanceof Error ? e.message : "unknown"}`,
      status: 500,
    }
  }

  const turns: Turn[] = []
  let lastRawStatus: AppStatus | null = null
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (app === "codex") {
        const rs = codexRawStatus(obj)
        if (rs) lastRawStatus = rs
      }
      const t = app === "codex" ? parseCodexTurn(obj) : parseClaudeTurn(obj)
      if (t) turns.push(t)
    } catch {
      /* skip malformed */
    }
  }
  const safeLimit = Math.max(4, Math.min(200, limit))
  const tail = turns.slice(-safeLimit)

  const mtimeAgeMs = Math.max(0, Date.now() - found.mtimeMs)
  const lastTurn = turns[turns.length - 1] ?? null
  const lastIsUser = lastTurn?.role === "user"
  const lastHasToolUse =
    lastTurn?.role === "assistant" &&
    lastTurn.parts.some((p) => p.kind === "tool_use")
  const lastTurnIsTerminalAssistant =
    lastTurn?.role === "assistant" &&
    !lastHasToolUse &&
    lastTurn.parts.some((p) => p.kind === "text")

  let status: AppStatus
  if (pendingBytes > 0) {
    status = lastIsUser ? "thinking" : "streaming"
  } else if (app === "codex" && mtimeAgeMs < 15_000 && lastRawStatus) {
    status = lastRawStatus === "idle" ? "thinking" : lastRawStatus
  } else if (mtimeAgeMs < 2000) {
    if (lastIsUser) status = "thinking"
    else if (lastHasToolUse) status = "tool-running"
    else status = "streaming"
  } else if (lastIsUser) {
    status = "thinking"
  } else if (lastTurnIsTerminalAssistant) {
    status = "idle"
  } else if (lastHasToolUse) {
    status = "tool-running"
  } else {
    status = "idle"
  }

  return {
    app,
    file: path.basename(found.file),
    fileMtime: new Date(found.mtimeMs).toISOString(),
    mtimeAgeMs,
    pendingBytes,
    status,
    turns: tail,
  }
}
