import { mkdir, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { randomUUID } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getPlanById,
  updatePlanStep,
} from "@/lib/operator-studio/plans"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const UPLOADS_ROOT = join(process.cwd(), "uploads")
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"])

/**
 * POST /api/operator-studio/plans/[id]/steps/[stepId]/cover
 *
 * Multipart upload with a single `file` field. Persists the image
 * under ./uploads/step-covers/<stepId>/<uuid><ext>, sets the step's
 * cover_image_url to the studio's serving URL, returns the updated
 * plan (so the caller's optimistic merge can swap in fresh state).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id: planId, stepId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()

  // Defensive: confirm plan + step belong to this workspace before we
  // bother touching disk.
  const plan = await getPlanById(workspaceId, planId)
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }
  if (!plan.steps.some((s) => s.id === stepId)) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 }
    )
  }
  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "Missing `file` form field" },
      { status: 400 }
    )
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (limit ${MAX_BYTES / 1024 / 1024}MB)` },
      { status: 413 }
    )
  }
  const ext = extname(file.name).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json(
      {
        error: `Unsupported extension. Allowed: ${[...ALLOWED_EXT].join(", ")}`,
      },
      { status: 415 }
    )
  }

  const filename = `${randomUUID()}${ext}`
  const dir = join(UPLOADS_ROOT, "step-covers", stepId)
  await mkdir(dir, { recursive: true })
  const buf = Buffer.from(await file.arrayBuffer())
  await writeFile(join(dir, filename), buf)

  const url = `/api/operator-studio/uploads/step-covers/${encodeURIComponent(stepId)}/${filename}`

  const updated = await updatePlanStep(workspaceId, planId, stepId, {
    coverImageUrl: url,
  })
  if (!updated) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }
  return NextResponse.json({ plan: updated })
}

/** DELETE — clear the step's cover image. (File on disk is not unlinked
 *  to keep the operation cheap; orphaned files can be GC'd later.) */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id: planId, stepId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const updated = await updatePlanStep(workspaceId, planId, stepId, {
    coverImageUrl: null,
  })
  if (!updated) {
    return NextResponse.json({ error: "Plan or step not found" }, { status: 404 })
  }
  return NextResponse.json({ plan: updated })
}
