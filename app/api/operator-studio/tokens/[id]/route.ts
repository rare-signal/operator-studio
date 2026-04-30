import { NextResponse } from "next/server"

import { authorizeRequest, isAdmin } from "@/lib/operator-studio/auth"
import { revokeApiToken } from "@/lib/operator-studio/tokens"

export const dynamic = "force-dynamic"

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
  const ok = await revokeApiToken(id)
  if (!ok) {
    return NextResponse.json(
      { error: "Token not found or already revoked" },
      { status: 404 }
    )
  }
  return NextResponse.json({ ok: true })
}
