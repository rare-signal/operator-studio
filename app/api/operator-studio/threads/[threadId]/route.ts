import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { emitWebhookEvent } from "@/lib/operator-studio/webhooks"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  forkThread,
  getChatSessionsByThread,
  getForksOfThread,
  getThreadById,
  getThreadMessages,
  getThreadSummaries,
  promoteThreadMetadata,
  softDeleteThread,
  unarchiveThread,
  updateThreadReviewState,
} from "@/lib/operator-studio/queries"
import {
  markThreadDone,
  unmarkThreadDone,
} from "@/lib/operator-studio/thread-done"
import type { OperatorReviewState } from "@/lib/operator-studio/types"
import {
  getImporter,
  type ParsedSession,
} from "@/lib/operator-studio/importers"
import {
  planUpstreamFork,
  type UpstreamForkOutcome,
} from "@/lib/operator-studio/fork-upstream"

export const dynamic = "force-dynamic"

const patchSchema = z.union([
  z.object({
    action: z.literal("fork"),
    forkedBy: z.string().trim().min(1).max(128).optional(),
    /**
     * Fork-at-point: only copy parent messages up to and including
     * turnIndex N. Use case: drift-recovery — "I went down a wrong
     * path, fork back from turn 30 and try again." Omit for a
     * tip-of-parent fork (the default).
     */
    atTurnIndex: z.number().int().min(0).optional(),
  }),
  z.object({
    action: z.literal("fork-with-upstream"),
    forkedBy: z.string().trim().min(1).max(128).optional(),
  }),
  z.object({
    action: z.literal("promote"),
    promotedTitle: z.string().trim().min(1).max(512),
    promotedSummary: z.string().trim().min(1).max(8192),
    whyItMatters: z.string().trim().max(8192).optional(),
    tags: z.array(z.string().trim().min(1).max(64)).max(64).optional(),
    projectSlug: z.string().trim().max(128).optional(),
  }),
  z.object({
    action: z.literal("unarchive"),
  }),
  z.object({
    action: z.literal("mark-done"),
  }),
  z.object({
    action: z.literal("unmark-done"),
  }),
  z.object({
    reviewState: z.enum(["imported", "in-review", "promoted", "archived"]),
  }),
])

