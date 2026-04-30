/**
 * Wayseer thread search — terminal-side full-text search across the
 * threads and messages your importers have ingested. Uses the same
 * Postgres `search_tsv` indexes the in-app search uses, so results
 * match what you'd see in /operator-studio/search.
 *
 * Also supports `--recent`, which lists the most recent ingested
 * threads grouped by session — cross-source by default, with
 * optional `--source=X` filter. Mirrors the in-app "Recent" rail.
 *
 * Usage:
 *   pnpm wayseer:search "query"
 *   pnpm wayseer:search "query" --scope=threads --limit=10
 *   pnpm wayseer:search "query" --workspace=global --json
 *   pnpm wayseer:search "query" --base-url=http://localhost:3000
 *   pnpm wayseer:search --recent
 *   pnpm wayseer:search --recent --source=claude-code --limit=5
 *
 * Flags:
 *   --recent                       list recent sessions/threads (no query)
 *   --source=ID                    filter --recent to one source app
 *   --scope=threads|messages|all   default: all  (search mode only)
 *   --limit=N                      default: 20  (max 100)
 *   --workspace=ID                 default: global
 *   --base-url=URL                 default: http://localhost:3000
 *   --json                         raw JSON output (for scripting)
 *   --no-color                     disable ANSI colour
 */

import { getPgPool } from "../lib/server/db/client"
import {
  getRecentSessionsWithThreads,
  searchMessages,
  searchThreads,
} from "../lib/operator-studio/queries"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"

type Scope = "threads" | "messages" | "all"

interface CliOptions {
  query: string | null
  scope: Scope
  limit: number
  workspace: string
  baseUrl: string
  json: boolean
  color: boolean
  recent: boolean
  source: string | null
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`error: ${message}\n`)
  console.error(
    [
      "usage: pnpm wayseer:search \"query\" [flags]",
      "       pnpm wayseer:search --recent [flags]",
      "",
      "flags:",
      "  --recent                       list recent sessions/threads (no query)",
      "  --source=ID                    filter --recent to one source app",
      "  --scope=threads|messages|all   default: all  (search mode only)",
      "  --limit=N                      default: 20  (max 100)",
      "  --workspace=ID                 default: global",
      "  --base-url=URL                 default: http://localhost:3000",
      "  --json                         raw JSON output",
      "  --no-color                     disable ANSI colour",
    ].join("\n")
  )
  process.exit(message ? 1 : 0)
}

function parseArgs(argv: string[]): CliOptions {
  let query: string | null = null
  let scope: Scope = "all"
  let limit = 20
  let workspace = GLOBAL_WORKSPACE_ID
  let baseUrl = process.env.WAYSEER_BASE_URL?.trim() || "http://localhost:3000"
  let json = false
  let color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined
  let recent = false
  let source: string | null = null

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") printUsageAndExit()
    if (raw === "--json") { json = true; continue }
    if (raw === "--no-color") { color = false; continue }
    if (raw === "--recent") { recent = true; continue }
    if (raw.startsWith("--source=")) {
      source = raw.slice("--source=".length).trim() || null
      continue
    }
    if (raw.startsWith("--scope=")) {
      const value = raw.slice("--scope=".length)
      if (value !== "threads" && value !== "messages" && value !== "all") {
        printUsageAndExit(`invalid --scope: ${value}`)
      }
      scope = value
      continue
    }
    if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10)
      if (!Number.isFinite(n) || n < 1) printUsageAndExit("invalid --limit")
      limit = Math.min(n, 100)
      continue
    }
    if (raw.startsWith("--workspace=")) {
      workspace = raw.slice("--workspace=".length).trim() || GLOBAL_WORKSPACE_ID
      continue
    }
    if (raw.startsWith("--base-url=")) {
      baseUrl = raw.slice("--base-url=".length).trim().replace(/\/$/, "")
      continue
    }
    if (raw.startsWith("--")) {
      printUsageAndExit(`unknown flag: ${raw}`)
    }
    if (query === null) {
      query = raw
      continue
    }
    // multi-word query: stitch any extra positional args together so
    // `pnpm wayseer:search hello world` behaves like `"hello world"`.
    query = `${query} ${raw}`
  }

  if (recent) {
    if (query) {
      printUsageAndExit("--recent does not take a query (use search mode instead)")
    }
  } else {
    if (source) {
      printUsageAndExit("--source only applies to --recent mode")
    }
    if (!query || query.trim().length < 2) {
      printUsageAndExit("query required (2+ chars)")
    }
  }

  return {
    query: query ? query.trim() : null,
    scope,
    limit,
    workspace,
    baseUrl,
    json,
    color,
    recent,
    source,
  }
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  underline: "\x1b[4m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
} as const

