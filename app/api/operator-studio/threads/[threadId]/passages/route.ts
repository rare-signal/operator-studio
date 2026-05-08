import { createHash, randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getDb } from "@/lib/server/db/client"
import {
  operatorThreadMessages,
  operatorThreads,
} from "@/lib/server/db/schema"
import {
  createPassage,
  getPassagesForThread,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const MAX_NOTE = 2000
const MAX_PASSAGE_CHARS = 8000

/**
 * GET /api/operator-studio/threads/[threadId]/passages
 *
 * Returns all passages elevated within a thread, newest first. Used by
 * the thread reader to render highlight overlays and (later) the
 * "show all elevated passages" view.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { threadId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()

  // Confirm the thread exists in this workspace before exposing any
  // passages — passages are scoped per workspace, so a foreign threadId
  // should resolve to an empty result, not a permissions leak.
  const db = getDb()
  const thread = await db
    .select({ id: operatorThreads.id })
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.id, threadId),
        eq(operatorThreads.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (thread.length === 0) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 })
  }

  const passages = await getPassagesForThread(workspaceId, threadId)
  return NextResponse.json({ passages })
}

/**
 * POST /api/operator-studio/threads/[threadId]/passages
 *
 * Promote a span of text inside a thread message. Body:
 *   { messageId, startOffset, endOffset, text, note? }
 *
 * Server validates the offsets against the live message content and
 * rejects mismatched payloads — that way the snapshot we persist is
 * known-good at promotion time. `text` from the client must equal
 * the substring at [startOffset, endOffset) on the server, otherwise
 * the operator selected against stale content and we make them try
 * again instead of writing a phantom passage.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { threadId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()

  const body = (await req.json().catch(() => null)) as {
    messageId?: unknown
    text?: unknown
    note?: unknown
    labelId?: unknown
  } | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  const messageId = typeof body.messageId === "string" ? body.messageId : null
  const text = typeof body.text === "string" ? body.text : null
  const note =
    typeof body.note === "string" && body.note.trim().length > 0
      ? body.note.slice(0, MAX_NOTE)
      : null
  const labelId =
    typeof body.labelId === "string" && body.labelId.length > 0
      ? body.labelId
      : null

  if (!messageId || !text || text.trim().length === 0) {
    return NextResponse.json(
      { error: "messageId and non-empty text are required" },
      { status: 400 }
    )
  }
  if (text.length > MAX_PASSAGE_CHARS) {
    return NextResponse.json(
      { error: `Passage longer than ${MAX_PASSAGE_CHARS} chars` },
      { status: 400 }
    )
  }

  const db = getDb()
  const messageRows = await db
    .select({
      id: operatorThreadMessages.id,
      threadId: operatorThreadMessages.threadId,
      content: operatorThreadMessages.content,
    })
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.id, messageId),
        eq(operatorThreadMessages.workspaceId, workspaceId)
      )
    )
    .limit(1)
  if (messageRows.length === 0) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 })
  }
  const message = messageRows[0]
  if (message.threadId !== threadId) {
    return NextResponse.json(
      { error: "Message does not belong to this thread" },
      { status: 400 }
    )
  }

  // Resolve offsets server-side from the selected text. The client
  // doesn't reliably know character offsets into message.content
  // (DOM↔markdown mapping is non-trivial), so it sends what was
  // visually selected and we locate it in the source. If the text
  // appears more than once we pick the first match — fine for v0;
  // in practice the operator would re-select with more surrounding
  // context if they meant a later occurrence.
  const startOffset = message.content.indexOf(text)
  if (startOffset === -1) {
    return NextResponse.json(
      {
        error:
          "Selection no longer matches the live message — refresh and try again.",
        code: "stale_selection",
      },
      { status: 409 }
    )
  }
  const endOffset = startOffset + text.length

  const promotedBy = (await getDisplayName()) || "operator"
  const passage = await createPassage({
    id: `pas_${randomUUID().slice(0, 16)}`,
    workspaceId,
    threadId,
    messageId,
    startOffset,
    endOffset,
    textSnapshot: text,
    textHash: createHash("sha1").update(text).digest("hex"),
    note,
    labelId,
    promotedBy,
  })

  return NextResponse.json({ passage }, { status: 201 })
}
