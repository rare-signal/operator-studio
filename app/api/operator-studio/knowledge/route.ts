import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import {
  KB_ENTRY_TYPES,
  KB_STABILITIES,
  isKbEnabled,
  listEntries,
  upsertEntry,
  type KbEntryType,
  type KbStability,
  type UpsertEntryInput,
} from "@/lib/operator-studio/knowledge"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/knowledge — list entries in active workspace. */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const enabled = await isKbEnabled(workspaceId)
  if (!enabled) {
    return NextResponse.json({
      enabled: false,
      entries: [],
    })
  }
  const entries = await listEntries(workspaceId)
  return NextResponse.json({ enabled: true, entries })
}

/** POST /api/operator-studio/knowledge — create or upsert an entry. */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  if (!(await isKbEnabled(workspaceId))) {
    return NextResponse.json(
      { error: "Knowledge Base module not enabled for workspace." },
      { status: 403 }
    )
  }
  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }

  const title = typeof body.title === "string" ? body.title.trim() : ""
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 })
  }

  const entryType =
    typeof body.entry_type === "string" &&
    KB_ENTRY_TYPES.includes(body.entry_type as KbEntryType)
      ? (body.entry_type as KbEntryType)
      : "concept"

  const stability =
    typeof body.stability === "string" &&
    KB_STABILITIES.includes(body.stability as KbStability)
      ? (body.stability as KbStability)
      : "draft"

  const display = (await getDisplayName().catch(() => null)) ?? "operator"

  const input: UpsertEntryInput = {
    id: typeof body.id === "string" ? body.id : undefined,
    entryType,
    stability,
    title,
    summary: typeof body.summary === "string" ? body.summary : "",
    bodyMarkdown:
      typeof body.body_markdown === "string"
        ? body.body_markdown
        : typeof body.content === "string"
          ? body.content
          : "",
    tags: Array.isArray(body.tags)
      ? (body.tags.filter((t) => typeof t === "string") as string[])
      : [],
    relatedEntryIds: Array.isArray(body.related_entry_ids)
      ? (body.related_entry_ids.filter(
          (t) => typeof t === "string"
        ) as string[])
      : [],
    parentEntryId:
      typeof body.parent_entry_id === "string"
        ? body.parent_entry_id
        : null,
    sourceThreadId:
      typeof body.source_thread_id === "string"
        ? body.source_thread_id
        : null,
    sourcePassageIds: Array.isArray(body.source_passage_ids)
      ? (body.source_passage_ids.filter(
          (t) => typeof t === "string"
        ) as string[])
      : [],
    citations: Array.isArray(body.citations)
      ? (body.citations as UpsertEntryInput["citations"])
      : [],
    userEditBy: display,
  }

  const entry = await upsertEntry(workspaceId, input)
  return NextResponse.json({ entry })
}
