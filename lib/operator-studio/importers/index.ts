/**
 * Import orchestrator for Operator Studio.
 *
 * Coordinates discovery and ingestion from supported source apps into the
 * workspace-scoped Operator Studio tables.
 */

import { randomUUID } from "crypto"

import {
  completeImportRun,
  createImportRun,
  findThreadBySourceKey,
  insertThread,
  insertThreadMessages,
} from "../queries"
import type { OperatorSourceApp } from "../types"
import {
  discoverClaudeSessions,
  parseClaudeFile,
  type ParsedClaudeSession,
} from "./claude-code"
import {
  discoverCodexSessions,
  parseCodexFile,
  type ParsedCodexSession,
} from "./codex"
import { deriveTitle } from "./generate-title"

type ParsedSession = ParsedClaudeSession | ParsedCodexSession

interface ImportResult {
  importRunId: string
  /** Newly-inserted threads on this run. */
  threadCount: number
  /** Sessions skipped because a thread with that sourceThreadKey already exists. */
  dedupedCount: number
  errors: string[]
}

/** Import every discoverable session from a given source app. */
export async function importFromSource(
  workspaceId: string,
  sourceApp: OperatorSourceApp,
  importedBy: string
): Promise<ImportResult> {
  const runId = `run-${sourceApp}-${Date.now()}`

  await createImportRun({
    id: runId,
    workspaceId,
    sourceApp,
    importedBy,
  })

  let sessions: ParsedSession[] = []
  const errors: string[] = []

  try {
    switch (sourceApp) {
      case "claude":
      case "claude-code":
        sessions = discoverClaudeSessions()
        break
      case "codex":
        sessions = discoverCodexSessions()
        break
      default:
        errors.push(
          `Local discovery isn't wired up for "${sourceApp}" — only claude and codex have filesystem importers. Paste / ingest endpoint accept every source.`
        )
    }
  } catch (err) {
    errors.push(
      `Discovery failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  let imported = 0
  let deduped = 0
  for (const session of sessions) {
    try {
      const result = await ingestSession(
        workspaceId,
        session,
        sourceApp,
        importedBy,
        runId
      )
      if (result.status === "created") imported++
      else deduped++
    } catch (err) {
      errors.push(
        `Failed to import ${session.sourceThreadId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  await completeImportRun(
    workspaceId,
    runId,
    imported,
    errors.length > 0 ? errors.join("; ") : undefined
  )

  return {
    importRunId: runId,
    threadCount: imported,
    dedupedCount: deduped,
    errors,
  }
}

/** Import a single file from any supported source. */
export async function importSingleFile(
  workspaceId: string,
  filePath: string,
  sourceApp: OperatorSourceApp,
  importedBy: string
): Promise<ImportResult> {
  const runId = `run-file-${Date.now()}`

  await createImportRun({
    id: runId,
    workspaceId,
    sourceApp,
    sourcePath: filePath,
    importedBy,
  })

  const errors: string[] = []
  let imported = 0
  let deduped = 0

  try {
    let session: ParsedSession | null = null
    switch (sourceApp) {
      case "claude":
      case "claude-code":
        session = parseClaudeFile(filePath)
        break
      case "codex":
        session = parseCodexFile(filePath)
        break
      default:
        errors.push(
          `File import isn't wired up for "${sourceApp}" — only claude and codex have filesystem importers. Paste / ingest endpoint accept every source.`
        )
    }

    if (session) {
      const result = await ingestSession(
        workspaceId,
        session,
        sourceApp,
        importedBy,
        runId
      )
      if (result.status === "created") imported = 1
      else deduped = 1
    } else {
      errors.push(`Could not parse file: ${filePath}`)
    }
  } catch (err) {
    errors.push(
      `Import failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  await completeImportRun(
    workspaceId,
    runId,
    imported,
    errors.length > 0 ? errors.join("; ") : undefined
  )

  return {
    importRunId: runId,
    threadCount: imported,
    dedupedCount: deduped,
    errors,
  }
}

/** Import from a raw payload (manual paste or API import). */
export async function importFromPayload(
  workspaceId: string,
  payload: {
    title?: string
    messages: Array<{ role: string; content: string; timestamp?: string }>
    source?: string
    metadata?: Record<string, unknown>
  },
  importedBy: string
): Promise<ImportResult> {
  const sourceApp = (payload.source ?? "manual") as OperatorSourceApp
  const runId = `run-manual-${Date.now()}`

  await createImportRun({
    id: runId,
    workspaceId,
    sourceApp,
    importedBy,
  })

  const errors: string[] = []

  try {
    if (!payload.messages || payload.messages.length === 0) {
      throw new Error("No messages in payload")
    }

    const title = payload.title ?? (await deriveTitle(payload.messages))
    const threadId = `thread-${randomUUID()}`
    const now = new Date()

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
      tags: [],
      projectSlug: null,
      ownerName: importedBy,
      whyItMatters: null,
      sourcePayloadJson: payload.metadata ?? null,
      parentThreadId: null,
      promotedFromId: null,
      pulledFromId: null,
      visibleInStudio: 1,
      messageCount: payload.messages.length,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    })

    const msgs = payload.messages.map((m, i) => ({
      id: `msg-${threadId}-${i}`,
      workspaceId,
      threadId,
      role: m.role === "human" ? "user" : m.role,
      content: m.content,
      turnIndex: i,
      metadataJson: null,
      createdAt: m.timestamp ? new Date(m.timestamp) : now,
    }))

    await insertThreadMessages(msgs)
    await completeImportRun(workspaceId, runId, 1)

    return { importRunId: runId, threadCount: 1, dedupedCount: 0, errors: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    await completeImportRun(workspaceId, runId, 0, msg)
    return { importRunId: runId, threadCount: 0, dedupedCount: 0, errors }
  }
}

/** Import only specific files that the user selected from the discover preview. */
export async function importSelectedFiles(
  workspaceId: string,
  filePaths: string[],
  sourceApp: OperatorSourceApp,
  importedBy: string
): Promise<ImportResult> {
  const runId = `run-selected-${sourceApp}-${Date.now()}`

  await createImportRun({
    id: runId,
    workspaceId,
    sourceApp,
    importedBy,
  })

  const errors: string[] = []
  let imported = 0
  let deduped = 0

  for (const filePath of filePaths) {
    try {
      let session: ParsedSession | null = null
      switch (sourceApp) {
        case "claude":
        case "claude-code":
          session = parseClaudeFile(filePath)
          break
        case "codex":
          session = parseCodexFile(filePath)
          break
        default:
          errors.push(
            `File import isn't wired up for "${sourceApp}" — only claude and codex have filesystem importers.`
          )
          continue
      }

      if (session) {
        const result = await ingestSession(
          workspaceId,
          session,
          sourceApp,
          importedBy,
          runId
        )
        if (result.status === "created") imported++
        else deduped++
      } else {
        errors.push(`Could not parse: ${filePath}`)
      }
    } catch (err) {
      errors.push(
        `Failed ${filePath}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  await completeImportRun(
    workspaceId,
    runId,
    imported,
    errors.length > 0 ? errors.join("; ") : undefined
  )

  return {
    importRunId: runId,
    threadCount: imported,
    dedupedCount: deduped,
    errors,
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

/**
 * Ingest a parsed session, idempotent on `(workspaceId, sourceApp,
 * sourceThreadId)`. Returns:
 *   - `{status: "created", threadId}` on first ingest
 *   - `{status: "deduped", threadId}` when the thread already exists —
 *     we never overwrite existing content. If the upstream file has new
 *     messages, surface that as a staleness signal on the detail page
 *     rather than mutating in place.
 */
async function ingestSession(
  workspaceId: string,
  session: ParsedSession,
  sourceApp: OperatorSourceApp,
  importedBy: string,
  importRunId: string
): Promise<{ status: "created" | "deduped"; threadId: string }> {
  // Idempotency: if we already have a thread for this source + sourceThreadId
  // in this workspace, return it instead of crashing on the unique index.
  const existing = await findThreadBySourceKey(
    workspaceId,
    sourceApp,
    session.sourceThreadId
  )
  if (existing) {
    return { status: "deduped", threadId: existing.id }
  }

  const threadId = `thread-${randomUUID()}`
  const now = new Date()
  const title = await deriveTitle(session.messages)

  await insertThread({
    id: threadId,
    workspaceId,
    sourceApp,
    sourceThreadKey: session.sourceThreadId,
    sourceLocator:
      ((session.metadata as Record<string, unknown>)?.filePath as string) ??
      null,
    importedBy,
    importedAt: session.createdAt ? new Date(session.createdAt) : now,
    importRunId,
    rawTitle: title,
    rawSummary: null,
    promotedTitle: null,
    promotedSummary: null,
    privacyState: "private",
    reviewState: "imported",
    tags: [],
    projectSlug: null,
    ownerName: importedBy,
    whyItMatters: null,
    captureReason: null,
    sourcePayloadJson: session.metadata ?? null,
    parentThreadId: null,
    promotedFromId: null,
    pulledFromId: null,
    visibleInStudio: 1,
    messageCount: session.messages.length,
    promotedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const msgs = session.messages.map((m, i) => ({
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
  return { status: "created", threadId }
}
