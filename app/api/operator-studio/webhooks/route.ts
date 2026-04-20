import { NextResponse } from "next/server"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  createWebhookSub,
  listWebhookSubs,
} from "@/lib/operator-studio/webhook-subscriptions"

export const dynamic = "force-dynamic"

const createSchema = z.object({
  label: z.string().trim().min(1).max(128),
  url: z.string().trim().url().max(2048),
  secret: z.string().trim().max(256).optional(),
  events: z.string().trim().max(512).optional(),
})

export async function GET(req: Request) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const rows = await listWebhookSubs(workspaceId)
  return NextResponse.json({ subscriptions: rows })
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const raw = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const createdBy = auth.identity ?? (await getDisplayName()) ?? "admin"
  const row = await createWebhookSub({
    workspaceId,
    ...parsed.data,
    createdBy,
  })
  return NextResponse.json({ ok: true, subscription: row })
}