function colorize(opts: CliOptions, code: keyof typeof ANSI, text: string) {
  if (!opts.color) return text
  return `${ANSI[code]}${text}${ANSI.reset}`
}

/**
 * Postgres ts_headline emits `<mark>…</mark>` around hits. Convert to
 * ANSI underline+bold for terminals, or strip for piped/JSON output.
 */
function renderSnippet(snippet: string | null, opts: CliOptions): string {
  if (!snippet) return ""
  const collapsed = snippet.replace(/\s+/g, " ").trim()
  if (!opts.color) return collapsed.replace(/<\/?mark>/g, "")
  return collapsed
    .replace(/<mark>/g, `${ANSI.bold}${ANSI.yellow}`)
    .replace(/<\/mark>/g, ANSI.reset)
}

function deepLink(opts: CliOptions, threadId: string, messageId?: string): string {
  const base = `${opts.baseUrl}/operator-studio/threads/${threadId}`
  return messageId ? `${base}#msg-${messageId}` : base
}

function formatRank(rank: number): string {
  return rank.toFixed(3)
}

function relativeTime(iso: string): string {
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return "just now"
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatSessionStart(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

async function runRecent(opts: CliOptions) {
  const groups = await getRecentSessionsWithThreads(opts.workspace, opts.limit)

  // Filter threads by source if requested, then drop any sessions
  // that no longer have any matching threads.
  const filtered = opts.source
    ? groups
        .map((g) => ({
          ...g,
          threads: g.threads.filter((t) => t.sourceApp === opts.source),
        }))
        .filter((g) => g.threads.length > 0)
    : groups

  // Most-recent thread first within each session.
  for (const g of filtered) {
    g.threads.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          mode: "recent",
          workspace: opts.workspace,
          source: opts.source,
          sessions: filtered.map((g) => ({
            id: g.session.id,
            label: g.session.label,
            startedAt: g.session.startedAt,
            endedAt: g.session.endedAt,
            threads: g.threads.map((t) => ({
              id: t.id,
              title: t.promotedTitle ?? t.rawTitle,
              sourceApp: t.sourceApp,
              projectSlug: t.projectSlug,
              updatedAt: t.updatedAt,
              url: deepLink(opts, t.id),
            })),
          })),
        },
        null,
        2
      ) + "\n"
    )
    return
  }

  const filterTag = opts.source ? ` · source=${opts.source}` : ""
  const header = colorize(
    opts,
    "dim",
    `wayseer recent · ${opts.workspace}${filterTag}`
  )
  process.stdout.write(`${header}\n\n`)

  if (filtered.length === 0) {
    process.stdout.write(`  ${colorize(opts, "dim", "no recent activity")}\n`)
    return
  }

  for (const { session, threads } of filtered) {
    const heading = `${formatSessionStart(session.startedAt)} · ${threads.length} thread${threads.length === 1 ? "" : "s"}`
    process.stdout.write(`${colorize(opts, "bold", heading)}\n`)
    for (const t of threads) {
      const title = t.promotedTitle ?? t.rawTitle ?? "(untitled thread)"
      const meta = [t.sourceApp, t.projectSlug].filter(Boolean).join(" · ")
      process.stdout.write(
        `  ${colorize(opts, "cyan", title)} ${colorize(opts, "dim", `[${relativeTime(t.updatedAt)}]`)}\n`
      )
      if (meta) process.stdout.write(`    ${colorize(opts, "dim", meta)}\n`)
      process.stdout.write(`    ${colorize(opts, "dim", deepLink(opts, t.id))}\n`)
    }
    process.stdout.write("\n")
  }
}

