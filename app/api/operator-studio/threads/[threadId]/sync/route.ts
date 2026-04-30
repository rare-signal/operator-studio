import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  appendThreadMessages,
  forkThread,
  getForksOfThread,
  getThreadById,
  getThreadMessages,
} from "@/lib/operator-studio/queries"
import {
  getImporter,
  type ParsedSession,
} from "@/lib/operator-studio/importers"
import { planUpstreamFork } from "@/lib/operator-studio/fork-upstream"
import {
  diagnoseUpstreamSync,
  type UpstreamLikeMessage,
} from "@/lib/operator-studio/sync-upstream"

export const dynamic = "force-dynamic"

/**
 * Auto-sync the thread against its upstream source file.
 *
 * Replaces the manual "Fork with updates" banner: callers fire-and-forget
 * this on mount / focus, and we apply whichever action fits.
 *
 *   - fast-forward: shared prefix matches and upstream grew → append the
 *     new tail in place. Caller refreshes the thread view.
 *   - noop: upstream matches stored → nothing happens.
 *   - shrunk: upstream is shorter → noop (we don't roll back).
 *   - conflict: shared-prefix mismatch → fork. Dedup against existing
 *     forks of this thread that already capture the same upstream
 *     snapshot, so repeated visits don't spawn runaway forks.
 *   - no-source / reparse-failed: silent — we can't sync, leave it alone.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const { threadId } = await params

  const thread = await getThreadById(workspaceId, threadId)
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 })
  }

  const plan = planUpstreamFork(thread)
  if (plan.status !== "attempt-reparse") {
    return NextResponse.json({ kind: "no-source", reason: plan.reason })
  }

  // Re-parse goes through the importer registry so any source with
  // `supportsSingleImport: true` (Claude Code, Codex, OpenCode today)
  // syncs the same way. parseOne is infallible — it returns a tagged
  // skip rather than throwing, so we surface the reason verbatim.
  const importer = getImporter(plan.sourceApp)
  if (!importer || !importer.supportsSingleImport) {
    return NextResponse.json({
      kind: "reparse-failed",
      error: `Re-parse isn't wired up for "${plan.sourceApp}"`,
    })
  }
  const reparse = importer.parseOne(plan.filePath)
  if (!reparse.ok) {
    return NextResponse.json({
      kind: "reparse-failed",
      error: reparse.reason,
    })
  }
  const parsed: ParsedSession = reparse.session

  const upstream: UpstreamLikeMessage[] = parsed.messages.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
  }))

  const stored = await getThreadMessages(workspaceId, threadId)
  const diagnosis = diagnoseUpstreamSync(stored, upstream)

  switch (diagnosis.kind) {
    case "noop":
      return NextResponse.json({ kind: "noop" })

    case "shrunk":
      return NextResponse.json({
        kind: "shrunk",
        storedCount: diagnosis.storedCount,
        upstreamCount: diagnosis.upstreamCount,
      })

    case "fast-forward": {
      const now = new Date()
      const appended = await appendThreadMessages(
        workspaceId,
        threadId,
        diagnosis.appendFrom,
        diagnosis.newMessages.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.timestamp ? new Date(m.timestamp) : now,
        }))
      )
      return NextResponse.json({
        kind: "fast-forward",
        appended,
        newMessageCount: stored.length + appended,
      })
    }

    case "conflict": {
      // Dedup: if an existing fork of this thread already captures the
      // same upstream snapshot (length + content match), reuse it
      // instead of spawning a sibling. This bounds fork creation to
      // "one per distinct upstream snapshot," not "one per page focus."
      const existingForks = await getForksOfThread(workspaceId, threadId)
      for (const fork of existingForks) {
        if (fork.messageCount !== upstream.length) continue
        const forkMsgs = await getThreadMessages(workspaceId, fork.id)
        if (forkMsgs.length !== upstream.length) continue
        const allMatch = forkMsgs.every(
          (m, i) =>
            m.role === upstream[i].role && m.content === upstream[i].content
        )
        if (allMatch) {
          return NextResponse.json({
            kind: "forked-existing",
            fork,
            divergeAt: diagnosis.divergeAt,
          })
        }
      }

      const forkedBy =
        auth.identity ?? (await getDisplayName()) ?? "operator"
      const fork = await forkThread(workspaceId, threadId, forkedBy, upstream)
      return NextResponse.json({
        kind: "forked-new",
        fork,
        divergeAt: diagnosis.divergeAt,
      })
    }
  }
}
