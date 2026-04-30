import { NextResponse } from "next/server"
import { z } from "zod"

import {
  authorizeRequest,
  getDisplayName,
  isAdmin,
} from "@/lib/operator-studio/auth"
import {
  createApiToken,
  listApiTokens,
} from "@/lib/operator-studio/tokens"

export const dynamic = "force-dynamic"

const createSchema = z.object({
  label: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(128),
  workspaceId: z.string().trim().min(1).max(64).nullish(),
})

export async function GET(req: Request) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const url = new URL(req.url)
  const scope = url.searchParams.get("workspaceId")
  const rows = await listApiTokens(
    scope === null ? undefined : scope || null
  )
  return NextResponse.json({ tokens: rows })
}

export async function POST(request: Request) {
  const auth = await authorizeRequest(request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  if (!(await isAdmin(auth))) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const createdBy = auth.identity ?? (await getDisplayName()) ?? "admin"
  const created = await createApiToken({ ...parsed.data, createdBy })
  return NextResponse.json({ ok: true, token: created })
}
