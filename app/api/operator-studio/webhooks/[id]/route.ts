import { NextResponse } from "next/server"
import { z } from "zod"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import {
  deleteWebhookSub,
  toggleWebhookSub,
} from "@/lib/operator-studio/webhook-subscriptions"

export const dynamic = "force-dynamic"

const patchSchema = z.object({
  disabled: z.boolean(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const { id } = await params
  const raw = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const ok = await toggleWebhookSub(id, parsed.data.disabled)
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const { id } = await params
  const ok = await deleteWebhookSub(id)
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
