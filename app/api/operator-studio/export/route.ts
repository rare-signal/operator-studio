/**
 * GET /api/operator-studio/export
 *
 * Workspace JSON dump. Admins only.
 *
 * Returns the full thread graph for the given workspace (or the active
 * workspace if none specified) as a single JSON document: threads +
 * messages + summaries + continuation chat sessions & messages + import
 * runs. Useful for offboarding, archival, and cross-instance migrations.
 *
 * Query params:
 *   workspaceId  — workspace to export (default: active cookie, else global)
 *   threadIds    — optional comma-separated subset
 *
 * Response: `application/json`, `Content-Disposition: attachment`.
 */

import { NextResponse } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  ACTIVE_WORKSPACE_COOKIE,
  GLOBAL_WORKSPACE_ID,
  getWorkspaceById,
} from "@/lib/operator-studio/workspaces"
import { getDb } from "@/lib/server/db/client"
import {
  operatorChatMessages,
  operatorChatSessions,
  operatorImportRuns,
  operatorThreadMessages,
  operatorThreadSummaries,
  operatorThreads,
} from "@/lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 }
    )
  }

  const url = new URL(request.url)
  const explicit = url.searchParams.get("workspaceId")?.trim()
  const threadIdsRaw = url.searchParams.get("threadIds")?.trim()
  const threadIds = threadIdsRaw
    ? threadIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null

  const workspaceId = await resolveWorkspace(explicit)

  const db = getDb()

  // Threads (optionally filtered to a subset).
  const threadsQuery = threadIds
    ? db
        .select()
        .from(operatorThreads)
        .where(
          and(
            eq(operatorThreads.workspaceId, workspaceId),
            inArray(operatorThreads.id, threadIds)
          )
        )
    : db
        .select()
        .from(operatorThreads)
        .where(eq(operatorThreads.workspaceId, workspaceId))

  const threads = await threadsQuery
  const subsetThreadIds = threads.map((t) => t.id)

  // Children — only those belonging to exported threads (plus workspace-scoped).
  const [messages, summaries, chatSessions, importRuns] = await Promise.all([
    subsetThreadIds.length > 0
      ? db
          .select()
          .from(operatorThreadMessages)
          .where(
            and(
              eq(operatorThreadMessages.workspaceId, workspaceId),
              inArray(operatorThreadMessages.threadId, subsetThreadIds)
            )
          )
      : [],
    subsetThreadIds.length > 0
      ? db
          .select()
          .from(operatorThreadSummaries)
          .where(
            and(
              eq(operatorThreadSummaries.workspaceId, workspaceId),
              inArray(operatorThreadSummaries.threadId, subsetThreadIds)
            )
          )
      : [],
    subsetThreadIds.length > 0
      ? db
          .select()
          .from(operatorChatSessions)
          .where(
            and(
              eq(operatorChatSessions.workspaceId, workspaceId),
              inArray(operatorChatSessions.threadId, subsetThreadIds)
            )
          )
      : [],
    threadIds
      ? []
      : db
          .select()
          .from(operatorImportRuns)
          .where(eq(operatorImportRuns.workspaceId, workspaceId)),
  ])

  const sessionIds = chatSessions.map((s) => s.id)
  const chatMessages =
    sessionIds.length > 0
      ? await db
          .select()
          .from(operatorChatMessages)
          .where(
            and(
              eq(operatorChatMessages.workspaceId, workspaceId),
              inArray(operatorChatMessages.sessionId, sessionIds)
            )
          )
      : []

  const exportedAt = new Date().toISOString()
  const filename = `operator-studio-${workspaceId}-${exportedAt
    .replace(/[:.]/g, "-")
    .slice(0, 19)}.json`

  const payload = {
    schemaVersion: 1,
    exportedAt,
    workspaceId,
    counts: {
      threads: threads.length,
      messages: messages.length,
      summaries: summaries.length,
      chatSessions: chatSessions.length,
      chatMessages: chatMessages.length,
      importRuns: importRuns.length,
    },
    threads,
    messages,
    summaries,
    chatSessions,
    chatMessages,
    importRuns,
  }

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}

async function resolveWorkspace(explicit: string | undefined): Promise<string> {
  if (explicit) {
    const w = await getWorkspaceById(explicit)
    if (w) return w.id
  }
  const jar = await cookies()
  const fromCookie = jar.get(ACTIVE_WORKSPACE_COOKIE)?.value?.trim()
  if (fromCookie) {
    const w = await getWorkspaceById(fromCookie)
    if (w) return w.id
  }
  return GLOBAL_WORKSPACE_ID
}
