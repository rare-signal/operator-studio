import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  findThreadsByTag,
  searchMessages,
  searchThreads,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  q: z.string().trim().max(256).optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  scope: z.enum(["threads", "messages", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).refine(
  (v) => (v.q && v.q.length >= 2) || (v.tag && v.tag.length >= 1),
  { message: "Provide q (2+ chars) or tag" }
)

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    scope: url.searchParams.get("scope") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { q, tag, scope, limit } = parsed.data
  const workspaceId = await getActiveWorkspaceId()

  // Tag-filter branch: exact match against the tags jsonb array. Fast path,
  // no ts_rank — just list the matching threads, newest first.
  if (tag) {
    const threads = await findThreadsByTag(workspaceId, tag, limit)
    return NextResponse.json({
      query: null,
      tag,
      threads: threads.map((t) => ({
        id: t.id,
        workspaceId: t.workspaceId,
        rawTitle: t.rawTitle,
        promotedTitle: t.promotedTitle,
        tags: t.tags,
        reviewState: t.reviewState,
        sourceApp: t.sourceApp,
        importedAt: t.importedAt,
        rank: null,
        snippet: null,
      })),
      messages: [],
    })
  }

  const wantThreads = scope === "threads" || scope === "all"
  const wantMessages = scope === "messages" || scope === "all"

  const [threads, messages] = await Promise.all([
    wantThreads && q ? searchThreads(workspaceId, q, limit) : Promise.resolve([]),
    wantMessages && q ? searchMessages(workspaceId, q, limit) : Promise.resolve([]),
  ])

  return NextResponse.json({
    query: q ?? null,
    tag: null,
    threads: threads.map((t) => ({
      id: t.id,
      workspaceId: t.workspaceId,
      rawTitle: t.rawTitle,
      promotedTitle: t.promotedTitle,
      tags: t.tags,
      reviewState: t.reviewState,
      sourceApp: t.sourceApp,
      importedAt: t.importedAt,
      rank: t.rank,
      snippet: t.snippet,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      threadTitle: m.threadTitle,
      role: m.role,
      turnIndex: m.turnIndex,
      createdAt: m.createdAt,
      rank: m.rank,
      snippet: m.snippet,
    })),
  })
}
