import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  ensureSessionsForWorkspace,
  getRecentSessionsWithExchanges,
  getRecentSessionsWithThreads,
} from "@/lib/operator-studio/queries"
import {
  applyDonePhraseDetection,
  getPersistedDoneThreadIds,
} from "@/lib/operator-studio/thread-done"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

// v2 — read persisted marked_done_at column, opportunistic phrase
// detection writes the column on first hit. (Cache-bust marker.)
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get("mode") === "messages" ? "messages" : "threads"
  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") ?? "10", 10) || 10, 1),
    25
  )

  await ensureSessionsForWorkspace(workspaceId)

  if (mode === "messages") {
    const groups = await getRecentSessionsWithExchanges(workspaceId, limit, 4)
    const candidateIds = Array.from(
      new Set(groups.flatMap((g) => g.exchanges.map((e) => e.threadId)))
    )
    // Lazy phrase-detection writer + read of persisted state.
    // RecentExchange doesn't carry markedDoneAt so we read the column
    // directly with a small SELECT after the writer has run.
    await applyDonePhraseDetection(workspaceId, candidateIds)
    const persisted = await getPersistedDoneThreadIds(workspaceId, candidateIds)
    return NextResponse.json({
      mode,
      groups,
      count: groups.length,
      doneThreadIds: Array.from(persisted),
    })
  }

  const groups = await getRecentSessionsWithThreads(workspaceId, limit)
  const candidateIds = Array.from(
    new Set(groups.flatMap((g) => g.threads.map((t) => t.id)))
  )
  const newlyDone = await applyDonePhraseDetection(workspaceId, candidateIds)
  // Authoritative done set: persisted column on the thread row OR
  // freshly stamped this request. Built from the in-memory thread
  // rows so we don't re-fetch.
  const doneThreadIds = new Set<string>()
  for (const g of groups) {
    for (const t of g.threads) {
      if (t.markedDoneAt || newlyDone.has(t.id)) doneThreadIds.add(t.id)
    }
  }
  return NextResponse.json({
    mode,
    groups,
    count: groups.length,
    doneThreadIds: Array.from(doneThreadIds),
  })
}
