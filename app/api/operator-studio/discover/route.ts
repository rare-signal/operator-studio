import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  findThreadBySourceKey,
  getThreadsBySource,
} from "@/lib/operator-studio/queries"
import {
  getImporter,
  importSelectedFiles,
  type ParsedSession,
} from "@/lib/operator-studio/importers"
import type { OperatorSourceApp } from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

// ─── Auto-ingest throttle ────────────────────────────────────────────────
//
// `parseAll(source)` synchronously scans the entire session-root for that
// importer (hundreds of multi-MB JSONL files for active users) and the
// follow-up `importSelectedFiles` re-imports every path. Both clients
// (dashboard.tsx, pulse-view.tsx) poll every 15s, and a tab can mount
// both. Without a server-side guard, requests pile up faster than they
// drain — Node is single-threaded, so one stuck claude scan starves the
// rest of the API.
//
// Per-(workspace, source) coalescing: while a sync is running, every new
// caller awaits the same promise instead of kicking another scan. After
// it resolves we cache the result for COOLDOWN_MS so back-to-back polls
// from different components return immediately. Tunable via env if you
// need to tighten it.
const COOLDOWN_MS = Number(
  process.env.OS_DISCOVER_SYNC_COOLDOWN_MS ?? 30_000
)
type SyncResultBody = Record<string, unknown>
type SyncCacheEntry = {
  inflight: Promise<SyncResultBody> | null
  result: SyncResultBody | null
  resultAt: number
}
const SYNC_CACHE: Map<string, SyncCacheEntry> = new Map()
function syncCacheKey(workspaceId: string, source: string): string {
  return `${workspaceId}::${source}`
}

export interface DiscoveredSession {
  sourceThreadId: string
  title: string
  messageCount: number
  filePath: string | null
  projectHint: string | null
  createdAt: string | null
  lastActivityAt: string | null
  sourceApp: OperatorSourceApp
  /** True if a thread with this sourceThreadKey already exists in the workspace. */
  alreadyImported: boolean
  /** Set when alreadyImported=true — the in-DB thread id. */
  existingThreadId: string | null
  /** Set when alreadyImported=true — our stored messageCount. Letting the UI
   *  show "N new messages upstream" when the on-disk session grew. */
  existingMessageCount: number | null
}

function toPreview(
  s: ParsedSession,
  sourceApp: OperatorSourceApp
): Omit<DiscoveredSession, "alreadyImported" | "existingThreadId" | "existingMessageCount"> {
  return {
    sourceThreadId: s.sourceThreadId,
    title: s.title,
    messageCount: s.messages.length,
    filePath:
      ((s.metadata as Record<string, unknown>)?.filePath as string) ?? null,
    projectHint: s.projectPath ?? null,
    createdAt: s.createdAt,
    lastActivityAt: s.lastActivityAt,
    sourceApp,
  }
}

function parseAll(source: OperatorSourceApp): ParsedSession[] {
  const importer = getImporter(source)
  if (!importer) {
    throw new Error(`Local discovery isn't wired up for "${source}"`)
  }
  // Skip telemetry is intentionally dropped here — the discover preview
  // only surfaces "what would import." The actual import call goes
  // through `importSelectedFiles`, which carries the skip details into
  // its ImportResult.
  return importer.discover().sessions
}

function parseFile(
  source: OperatorSourceApp,
  filePath: string
): ParsedSession | null {
  const importer = getImporter(source)
  if (!importer || !importer.supportsSingleImport) return null
  const result = importer.parseOne(filePath)
  return result.ok ? result.session : null
}

/**
 * GET /api/operator-studio/discover?source=claude
 *
 * Scans the filesystem and tags each result with whether it's already in
 * the workspace — plus the existing thread id and messageCount so the UI
 * can show "already imported" and "N new messages upstream" labels.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const source = req.nextUrl.searchParams.get(
    "source"
  ) as OperatorSourceApp | null
  if (!source) {
    return NextResponse.json(
      { error: "Provide ?source=claude|codex" },
      { status: 400 }
    )
  }

  const workspaceId = await getActiveWorkspaceId()

  let raw: ParsedSession[] = []
  try {
    raw = parseAll(source)
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : `Discovery failed for ${source}`,
        sessions: [],
      },
      { status: 400 }
    )
  }

  // Cross-reference with DB to tag already-imported sessions.
  const previews = await Promise.all(
    raw.map(async (s) => {
      const existing = await findThreadBySourceKey(
        workspaceId,
        source,
        s.sourceThreadId
      )
      const base = toPreview(s, source)
      return {
        ...base,
        alreadyImported: !!existing,
        existingThreadId: existing?.id ?? null,
        existingMessageCount: existing?.messageCount ?? null,
      } satisfies DiscoveredSession
    })
  )

  previews.sort((a, b) => {
    const da = a.lastActivityAt ?? a.createdAt ?? ""
    const dbb = b.lastActivityAt ?? b.createdAt ?? ""
    return dbb.localeCompare(da)
  })

  return NextResponse.json({
    sessions: previews,
    count: previews.length,
    newCount: previews.filter((p) => !p.alreadyImported).length,
  })
}

/**
 * POST /api/operator-studio/discover  body: {source, mode: "sync"}
 *
 * Auto-ingest mode used by the dashboard's background poll. Ingests every
 * brand-new session (alreadyImported=false). Skips anything already in the
 * DB to respect the "never overwrite" rule. Returns counts.
 *
 * Gated behind a first-run check: if the workspace has ZERO existing
 * threads from this source, we do NOT auto-ingest — that avoids a
 * surprise big-bang import of historical sessions. The user must do the
 * first bulk ingest explicitly via the Discover UI.
 */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const source = body?.source as OperatorSourceApp | undefined
  const mode = body?.mode
  const importHistorical = body?.importHistorical === true

  if (!source || mode !== "sync") {
    return NextResponse.json(
      { error: "Body must be {source, mode: \"sync\"}" },
      { status: 400 }
    )
  }

  const workspaceId = await getActiveWorkspaceId()

  // Coalesce concurrent polls and serve a recent result without re-scanning.
  // See COOLDOWN_MS notes above.
  const cacheKey = syncCacheKey(workspaceId, source)
  const entry: SyncCacheEntry = SYNC_CACHE.get(cacheKey) ?? {
    inflight: null,
    result: null,
    resultAt: 0,
  }
  if (!SYNC_CACHE.has(cacheKey)) SYNC_CACHE.set(cacheKey, entry)

  if (entry.inflight) {
    const cached = await entry.inflight
    return NextResponse.json({ ...cached, coalesced: true })
  }
  if (
    entry.result &&
    Date.now() - entry.resultAt < COOLDOWN_MS &&
    !importHistorical
  ) {
    return NextResponse.json({ ...entry.result, cached: true })
  }

  const work = (async (): Promise<SyncResultBody> => {
    return runSync(workspaceId, source, importHistorical, auth.identity)
  })()
  entry.inflight = work
  try {
    const body = await work
    entry.result = body
    entry.resultAt = Date.now()
    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : `Discovery failed for ${source}`,
      },
      { status: 400 }
    )
  } finally {
    entry.inflight = null
  }
}