export async function GET(
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

  const [messages, summaries, sessions, forks] = await Promise.all([
    getThreadMessages(workspaceId, threadId),
    getThreadSummaries(workspaceId, threadId),
    getChatSessionsByThread(workspaceId, threadId),
    getForksOfThread(workspaceId, threadId),
  ])

  let parentMessages: Awaited<ReturnType<typeof getThreadMessages>> = []
  if (thread.parentThreadId) {
    parentMessages = await getThreadMessages(workspaceId, thread.parentThreadId)
  }

  return NextResponse.json({
    thread,
    messages,
    summaries,
    sessions,
    forks,
    parentMessages,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const { threadId } = await params
  const raw = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data

  if ("action" in body && body.action === "fork") {
    // Identity precedence: bearer token displayName > cookie displayName
    // > body claim > fallback. Bearer tokens beat anything the body says so
    // bots can't spoof humans.
    const forkedBy =
      auth.identity ??
      (await getDisplayName()) ??
      body.forkedBy?.trim() ??
      "operator"
    const fork = await forkThread(
      workspaceId,
      threadId,
      forkedBy,
      undefined,
      typeof body.atTurnIndex === "number"
        ? { atTurnIndex: body.atTurnIndex }
        : undefined
    )
    return NextResponse.json({
      ok: true,
      fork,
      forkedAtTurnIndex: body.atTurnIndex ?? null,
    })
  }

  if ("action" in body && body.action === "fork-with-upstream") {
    const forkedBy =
      auth.identity ??
      (await getDisplayName()) ??
      body.forkedBy?.trim() ??
      "operator"

    const parent = await getThreadById(workspaceId, threadId)
    if (!parent) {
      return NextResponse.json(
        { error: "Parent thread not found" },
        { status: 404 }
      )
    }

    // Decide whether re-parse is even possible before trying. The plan
    // enum is part of the API contract so the UI can render accurate
    // toasts: "pulled latest" vs "forked from stored copy (no upstream
    // file)" vs "forked from stored copy (re-parse failed: ENOENT)".
    // This replaces the old silent-fallback pattern where every outcome
    // looked like success to the caller.
    const plan = planUpstreamFork(parent)

    let upstreamMessages: Array<{
      role: string
      content: string
      timestamp?: string
    }> | undefined
    let outcome: UpstreamForkOutcome

    if (plan.status === "attempt-reparse") {
      try {
        // Registry-driven re-parse — same code path serves every
        // source with `supportsSingleImport: true`. parseOne is
        // infallible (no throw) so the catch below only fires on
        // pathological errors above the importer (e.g. registry lookup
        // throwing, which it doesn't today).
        const importer = getImporter(plan.sourceApp)
        const reparse =
          importer && importer.supportsSingleImport
            ? importer.parseOne(plan.filePath)
            : null
        const parsed: ParsedSession | null = reparse?.ok ? reparse.session : null

        if (parsed) {
          upstreamMessages = parsed.messages.map((m) => ({
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          }))
          outcome = {
            outcome: "pulled-upstream",
            messageCount: upstreamMessages.length,
          }
        } else {
          const reason =
            reparse && !reparse.ok
              ? reparse.reason
              : `Re-parse isn't wired up for "${plan.sourceApp}"`
          outcome = {
            outcome: "stored-copy",
            reason: `${reason} — forked from stored copy.`,
          }
        }
      } catch (err) {
        outcome = {
          outcome: "reparse-failed",
          error: err instanceof Error ? err.message : String(err),
          reason: `Couldn't re-parse ${plan.filePath} — forked from stored copy.`,
        }
      }
    } else {
      // no-locator or unsupported-source: we already know re-parse
      // isn't an option, so fall straight to stored-copy fork.
      outcome = { outcome: "stored-copy", reason: plan.reason }
    }

    const fork = await forkThread(
      workspaceId,
      threadId,
      forkedBy,
      upstreamMessages
    )

    return NextResponse.json({
      ok: true,
      fork,
      messageCount: fork.messageCount,
      // Explicit outcome lets the UI distinguish success from graceful
      // degradation. Legacy `upstreamPulled` boolean kept for any older
      // clients; new clients should switch on `outcome.outcome`.
      upstreamPulled: outcome.outcome === "pulled-upstream",
      outcome,
    })
  }

  if ("action" in body && body.action === "promote") {
    await promoteThreadMetadata(workspaceId, threadId, {
      promotedTitle: body.promotedTitle,
      promotedSummary: body.promotedSummary,
      whyItMatters: body.whyItMatters,
      tags: body.tags,
      projectSlug: body.projectSlug,
    })
    const promotedBy = auth.identity ?? (await getDisplayName()) ?? "operator"
    emitWebhookEvent(workspaceId, "thread.promoted", {
      threadId,
      promotedTitle: body.promotedTitle,
      promotedSummary: body.promotedSummary,
      whyItMatters: body.whyItMatters ?? null,
      tags: body.tags ?? [],
      projectSlug: body.projectSlug ?? null,
      promotedBy,
    })
    return NextResponse.json({ ok: true })
  }

  if ("action" in body && body.action === "unarchive") {
    await unarchiveThread(workspaceId, threadId)
    return NextResponse.json({ ok: true })
  }

  if ("action" in body && body.action === "mark-done") {
    const by = auth.identity ?? (await getDisplayName()) ?? "operator"
    const at = new Date()
    await markThreadDone(workspaceId, threadId, {
      source: "manual",
      by,
      at,
    })
    return NextResponse.json({
      ok: true,
      markedDoneAt: at.toISOString(),
      markedDoneBy: by,
      markedDoneSource: "manual" as const,
    })
  }

  if ("action" in body && body.action === "unmark-done") {
    await unmarkThreadDone(workspaceId, threadId)
    return NextResponse.json({ ok: true })
  }

  if ("reviewState" in body) {
    await updateThreadReviewState(
      workspaceId,
      threadId,
      body.reviewState as OperatorReviewState
    )
    if (body.reviewState === "archived") {
      const actor = auth.identity ?? (await getDisplayName()) ?? "operator"
      emitWebhookEvent(workspaceId, "thread.archived", {
        threadId,
        archivedBy: actor,
      })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const { threadId } = await params
  await softDeleteThread(workspaceId, threadId)
  const actor = auth.identity ?? (await getDisplayName()) ?? "operator"
  emitWebhookEvent(workspaceId, "thread.archived", {
    threadId,
    archivedBy: actor,
    viaDelete: true,
  })
  return NextResponse.json({ ok: true })
}
