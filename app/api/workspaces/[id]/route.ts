import { NextResponse } from "next/server"
import { z } from "zod"

import { isAuthenticated } from "@/lib/operator-studio/auth"
import {
  deleteWorkspace,
  getWorkspaceById,
  renameWorkspace,
} from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

interface RouteContext {
  params: Promise<{ id: string }>
}

const patchSchema = z.object({
  label: z.string().trim().min(1).max(128),
})

export async function GET(_request: Request, { params }: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params
  const workspace = await getWorkspaceById(id)
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ workspace })
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

  const workspace = await renameWorkspace(id, parsed.data.label)
  if (!workspace) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, workspace })
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params

  try {
    await deleteWorkspace(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to delete"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
