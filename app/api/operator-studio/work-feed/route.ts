import { NextResponse, type NextRequest } from "next/server"
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getDb } from "@/lib/server/db/client"
import {
  operatorThreadMessages,
  operatorThreads,
} from "@/lib/server/db/schema"
import {
  getSessionById,
  getSessionsForWorkspace,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const PREVIEW_CHARS = 240

/**
 * GET /api/operator-studio/work-feed
 *
 * Compact "what's flowing in right now" feed, scoped to a single work
 * session. Returns the most recent messages across every thread that
 * touched the session window — newest first. Powers the portable
 * `<WorkOverview>` panel: card modal today, canvas hover card and Plan
 * side rail tomorrow.
 *
 * Query params:
 *   ?sessionId=<id>   — explicit session. Default: most-recent
 *                       within the last 3h (live), else newest.
 *   ?limit=<n>        — clamp [1, 100], default 30.
 *
 * Designed to be cheap enough to poll every ~8s while a card modal
 * is open: one indexed range scan + a small thread-title batch read.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()

  const sessionParam = req.nextUrl.searchParams.get("sessionId")
  const limitRaw = Number(req.nextUrl.searchParams.get("limit"))
  const limit = Number.isFinite(limitRaw) && limitRaw > 0
    ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
    : DEFAULT_LIMIT

  // Resolve the session window. Same heuristic as the fulfill endpoint:
  // prefer one that's still warm (last 3h), else the newest session
  // overall. Returning a payload with `session: null` is valid — the
  // client just renders the empty state.
  let session = sessionParam
    ? await getSessionById(workspaceId, sessionParam)
    : null
  if (!session) {
    const sessions = await getSessionsForWorkspace(workspaceId)
    if (sessions.length > 0) {
      const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000
      session =
        sessions.find(
          (s) => new Date(s.endedAt).getTime() >= threeHoursAgo
        ) ?? sessions[0]
    }
  }
  if (!session) {
    return NextResponse.json({ session: null, items: [] })
  }

  const db = getDb()
  // Latest-first windowed pull, capped to `limit`. Indexed by
  // (workspaceId, createdAt) so this stays O(log N + limit).
  const rows = await db
    .select({
      id: operatorThreadMessages.id,
      threadId: operatorThreadMessages.threadId,
      role: operatorThreadMessages.role,
      content: operatorThreadMessages.content,
      createdAt: operatorThreadMessages.createdAt,
    })
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        gte(operatorThreadMessages.createdAt, new Date(session.startedAt)),
        lte(operatorThreadMessages.createdAt, new Date(session.endedAt))
      )
    )
    .orderBy(desc(operatorThreadMessages.createdAt))
    .limit(limit)

  // Batch the thread-title lookup — one query for every unique thread
  // referenced by the message slice rather than N individual reads.
  const threadIds = Array.from(new Set(rows.map((r) => r.threadId)))
  const threadRows = threadIds.length
    ? await db
        .select({
          id: operatorThreads.id,
          rawTitle: operatorThreads.rawTitle,
          promotedTitle: operatorThreads.promotedTitle,
          sourceApp: operatorThreads.sourceApp,
        })
        .from(operatorThreads)
        .where(
          and(
            eq(operatorThreads.workspaceId, workspaceId),
            inArray(operatorThreads.id, threadIds)
          )
        )
    : []
  const threadById = new Map(threadRows.map((t) => [t.id, t]))

  const items = rows.map((r) => {
    const thread = threadById.get(r.threadId)
    return {
      messageId: r.id,
      threadId: r.threadId,
      threadTitle:
        thread?.promotedTitle ?? thread?.rawTitle ?? "Untitled thread",
      sourceApp: thread?.sourceApp ?? null,
      role: r.role,
      preview:
        r.content.length > PREVIEW_CHARS
          ? r.content.slice(0, PREVIEW_CHARS).trimEnd() + "…"
          : r.content,
      createdAt: r.createdAt.toISOString(),
    }
  })

  return NextResponse.json({
    session: {
      id: session.id,
      label: session.label,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    },
    items,
  })
}
