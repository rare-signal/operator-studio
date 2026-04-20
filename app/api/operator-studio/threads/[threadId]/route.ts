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
import type { OperatorReviewState } from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

const patchSchema = z.union([
  z.object({
    action: z.literal("fork"),
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
    const fork = await forkThread(workspaceId, threadId, forkedBy)
    return NextResponse.json({ ok: true, fork })
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

  if ("reviewState" in body) {
    await updateThreadReviewState(
      workspaceId,
      threadId,
      body.reviewState as OperatorReviewState
    )
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
  return NextResponse.json({ ok: true })
}