async function run(opts: CliOptions) {
  if (opts.recent) {
    await runRecent(opts)
    return
  }

  // From here on, search mode — query is guaranteed non-null by parseArgs.
  const query = opts.query as string
  const wantThreads = opts.scope === "threads" || opts.scope === "all"
  const wantMessages = opts.scope === "messages" || opts.scope === "all"

  const [threads, messages] = await Promise.all([
    wantThreads
      ? searchThreads(opts.workspace, query, opts.limit)
      : Promise.resolve([]),
    wantMessages
      ? searchMessages(opts.workspace, query, opts.limit)
      : Promise.resolve([]),
  ])

  if (opts.json) {
    process.stdout.write(
      JSON.stringify(
        {
          query,
          workspace: opts.workspace,
          scope: opts.scope,
          threads: threads.map((t) => ({
            id: t.id,
            title: t.promotedTitle ?? t.rawTitle,
            sourceApp: t.sourceApp,
            projectSlug: t.projectSlug,
            tags: t.tags,
            rank: t.rank,
            snippet: t.snippet,
            url: deepLink(opts, t.id),
          })),
          messages: messages.map((m) => ({
            id: m.id,
            threadId: m.threadId,
            threadTitle: m.threadTitle,
            sourceApp: m.threadSourceApp,
            role: m.role,
            turnIndex: m.turnIndex,
            createdAt: m.createdAt,
            rank: m.rank,
            snippet: m.snippet,
            url: deepLink(opts, m.threadId, m.id),
          })),
        },
        null,
        2
      ) + "\n"
    )
    return
  }

  const header = colorize(opts, "dim", `wayseer · ${opts.workspace} · "${query}"`)
  process.stdout.write(`${header}\n\n`)

  if (wantThreads) {
    const heading = `${threads.length} thread${threads.length === 1 ? "" : "s"}`
    process.stdout.write(`${colorize(opts, "bold", heading)}\n`)
    if (threads.length === 0) {
      process.stdout.write(`  ${colorize(opts, "dim", "no matches")}\n`)
    } else {
      for (const t of threads) {
        const title = t.promotedTitle ?? t.rawTitle ?? "(untitled thread)"
        const meta = [t.sourceApp, t.projectSlug].filter(Boolean).join(" · ")
        process.stdout.write(
          `  ${colorize(opts, "cyan", title)} ${colorize(opts, "dim", `[${formatRank(t.rank)}]`)}\n`
        )
        if (meta) process.stdout.write(`    ${colorize(opts, "dim", meta)}\n`)
        const snippet = renderSnippet(t.snippet, opts)
        if (snippet) process.stdout.write(`    ${snippet}\n`)
        process.stdout.write(`    ${colorize(opts, "dim", deepLink(opts, t.id))}\n`)
      }
    }
    process.stdout.write("\n")
  }

  if (wantMessages) {
    const heading = `${messages.length} message${messages.length === 1 ? "" : "s"}`
    process.stdout.write(`${colorize(opts, "bold", heading)}\n`)
    if (messages.length === 0) {
      process.stdout.write(`  ${colorize(opts, "dim", "no matches")}\n`)
    } else {
      for (const m of messages) {
        const parent = m.threadTitle ?? "(untitled thread)"
        const roleColor = m.role === "user" ? "green" : m.role === "assistant" ? "magenta" : "dim"
        process.stdout.write(
          `  ${colorize(opts, roleColor, `${m.role}@${m.turnIndex}`)} ${colorize(opts, "cyan", parent)} ${colorize(opts, "dim", `[${formatRank(m.rank)}]`)}\n`
        )
        const snippet = renderSnippet(m.snippet, opts)
        if (snippet) process.stdout.write(`    ${snippet}\n`)
        process.stdout.write(`    ${colorize(opts, "dim", deepLink(opts, m.threadId, m.id))}\n`)
      }
    }
    process.stdout.write("\n")
  }
}

const opts = parseArgs(process.argv.slice(2))

run(opts)
  .catch((err) => {
    console.error(colorize(opts, "red", "wayseer search failed:"), err?.message ?? err)
    process.exitCode = 1
  })
  .finally(async () => {
    // The drizzle pool is process-wide; close it so the process can exit.
    try {
      await getPgPool().end()
    } catch {
      /* already ended */
    }
  })
