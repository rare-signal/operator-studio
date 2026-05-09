/**
 * Next.js server-startup hook — runs once when the Node server boots.
 *
 * We use it to register the file watcher for Claude Code and Codex
 * session directories (Phase 3 of Session Spaces). When a JSONL file
 * on disk changes, the watcher triggers `importSelectedFiles` so the
 * new turns show up in the UI within ~2 seconds of being written.
 *
 * Without this, users would be stuck waiting for the dashboard's
 * auto-ingest poll (15s) to pick up changes — fine, but not "live."
 *
 * Gotchas:
 * - Only runs on the `nodejs` runtime. Edge routes don't get it.
 * - In dev, Next.js's HMR restart re-runs this file, which re-starts
 *   the watcher. We don't explicitly clean up the previous watcher
 *   because HMR terminates the entire module context — GC handles it.
 * - Serverless runtimes (Vercel, Lambda) have `isWatcherEnabled` guard.
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */

export async function register() {
  // Guard: this file is required to exist at the project root but the
  // body only runs on the Node.js runtime. Skip any other runtime
  // (Edge) to avoid bundler errors on node-only modules.
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // ADO background scheduler — opt-in via OPERATOR_STUDIO_ADO_AUTOPOLL.
  // Best-effort + isolated from the watcher path: a scheduler failure
  // never blocks watcher startup. See lib/operator-studio/ingest/ado-scheduler.ts.
  try {
    const { startAdoBackgroundPoller } = await import(
      "./lib/operator-studio/ingest/ado-scheduler"
    )
    startAdoBackgroundPoller()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[operator-studio] ADO background scheduler failed to start:",
      err instanceof Error ? err.message : String(err)
    )
  }

  // Dynamic imports so Edge/browser bundlers don't see node:fs, pg, etc.
  const { isWatcherEnabled, startFileWatcher } = await import(
    "./lib/operator-studio/watcher"
  )
  const { importFromSource, importSelectedFiles } = await import(
    "./lib/operator-studio/importers"
  )
  const { GLOBAL_WORKSPACE_ID } = await import(
    "./lib/operator-studio/workspaces"
  )

  if (!isWatcherEnabled()) {
    // eslint-disable-next-line no-console
    console.log(
      "[operator-studio] file watcher disabled (OPERATOR_STUDIO_FILE_WATCHER=false or serverless env)"
    )
    return
  }

  // Dev-only registry sanity check: registered importers must be
  // wired up to UI metadata, deep links, and the client-side
  // IMPORTER_SOURCE_IDS constant. Loud warning (not crash) so a stale
  // entry doesn't take down the dev server, but the omission is
  // impossible to miss in the boot log. The full diagnostic lives in
  // `pnpm integrity:importers` for CI / pre-merge use.
  if (process.env.NODE_ENV !== "production") {
    try {
      const { checkImporterRegistry } = await import(
        "./lib/operator-studio/importers/_integrity"
      )
      // Skip the discover() smoke test on startup — Codex can take ~40s
      // on a heavy machine and we don't want to delay server boot. The
      // CLI runs it for thoroughness.
      const report = checkImporterRegistry({ skipDiscoverProbe: true })
      if (report.failures.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[operator-studio] importer-registry integrity check found ${report.failures.length} issue(s):`
        )
        for (const f of report.failures) {
          // eslint-disable-next-line no-console
          console.warn(`  - ${f.name}: ${f.detail}`)
        }
        // eslint-disable-next-line no-console
        console.warn(
          "[operator-studio] run `pnpm integrity:importers` for the full report"
        )
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[operator-studio] integrity check skipped:",
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  const handle = startFileWatcher({
    onChange: async ({ source, filePath, kind }) => {
      try {
        // The watcher fires from chokidar, which runs outside any HTTP
        // request scope — so `cookies()` (and therefore
        // `getActiveWorkspaceId()`) throws here. The watcher is a
        // server-singleton anyway: it can't know which user/workspace
        // the change is "for". Default everything ingested from disk
        // into the global workspace; users can promote/move within
        // the app if they need a private workspace.
        const workspaceId = GLOBAL_WORKSPACE_ID

        // Note: no first-run gate here. chokidar's `ignoreInitial: true`
        // (set in watcher.ts) prevents a big-bang import at startup —
        // we only react to CHANGES after the server boots. Importers
        // are idempotent (append-on-grow), so repeat fires are harmless.
        if (kind === "full-source-resync") {
          // SQLite-backed sources fire one event per db change without
          // identifying which session moved. Re-discover the whole
          // store; ingestSession's append-on-grow handles the diff.
          await importFromSource(workspaceId, source, "file-watcher")
        } else {
          await importSelectedFiles(
            workspaceId,
            [filePath],
            source,
            "file-watcher"
          )
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "[operator-studio/watcher] import failed for",
          filePath,
          "—",
          err instanceof Error ? err.message : err
        )
      }
    },
  })

  if (handle.watchedRoots.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[operator-studio] watching ${handle.watchedRoots.length} session root(s):`,
      handle.watchedRoots.map((r) => `${r.source}=${r.root}`).join(", ")
    )
  } else {
    // eslint-disable-next-line no-console
    console.log(
      "[operator-studio] no session roots to watch — import at least one session first"
    )
  }
}
