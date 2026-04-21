import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { emitWebhookEvent } from "@/lib/operator-studio/webhooks"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  deleteMessage,
  getPromotedThreadMessages,
  promoteMessage,
  unpromoteMessage,
  updateMessageContent,
} from "@/lib/operator-studio/queries"
import type { PromotionKind } from "@/lib/operator-studio/types"

export const dynamic = "force-dynamic"

const patchSchema = z.union([
  z.object({
    action: z.literal("promote"),
    messageId: z.string().trim().min(1),
    source: z.enum(["thread", "chat"]).optional(),
    promotedBy: z.string().trim().min(1).max(128).optional(),
    promotionNote: z.string().trim().max(2048).optional(),
    promotionKind: z
      .enum(["insight", "decision", "quotable", "technical", "fire"])
      .optional(),
  }),
  z.object({
    action: z.literal("unpromote"),
    messageId: z.string().trim().min(1),
    source: z.enum(["thread", "chat"]).optional(),
  }),
  z.object({
    action: z.literal("edit"),
    messageId: z.string().trim().min(1),
    content: z.string().max(1_000_000),
    source: z.enum(["thread", "chat"]).optional(),
  }),
])

const deleteSchema = z.object({
  messageId: z.string().trim().min(1),
  source: z.enum(["thread", "chat"]).optional(),
})

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const promoted = new URL(req.url).searchParams.get("promoted")

  if (promoted === "true") {
    const messages = await getPromotedThreadMessages(workspaceId)
    return NextResponse.json({ messages })
  }

  return NextResponse.json({ error: "Use ?promoted=true" }, { status: 400 })
}

export async function PATCH(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const raw = await req.json().catch(() => null)
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const body = parsed.data
  const msgSource = body.source === "chat" ? "chat" : "thread"

  if (body.action === "promote") {
    // Identity precedence: bearer identity > cookie > body claim > fallback.
    // Bots shouldn't be able to impersonate another promoter.
    const promotedBy =
      auth.identity ??
      (await getDisplayName()) ??
      body.promotedBy?.trim() ??
      "operator"
    await promoteMessage(
      workspaceId,
      body.messageId,
      {
        promotedBy,
        promotionNote: body.promotionNote,
        promotionKind: body.promotionKind as PromotionKind | undefined,
      },
      msgSource
    )
    emitWebhookEvent(workspaceId, "message.promoted", {
      messageId: body.messageId,
      source: msgSource,
      promotedBy,
      promotionKind: body.promotionKind ?? null,
      promotionNote: body.promotionNote ?? null,
    })
    return NextResponse.json({ ok: true })
  }

  if (body.action === "unpromote") {
    await unpromoteMessage(workspaceId, body.messageId, msgSource)
    return NextResponse.json({ ok: true })
  }

  if (body.action === "edit") {
    await updateMessageContent(workspaceId, body.messageId, body.content, msgSource)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const raw = await req.json().catch(() => null)
  const parsed = deleteSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const msgSource = parsed.data.source === "chat" ? "chat" : "thread"
  await deleteMessage(workspaceId, parsed.data.messageId, msgSource)
  return NextResponse.json({ ok: true })
}
