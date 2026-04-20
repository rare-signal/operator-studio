import { NextResponse } from "next/server"
import { z } from "zod"

import { isAuthenticated } from "@/lib/operator-studio/auth"
import {
  createWorkspace,
  listWorkspaces,
} from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const createSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, {
      message: "id must be alphanumeric with dashes",
    }),
  label: z.string().trim().min(1).max(128),
})

export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const workspaces = await listWorkspaces()
  return NextResponse.json({ workspaces })
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const raw = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  try {
    const workspace = await createWorkspace(parsed.data)
    return NextResponse.json({ ok: true, workspace })
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create workspace"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
