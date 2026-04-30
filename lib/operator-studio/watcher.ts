/**
 * File watcher — near-live ingestion from Claude Code and Codex session
 * directories. Started once per server process via instrumentation.ts
 * and survives for the lifetime of the Node server.
 *
 * Architecture:
 *
 * - Watches the same directories the importers scan
 *   (getClaudeSessionRoots / getCodexSessionRoots). On JSONL or JSON
 *   file changes, imports the file via importSelectedFiles. The import
 *   path is idempotent (ingestSession upserts by sourceThreadKey), so
 *   repeated events are harmless.
 *
 * - Events are debounced per-path for 2s. A streaming JSONL write from
 *   Claude Code fires many "change" events as turns land; the debounce
 *   collapses them into one import per file burst.
 *
 * - Uses chokidar for cross-platform recursive watching.
 *   node:fs.watch(recursive: true) doesn't work on Linux — chokidar
 *   handles the platform differences for us.
 *
 * - Gated behind OPERATOR_STUDIO_FILE_WATCHER env var (default "true").
 *   Set to "false" to disable — useful for CI or for users who prefer
 *   polling.
 *
 * - Skipped automatically in serverless runtimes (Vercel, etc.) where
 *   a persistent watcher can't hold state between invocations. The
 *   dashboard's 60s → 15s poll is the fallback there.
 */

import chokidar, { type FSWatcher } from "chokidar"
import path from "node:path"

import { getClaudeSessionRoots } from "./importers/claude-code"
import { getCodexSessionRoots } from "./importers/codex"
import { getOpencodeStorageRoots } from "./importers/opencode"
import type { OperatorSourceApp } from "./types"

const DEBOUNCE_MS = 2000

/**
 * Per-source change semantics. Most sources are file-per-session
 * (Claude Code, Codex) — the changed file maps 1:1 to a session, so
 * the consumer ingests just that path. SQLite-backed sources (OpenCode)
 * have one db file shared across all sessions; a change there means
 * "something happened, re-discover" rather than "this specific session
 * grew." The consumer routes on `kind` to call the right importer
 * entry point.
 */
export type ChangeKind = "single-file" | "full-source-resync"

type ChangeHandler = (args: {
  source: OperatorSourceApp
  filePath: string
  kind: ChangeKind
}) => Promise<void> | void

interface WatcherOptions {
  /**
   * Called when a watched file settles (finish of a debounced burst).
   * Receives the source and the absolute file path. The handler is
   * expected to be idempotent — the watcher will fire repeatedly for
   * append-only JSONLs as new turns land.
   */
  onChange: ChangeHandler
  /**
   * Called when the watcher encounters a non-fatal error (permissions,
   * missing dir). Logs to console by default.
   */
  onError?: (err: Error) => void
}

export interface WatcherHandle {
  /** Close all watchers. Callable multiple times safely. */
  stop: () => Promise<void>
  /** Roots we're actively watching, for status display. */
  watchedRoots: Array<{ source: OperatorSourceApp; root: string }>
}

/**
 * Start watching Claude Code and Codex session roots. Returns a handle
 * with a stop() function for graceful shutdown.
 *
 * Safe to call when the roots don't exist — chokidar silently ignores
 * missing paths and will pick them up if they're created later.
 */
