import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { emitWebhookEvent } from "@/lib/operator-studio/webhooks"
import {
  GLOBAL_WORKSPACE_ID,
  getActiveWorkspaceId,
  promoteThread,
  pullThread,
} from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("promote") }),
  z.object({
    action: z.literal("pull"),
    targetWorkspaceId: z.string().trim().min(1).max(128),
  }),
])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const raw = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data

  const activeWorkspaceId = await getActiveWorkspaceId()
  const { threadId } = await params

  const actorName =
    auth.identity ?? (await getDisplayName()) ?? "operator"

  if (body.action === "promote") {
    if (activeWorkspaceId === GLOBAL_WORKSPACE_ID) {
      return NextResponse.json(
        {
          error:
            "Cannot promote from the global workspace. Switch to a sub-workspace first.",
        },
        { status: 400 }
      )
    }

    let newThreadId: string
    try {
      newThreadId = await promoteThread({
        sourceThreadId: threadId,
        sourceWorkspaceId: activeWorkspaceId,
        actorName,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Promote failed"
      return NextResponse.json({ error: message }, { status: 400 })
    }

    emitWebhookEvent(GLOBAL_WORKSPACE_ID, "thread.promoted", {
      threadId: newThreadId,
      sourceThreadId: threadId,
      sourceWorkspaceId: activeWorkspaceId,
      crossWorkspace: true,
      promotedBy: actorName,
    })

    return NextResponse.json({
      ok: true,
      newThreadId,
      viewUrl: `/operator-studio/threads/${newThreadId}`,
    })
  }

  // action === "pull"
  if (activeWorkspaceId === GLOBAL_WORKSPACE_ID) {
    return NextResponse.json(
      {
        error:
          "Cannot pull into the global workspace. Switch to a sub-workspace first.",
      },
      { status: 400 }
    )
  }

  if (body.targetWorkspaceId !== activeWorkspaceId) {
    return NextResponse.json(
      {
        error:
          "targetWorkspaceId must match the active workspace. You can only pull into the workspace you are currently viewing.",
      },
      { status: 400 }
    )
  }

  let newThreadId: string
  try {
    newThreadId = await pullThread({
      globalThreadId: threadId,
      targetWorkspaceId: activeWorkspaceId,
      actorName,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pull failed"
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true,
    newThreadId,
    viewUrl: `/operator-studio/threads/${newThreadId}`,
  })
}
