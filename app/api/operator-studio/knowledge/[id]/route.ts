import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import {
  KB_ENTRY_TYPES,
  KB_STABILITIES,
  deleteEntry,
  getEntryById,
  isKbEnabled,
  upsertEntry,
  type KbEntryType,
  type KbStability,
} from "@/lib/operator-studio/knowledge"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/knowledge/[id] */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  if (!(await isKbEnabled(workspaceId))) {
    return NextResponse.json(
      { error: "Knowledge Base module not enabled for workspace." },
      { status: 403 }
    )
  }
  const entry = await getEntryById(workspaceId, id)
  if (!entry) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json({ entry })
}

/** PATCH /api/operator-studio/knowledge/[id] — surgical update. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  if (!(await isKbEnabled(workspaceId))) {
    return NextResponse.json(
      { error: "Knowledge Base module not enabled for workspace." },
      { status: 403 }
    )
  }
  const existing = await getEntryById(workspaceId, id)
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }

  const display = (await getDisplayName().catch(() => null)) ?? "operator"

  const entryType =
    typeof body.entry_type === "string" &&
    KB_ENTRY_TYPES.includes(body.entry_type as KbEntryType)
      ? (body.entry_type as KbEntryType)
      : existing.entryType

  const stability =
    typeof body.stability === "string" &&
    KB_STABILITIES.includes(body.stability as KbStability)
      ? (body.stability as KbStability)
      : existing.stability

  const entry = await upsertEntry(workspaceId, {
    id: existing.id,
    entryType,
    stability,
    title: typeof body.title === "string" ? body.title : existing.title,
    summary:
      typeof body.summary === "string" ? body.summary : existing.summary,
    bodyMarkdown:
      typeof body.body_markdown === "string"
        ? body.body_markdown
        : typeof body.content === "string"
          ? body.content
          : existing.bodyMarkdown,
    tags: Array.isArray(body.tags)
      ? (body.tags.filter((t) => typeof t === "string") as string[])
      : existing.tags,
    relatedEntryIds: Array.isArray(body.related_entry_ids)
      ? (body.related_entry_ids.filter(
          (t) => typeof t === "string"
        ) as string[])
      : existing.relatedEntryIds,
    parentEntryId:
      typeof body.parent_entry_id === "string" || body.parent_entry_id === null
        ? (body.parent_entry_id as string | null)
        : existing.parentEntryId,
    sourceThreadId:
      typeof body.source_thread_id === "string" ||
      body.source_thread_id === null
        ? (body.source_thread_id as string | null)
        : existing.sourceThreadId,
    sourcePassageIds: Array.isArray(body.source_passage_ids)
      ? (body.source_passage_ids.filter(
          (t) => typeof t === "string"
        ) as string[])
      : existing.sourcePassageIds,
    citations: Array.isArray(body.citations)
      ? body.citations
      : existing.citations,
    userEditBy: display,
  })
  return NextResponse.json({ entry })
}

/** DELETE /api/operator-studio/knowledge/[id] */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const { id } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()
  const ok = await deleteEntry(workspaceId, id)
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
