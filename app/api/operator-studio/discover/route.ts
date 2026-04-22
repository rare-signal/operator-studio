import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  discoverClaudeSessions,
  parseClaudeFile,
  type ParsedClaudeSession,
} from "@/lib/operator-studio/importers/claude-code"
import {
  discoverCodexSessions,
  parseCodexFile,
  type ParsedCodexSession,
} from "@/lib/operator-studio/importers/codex"
import {
  findThreadBySourceKey,
  getThreadsBySource,
} from "@/lib/operator-studio/queries"
import { importSelectedFiles } from "@/lib/operator-studio/importers"
import type { OperatorSourceApp } from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

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
  s: ParsedClaudeSession | ParsedCodexSession,
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

type ParsedSession = ParsedClaudeSession | ParsedCodexSession

function parseAll(source: OperatorSourceApp): ParsedSession[] {
  switch (source) {
    case "claude":
    case "claude-code":
      return discoverClaudeSessions()
    case "codex":
      return discoverCodexSessions()
    default:
      throw new Error(`Local discovery isn't wired up for "${source}"`)
  }
}

function parseFile(
  source: OperatorSourceApp,
  filePath: string
): ParsedSession | null {
  switch (source) {
    case "claude":
    case "claude-code":
      return parseClaudeFile(filePath)
    case "codex":
      return parseCodexFile(filePath)
    default:
      return null
  }
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

  if (!source || mode !== "sync") {
    return NextResponse.json(
      { error: "Body must be {source, mode: \"sync\"}" },
      { status: 400 }
    )
  }

  const workspaceId = await getActiveWorkspaceId()

  // First-run gate: never auto-ingest if the user has never imported from
  // this source in this workspace. They click Discover manually once to
  // opt in, then subsequent polls auto-ingest new arrivals only.
  const existingForSource = await getThreadsBySource(workspaceId, source)
  if (existingForSource.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: "first-run",
      reason:
        "Workspace has no threads from this source yet. Click Discover to opt in; future polls will auto-import new sessions.",
      imported: 0,
      deduped: 0,
      errors: [],
    })
  }

  // Scan disk.
  let raw: ParsedSession[] = []
  try {
    raw = parseAll(source)
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : `Discovery failed for ${source}`,
      },
      { status: 400 }
    )
  }

  // Filter to brand-new sessions.
  const newPaths: string[] = []
  for (const session of raw) {
    const existing = await findThreadBySourceKey(
      workspaceId,
      source,
      session.sourceThreadId
    )
    if (existing) continue
    const filePath = (session.metadata as Record<string, unknown>)?.filePath as
      | string
      | undefined
    if (filePath) newPaths.push(filePath)
  }

  if (newPaths.length === 0) {
    return NextResponse.json({
      ok: true,
      imported: 0,
      deduped: 0,
      errors: [],
      scanned: raw.length,
    })
  }

  // Delegate to importSelectedFiles which respects ingestSession's
  // idempotent contract (so even if two polls race, second one just dedupes).
  const actor = auth.identity ?? (await getDisplayName()) ?? "auto-ingest"
  const result = await importSelectedFiles(
    workspaceId,
    newPaths,
    source,
    actor
  )

  return NextResponse.json({
    ok: true,
    imported: result.threadCount,
    deduped: result.dedupedCount,
    errors: result.errors,
    scanned: raw.length,
  })
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
