import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { z } from "zod"

import { isAuthenticated } from "@/lib/operator-studio/auth"
import {
  ACTIVE_WORKSPACE_COOKIE,
  getActiveWorkspace,
  getWorkspaceById,
} from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const workspace = await getActiveWorkspace()
  return NextResponse.json({ workspace })
}

const postSchema = z.object({
  workspaceId: z.string().min(1).max(64),
})

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = postSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const target = await getWorkspaceById(parsed.data.workspaceId)
  if (!target) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }

  const jar = await cookies()
  jar.set(ACTIVE_WORKSPACE_COOKIE, target.id, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  return NextResponse.json({ ok: true, workspace: target })
}