async function runSync(
  workspaceId: string,
  source: OperatorSourceApp,
  importHistorical: boolean,
  identity: string | null | undefined
): Promise<SyncResultBody> {
  // First-run policy: the cautious default is "don't auto-import any
  // history until the user explicitly opts in." But that traps current
  // work — if you've never imported Codex but are using it today, your
  // Apr 22 session stays invisible. Compromise: when workspace has 0
  // threads from source, still import sessions with RECENT activity
  // (default last 48h) so today's work flows. Historical bulk import
  // still requires an explicit Discover click.
  const existingForSource = await getThreadsBySource(workspaceId, source)
  const isFirstRun = existingForSource.length === 0

  // Scan disk.
  const raw: ParsedSession[] = parseAll(source)

  // Collect every discoverable path. When this is a first-run workspace
  // for the source, filter to recent activity only (last 48h) so we
  // don't big-bang-import years of history. When the workspace has
  // already imported from this source, send everything through —
  // ingestSession's append-on-grow handles ongoing conversations.
  const RECENT_CUTOFF_MS = 48 * 60 * 60 * 1000
  const cutoff = Date.now() - RECENT_CUTOFF_MS
  const allPaths: string[] = []
  let skippedAsHistorical = 0
  for (const session of raw) {
    const filePath = (session.metadata as Record<string, unknown>)?.filePath as
      | string
      | undefined
    if (!filePath) continue
    if (isFirstRun && !importHistorical) {
      const last = session.lastActivityAt ?? session.createdAt
      const lastT = last ? new Date(last).getTime() : NaN
      if (!Number.isFinite(lastT) || lastT < cutoff) {
        skippedAsHistorical++
        continue
      }
    }
    allPaths.push(filePath)
  }

  if (allPaths.length === 0) {
    return {
      ok: true,
      imported: 0,
      deduped: 0,
      appended: 0,
      appendedMessages: 0,
      skippedAsHistorical,
      firstRun: isFirstRun,
      errors: [],
      scanned: raw.length,
    }
  }

  // Delegate to importSelectedFiles which respects ingestSession's
  // idempotent+append contract (created / deduped / appended).
  const actor = identity ?? (await getDisplayName()) ?? "auto-ingest"
  const result = await importSelectedFiles(
    workspaceId,
    allPaths,
    source,
    actor
  )

  return {
    ok: true,
    imported: result.threadCount,
    deduped: result.dedupedCount,
    appended: result.appendedCount ?? 0,
    appendedMessages: result.appendedMessages ?? 0,
    skippedAsHistorical,
    firstRun: isFirstRun,
    errors: result.errors,
    scanned: raw.length,
  }
}

/**
 * Re-parse a specific file and return what's on disk vs what we have stored.
 * Used by the thread detail staleness banner.
 */
export async function PATCH(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const source = body?.source as OperatorSourceApp | undefined
  const filePath = body?.filePath as string | undefined

  if (!source || !filePath) {
    return NextResponse.json(
      { error: "Body must be {source, filePath}" },
      { status: 400 }
    )
  }

  try {
    const parsed = parseFile(source, filePath)
    if (!parsed) {
      return NextResponse.json(
        {
          error: `File import isn't wired up for "${source}" — cannot re-parse to check for upstream changes.`,
        },
        { status: 400 }
      )
    }
    return NextResponse.json({
      sourceThreadId: parsed.sourceThreadId,
      messageCount: parsed.messages.length,
      lastActivityAt: parsed.lastActivityAt,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : `Failed to re-parse ${filePath}`,
      },
      { status: 400 }
    )
  }
}
