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
import { createHash, randomUUID } from "crypto"
import { z } from "zod"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import {
  ACTIVE_WORKSPACE_COOKIE,
  GLOBAL_WORKSPACE_ID,
  getWorkspaceById,
} from "@/lib/operator-studio/workspaces"
import {
  completeImportRun,
  createImportRun,
  findThreadBySourceKey,
  insertThread,
  insertThreadMessages,
} from "@/lib/operator-studio/queries"
import {
  parseUniversal,
  type DetectedFormat,
} from "@/lib/operator-studio/importers/universal-parser"
import { deriveTitle } from "@/lib/operator-studio/importers/generate-title"
import { deriveTags } from "@/lib/operator-studio/importers/generate-tags"
import { deriveCaptureReason } from "@/lib/operator-studio/importers/generate-capture-reason"
import { emitWebhookEvent } from "@/lib/operator-studio/webhooks"
import {
  checkRateLimit,
  resolveRateLimitKey,
} from "@/lib/operator-studio/rate-limit"
import {
  OPERATOR_SOURCE_APPS,
  type OperatorSourceApp,
} from "@/lib/operator-studio/types"
import { cookies } from "next/headers"

export const dynamic = "force-dynamic"

const querySchema = z.object({
  title: z.string().trim().max(512).optional(),
  tags: z.string().trim().max(1024).optional(),
  projectSlug: z.string().trim().max(128).optional(),
  source: z.enum(OPERATOR_SOURCE_APPS).optional(),
  importedBy: z.string().trim().min(1).max(128).optional(),
  workspaceId: z.string().trim().min(1).max(64).optional(),
  // Stable dedupe key. Callers that have an upstream thread id (e.g.
  // "claude-session-abc" or "github-pr-123") should pass it so repeated
  // POSTs of the same conversation return the original thread instead of
  // creating duplicates. If omitted, the route derives a key from a content
  // hash of the messages.
  dedupeKey: z.string().trim().max(256).optional(),
  // Explicitly disable dedupe (rarely wanted, but useful for one-off tests).
  allowDuplicates: z.string().optional(),
  // Opt-in: when truthy AND `tags` is not provided, run the ingest through
  // the LLM cluster to derive 2–5 short topic tags.
  autoTag: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return jsonError(
      401,
      auth.reason,
      "Provide Authorization: Bearer <token> or sign in with the session cookie. Mint per-user tokens in the Admin page, or set OPERATOR_STUDIO_INGEST_TOKEN for a shared legacy token."
    )
  }

  // Rate limit by token-id (strongest identity) or client IP. A misconfigured
  // IDE hook firing on every keystroke shouldn't be able to tank the DB.
  const rateKey = resolveRateLimitKey(req, auth.tokenId)
  const rl = checkRateLimit(rateKey)
  if (!rl.ok) {
    const res = jsonError(
      429,
      "Rate limit exceeded",
      `Try again in ${Math.ceil(rl.resetInMs / 1000)}s. Default is 60 req/min; override via OPERATOR_STUDIO_INGEST_RATE_LIMIT.`
    )
    res.headers.set("Retry-After", String(Math.ceil(rl.resetInMs / 1000)))
    res.headers.set("X-RateLimit-Limit", String(rl.limit))
    res.headers.set("X-RateLimit-Remaining", "0")
    return res
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
  // Identity precedence: bearer token's display_name wins (bots can't
  // claim another identity); else the cookie's display name; else the
  // query param; else "api". This is the multiplayer audit story —
  // `importedBy` is what the token says, not what the caller claims.
  const importedBy =
    auth.identity ??
    (await getDisplayName()) ??
    query.importedBy?.trim() ??
    "api"
  // If the caller didn't specify a source, infer it from the detected format
  // so the "By Source" grouping reflects reality.
  const sourceApp: OperatorSourceApp =
    query.source ?? sourceFromDetectedFormat(parsed.detectedFormat)
  const now = new Date()
  const threadId = `thread-${randomUUID()}`
  const runId = `run-ingest-${Date.now()}`

  const title =
    query.title?.trim() ||
    parsed.title?.trim() ||
    (await deriveTitle(parsed.messages.map((m) => ({ role: m.role, content: m.content }))))

  let tags = parseTags(query.tags)
  const autoTagRequested =
    query.autoTag === "1" || query.autoTag === "true"
  let autoTagged = false
  if (tags.length === 0 && autoTagRequested) {
    const derived = await deriveTags(
      parsed.messages.map((m) => ({ role: m.role, content: m.content }))
    )
    if (derived.length > 0) {
      tags = derived
      autoTagged = true
    }
  }

  // Dedupe. The derived key is a content hash of the messages so two identical
  // pastes collide even without an explicit upstream thread id. Callers with
  // a stable external id should pass `dedupeKey`.
  const allowDuplicates = query.allowDuplicates === "1" || query.allowDuplicates === "true"
  const sourceThreadKey = allowDuplicates
    ? null
    : query.dedupeKey?.trim() || computeContentHash(parsed.messages)

  if (sourceThreadKey) {
    const existing = await findThreadBySourceKey(workspaceId, sourceApp, sourceThreadKey)
    if (existing) {
      return NextResponse.json({
        ok: true,
        deduped: true,
        threadId: existing.id,
        workspaceId: existing.workspaceId,
        detectedFormat: parsed.detectedFormat,
        messageCount: existing.messageCount,
        title: existing.promotedTitle ?? existing.rawTitle,
        notes: [
          "Content already present — returning the existing thread id. Pass ?allowDuplicates=1 to force a new thread.",
          ...parsed.notes,
        ],
        viewUrl: `/operator-studio/threads/${existing.id}`,
      })
    }
  }

  // Derive a short capture rationale in parallel with the other ingest
  // prep. This is best-effort — returns null if no LLM endpoint is
  // configured or the call fails, in which case the column stays null
  // and the UI hides the field.
  const captureReasonPromise = deriveCaptureReason(
    parsed.messages.map((m) => ({ role: m.role, content: m.content }))
  )

  // Track the import run.
  await createImportRun({
    id: runId,
    workspaceId,
    sourceApp,
    importedBy,
  })

  const captureReason = await captureReasonPromise

  try {
    await insertThread({
      id: threadId,
      workspaceId,
      sourceApp,
      sourceThreadKey,
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
      captureReason,
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

    emitWebhookEvent(workspaceId, "thread.imported", {
      threadId,
      title,
      source: sourceApp,
      detectedFormat: parsed.detectedFormat,
      messageCount: parsed.messages.length,
      importedBy,
      tags,
      projectSlug: query.projectSlug?.trim() || null,
    })

    return NextResponse.json({
      ok: true,
      threadId,
      workspaceId,
      detectedFormat: parsed.detectedFormat,
      messageCount: parsed.messages.length,
      title,
      tags,
      autoTagged,
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

function computeContentHash(
  messages: Array<{ role: string; content: string }>
): string {
  const h = createHash("sha256")
  for (const m of messages) {
    h.update(m.role)
    h.update("\0")
    h.update(m.content)
    h.update("\0\0")
  }
  return `sha256:${h.digest("hex")}`
}

function sourceFromDetectedFormat(format: DetectedFormat): OperatorSourceApp {
  switch (format) {
    case "gemini-generate":
    case "gemini-conversation":
      return "gemini"
    case "openai-chat":
      return "openai"
    case "anthropic-messages":
      return "anthropic"
    case "chatgpt-share":
      return "chatgpt"
    case "operator-studio-native":
    case "messages-array":
    case "role-content-array":
    case "jsonl-messages":
    case "labeled-transcript":
    case "markdown-heading-split":
    case "raw-blob":
      return "manual"
    default:
      return "manual"
  }
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
