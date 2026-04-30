import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  findThreadsByTag,
  searchMessages,
  searchMessagesQuick,
  searchThreads,
  searchThreadsQuick,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  q: z.string().trim().max(256).optional(),
  tag: z.string().trim().min(1).max(64).optional(),
  scope: z.enum(["threads", "messages", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  /** quick=1 returns a slim payload — no ts_headline snippets — for
   *  picker-style UIs where we just need title + role + ids and want
   *  sub-100ms response. */
  quick: z.coerce.boolean().optional(),
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

  const { q, tag, scope, limit, quick } = parsed.data
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
        projectSlug: t.projectSlug,
        importedAt: t.importedAt,
        createdAt: t.createdAt,
        rank: null,
        snippet: null,
      })),
      messages: [],
    })
  }

  const wantThreads = scope === "threads" || scope === "all"
  const wantMessages = scope === "messages" || scope === "all"

  // Quick mode skips ts_headline (the snippet computation is the
  // expensive part of the FTS pipeline) for picker UIs that just need
  // titles to render. Sub-100ms response across a large corpus.
  if (quick) {
    const [threads, messages] = await Promise.all([
      wantThreads && q
        ? searchThreadsQuick(workspaceId, q, limit)
        : Promise.resolve([]),
      wantMessages && q
        ? searchMessagesQuick(workspaceId, q, limit)
        : Promise.resolve([]),
    ])
    return NextResponse.json({
      query: q ?? null,
      tag: null,
      quick: true,
      threads: threads.map((t) => ({
        id: t.id,
        rawTitle: t.rawTitle,
        promotedTitle: t.promotedTitle,
        sourceApp: t.sourceApp,
        rank: t.rank,
      })),
      messages: messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        threadTitle: m.threadTitle,
        role: m.role,
        rank: m.rank,
        preview: m.preview,
      })),
    })
  }

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
      projectSlug: t.projectSlug,
      importedAt: t.importedAt,
      createdAt: t.createdAt,
      rank: t.rank,
      snippet: t.snippet,
    })),
    messages: messages.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      threadTitle: m.threadTitle,
      sourceApp: m.threadSourceApp,
      projectSlug: m.threadProjectSlug,
      role: m.role,
      turnIndex: m.turnIndex,
      createdAt: m.createdAt,
      rank: m.rank,
      snippet: m.snippet,
    })),
  })
}
