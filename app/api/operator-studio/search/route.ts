import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  searchMessages,
  searchThreads,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  q: z.string().trim().min(2).max(256),
  scope: z.enum(["threads", "messages", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    scope: url.searchParams.get("scope") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { q, scope, limit } = parsed.data
  const workspaceId = await getActiveWorkspaceId()

  const wantThreads = scope === "threads" || scope === "all"
  const wantMessages = scope === "messages" || scope === "all"

  const [threads, messages] = await Promise.all([
    wantThreads ? searchThreads(workspaceId, q, limit) : Promise.resolve([]),
    wantMessages ? searchMessages(workspaceId, q, limit) : Promise.resolve([]),
  ])

  return NextResponse.json({
    query: q,
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
