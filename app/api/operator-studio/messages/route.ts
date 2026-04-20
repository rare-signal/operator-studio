import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
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
    const promotedBy =
      body.promotedBy?.trim() ||
      (await getDisplayName()) ||
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