export function startFileWatcher(opts: WatcherOptions): WatcherHandle {
  const onError =
    opts.onError ??
    ((err) => {
      // eslint-disable-next-line no-console
      console.error("[operator-studio/watcher] error:", err.message)
    })

  const claudeRoots = getClaudeSessionRoots()
  const codexRoots = getCodexSessionRoots()
  const opencodeRoots = getOpencodeStorageRoots()

  // Each watched root carries both its source app and its change-kind
  // so the per-event filter + dispatch can route correctly. File-per-
  // session sources fire on jsonl/json paths; OpenCode fires on the
  // single shared `opencode.db` file (the .db-wal / .db-shm sidecars
  // are filtered out — they flap on every WAL flush and don't add
  // information beyond the .db change itself).
  const watchedRoots: Array<{
    source: OperatorSourceApp
    root: string
    kind: ChangeKind
  }> = [
    ...claudeRoots.map((r) => ({
      source: "claude" as OperatorSourceApp,
      root: r,
      kind: "single-file" as ChangeKind,
    })),
    ...codexRoots.map((r) => ({
      source: "codex" as OperatorSourceApp,
      root: r,
      kind: "single-file" as ChangeKind,
    })),
    ...opencodeRoots.map((r) => ({
      source: "opencode" as OperatorSourceApp,
      root: r,
      kind: "full-source-resync" as ChangeKind,
    })),
  ]

  if (watchedRoots.length === 0) {
    // Nothing to watch — return a noop handle. Don't throw, because
    // fresh installs often have no session directories yet and that's
    // perfectly fine (poll will pick up activity once it appears).
    return {
      stop: async () => {},
      watchedRoots: [],
    }
  }

  const watchers: FSWatcher[] = []
  // Per-path debounce timers. We key by filePath rather than root so
  // concurrent writes to two different sessions don't starve each
  // other.
  const timers = new Map<string, NodeJS.Timeout>()

  function isInteresting(
    source: OperatorSourceApp,
    filePath: string
  ): boolean {
    if (source === "opencode") {
      // Only the main db file. The -wal / -shm sidecars and the
      // session_diff/snapshot trees fire constantly during normal
      // operation; we don't need any of them to know "something changed."
      return path.basename(filePath) === "opencode.db"
    }
    // Claude Code, Codex: conversation files only.
    const ext = path.extname(filePath).toLowerCase()
    return ext === ".jsonl" || ext === ".json"
  }

  function schedule(
    source: OperatorSourceApp,
    filePath: string,
    kind: ChangeKind
  ) {
    if (!isInteresting(source, filePath)) return

    // Debounce-key: file path for single-file changes; source-prefixed
    // for full-source-resync events so a flurry of WAL flushes against
    // one db collapses into one resync per debounce window.
    const key = kind === "full-source-resync" ? `${source}:resync` : filePath
    const existing = timers.get(key)
    if (existing) clearTimeout(existing)
    timers.set(
      key,
      setTimeout(async () => {
        timers.delete(key)
        try {
          await opts.onChange({ source, filePath, kind })
        } catch (err) {
          onError(
            err instanceof Error
              ? err
              : new Error(`onChange failed: ${String(err)}`)
          )
        }
      }, DEBOUNCE_MS)
    )
  }

  for (const { source, root, kind } of watchedRoots) {
    const w = chokidar.watch(root, {
      // Ignore dotfiles except our targets — .claude/projects is fine
      // because we pass the full path, but temp/swap files aren't.
      ignored: (p) =>
        /(^|[/\\])\.(?!claude|codex)/.test(p) ||
        /~$/.test(p) ||
        /\.swp$/.test(p),
      // Don't fire for files that already exist when we start — we're
      // about changes, not inventory. The importer's on-demand poll
      // handles first-run discovery.
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      persistent: true,
    })

    w.on("add", (p) => schedule(source, p, kind))
    w.on("change", (p) => schedule(source, p, kind))
    w.on("error", (err) => {
      onError(err instanceof Error ? err : new Error(String(err)))
    })

    watchers.push(w)
  }

  return {
    stop: async () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
      await Promise.all(watchers.map((w) => w.close()))
    },
    watchedRoots,
  }
}

/**
 * Should the watcher run? Gated by env var (default on) and skipped in
 * known serverless environments where persistent watchers don't survive.
 */
export function isWatcherEnabled(): boolean {
  if (process.env.OPERATOR_STUDIO_FILE_WATCHER === "false") return false
  // Vercel / common serverless platforms — watchers can't hold state.
  if (process.env.VERCEL === "1") return false
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false
  return true
}
