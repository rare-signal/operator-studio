/**
 * POST /api/operator-studio/ingest
 *
 * The machine-friendly ingestion endpoint. Accepts JSON, plain text, or
 * markdown and runs it through the universal parser (Gemini / OpenAI /
 * Claude / labeled transcripts / markdown / raw blobs — see
 * lib/operator-studio/importers/universal-parser.ts).
 *
 * Auth: Bearer token via `OPERATOR_STUDIO_INGEST_TOKEN` OR the in-app
 * session cookie. Falls through in fully-open dev mode (neither set).
 *
 * Query params (optional):
 *   title        — override the derived title
 *   tags         — comma-separated list, applied to the imported thread
 *   projectSlug  — value for the thread's project_slug column
 *   source       — one of: claude | codex | cursor | antigravity | void | manual (default: manual)
 *   importedBy   — display name to attribute the import to (default: cookie or "api")
 *   workspaceId  — target workspace (default: active cookie, falling back to "global")
 *
 * Content-Type:
 *   application/json            → body is parsed as JSON, then universal parser runs
 *   text/plain | text/markdown  → body is kept as a string, parser autodetects labels/headings
 *   anything else               → treated as text
 */

import { NextResponse, type NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { z } from "zod"

import { getDisplayName, isApiAuthorized } from "@/lib/operator-studio/auth"
import {
  ACTIVE_WORKSPACE_COOKIE,
  GLOBAL_WORKSPACE_ID,
  getWorkspaceById,
} from "@/lib/operator-studio/workspaces"
import {
  completeImportRun,
  createImportRun,
  insertThread,
  insertThreadMessages,
} from "@/lib/operator-studio/queries"
import { parseUniversal } from "@/lib/operator-studio/importers/universal-parser"
import { deriveTitle } from "@/lib/operator-studio/importers/generate-title"
import type { OperatorSourceApp } from "@/lib/operator-studio/types"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  title: z.string().trim().max(512).optional(),
  tags: z.string().trim().max(1024).optional(),
  projectSlug: z.string().trim().max(128).optional(),
  source: z
    .enum(["codex", "cursor", "claude", "antigravity", "void", "manual"])
    .optional(),
  importedBy: z.string().trim().min(1).max(128).optional(),
  workspaceId: z.string().trim().min(1).max(64).optional(),
})

export async function POST(req: NextRequest) {
  if (!(await isApiAuthorized(req))) {
    return jsonError(
      401,
      "Unauthorized",
      "Provide Authorization: Bearer <OPERATOR_STUDIO_INGEST_TOKEN> or sign in with the session cookie."
    )
  }

  // Parse query params.
  const url = new URL(req.url)
  const rawQuery = Object.fromEntries(url.searchParams.entries())
  const q = querySchema.safeParse(rawQuery)
  if (!q.success) {
    return jsonError(400, "Invalid query", "", q.error.issues)
  }
  const query = q.data

  // Resolve target workspace. Explicit param wins over cookie.
  const workspaceId = await resolveWorkspaceId(query.workspaceId)

  // Read the body. The content-type decides whether we pre-parse JSON.
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase()
  const rawText = await req.text()
  if (!rawText.trim()) {
    return jsonError(400, "Empty body", "Send a conversation payload in the body.")
  }

  let parserInput: unknown = rawText
  if (contentType.includes("application/json")) {
    try {
      parserInput = JSON.parse(rawText)
    } catch {
      return jsonError(
        400,
        "Malformed JSON",
        "Content-Type is application/json but the body isn't valid JSON. Try application/octet-stream or text/plain to ingest as raw text instead."
      )
    }
  }

  // Universal parse.
  const parsed = parseUniversal(parserInput)
  if (parsed.messages.length === 0) {
    return jsonError(
      400,
      "No messages detected",
      "The universal parser produced zero turns. This usually means the body was empty or whitespace-only."
    )
  }

  // Build the thread.
  const importedBy =
    query.importedBy?.trim() || (await getDisplayName()) || "api"
  const sourceApp: OperatorSourceApp = query.source ?? "manual"
  const now = new Date()
  const threadId = `thread-${randomUUID()}`
  const runId = `run-ingest-${Date.now()}`

  const title =
    query.title?.trim() ||
    parsed.title?.trim() ||
    (await deriveTitle(parsed.messages.map((m) => ({ role: m.role, content: m.content }))))

  const tags = parseTags(query.tags)

  // Track the import run.
  await createImportRun({
    id: runId,
    workspaceId,
    sourceApp,
    importedBy,
  })

  try {
    await insertThread({
      id: threadId,
      workspaceId,
      sourceApp,
      sourceThreadKey: null,
      sourceLocator: null,
      importedBy,
      importedAt: now,
      importRunId: runId,
      rawTitle: title,
      rawSummary: null,
      promotedTitle: null,
      promotedSummary: null,
      privacyState: "private",
      reviewState: "imported",
      tags,
      projectSlug: query.projectSlug?.trim() || null,
      ownerName: importedBy,
      whyItMatters: null,
      sourcePayloadJson: {
        detectedFormat: parsed.detectedFormat,
        parserNotes: parsed.notes,
        contentType,
      },
      parentThreadId: null,
      promotedFromId: null,
      pulledFromId: null,
      visibleInStudio: 1,
      messageCount: parsed.messages.length,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const msgs = parsed.messages.map((m, i) => ({
      id: `msg-${threadId}-${i}`,
      workspaceId,
      threadId,
      role: m.role,
      content: m.content,
      turnIndex: i,
      metadataJson: null,
      createdAt: m.timestamp ? new Date(m.timestamp) : now,
    }))

    await insertThreadMessages(msgs)
    await completeImportRun(workspaceId, runId, 1)

    return NextResponse.json({
      ok: true,
      threadId,
      workspaceId,
      detectedFormat: parsed.detectedFormat,
      messageCount: parsed.messages.length,
      title,
      notes: parsed.notes,
      viewUrl: `/operator-studio/threads/${threadId}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await completeImportRun(workspaceId, runId, 0, msg)
    return jsonError(500, "Ingest failed", msg)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function resolveWorkspaceId(explicit: string | undefined): Promise<string> {
  if (explicit && explicit.trim()) {
    const target = await getWorkspaceById(explicit.trim())
    if (target) return target.id
  }
  const jar = await cookies()
  const fromCookie = jar.get(ACTIVE_WORKSPACE_COOKIE)?.value?.trim()
  if (fromCookie) {
    const target = await getWorkspaceById(fromCookie)
    if (target) return target.id
  }
  return GLOBAL_WORKSPACE_ID
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 64)
    .slice(0, 32)
}

function jsonError(
  status: number,
  error: string,
  detail?: string,
  issues?: unknown
) {
  return NextResponse.json(
    { ok: false, error, detail: detail || undefined, issues },
    { status }
  )
}
