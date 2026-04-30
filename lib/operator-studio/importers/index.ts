/**
 * Import orchestrator for Operator Studio.
 *
 * Coordinates discovery and ingestion from supported source apps into the
 * workspace-scoped Operator Studio tables. Source-specific behavior lives
 * in `ImporterModule`s registered below — adding a new source no longer
 * requires editing this file's switch statements.
 */

import { randomUUID } from "crypto"

import {
  appendThreadMessages,
  completeImportRun,
  createImportRun,
  findThreadBySourceKey,
  getThreadMessages,
  insertThread,
  insertThreadMessages,
  updateThreadRawTitle,
} from "../queries"
import type { OperatorSourceApp } from "../types"
import { deriveTitle } from "./generate-title"
import {
  getImporter,
  hasImporter,
  listImporters,
  registerImporter,
  type ImporterModule,
  type ParsedMessage,
  type ParsedSession,
  type SkippedItem,
} from "./_registry"
import { codexImporter } from "./codex"
import { claudeCodeImporter } from "./claude-code"
import { opencodeImporter } from "./opencode"

// ─── Registration ────────────────────────────────────────────────────────────
//
// Centralized so the set of supported sources is visible in one place.
// New sources: write the module, import it here, add the line.

registerImporter(codexImporter)
registerImporter(claudeCodeImporter)
registerImporter(opencodeImporter)

export { getImporter, hasImporter, listImporters }
export type {
  ImporterModule,
  ParsedMessage,
  ParsedSession,
  SkippedItem,
} from "./_registry"

/**
 * Source ids the dashboard / sessions / pulse loops should auto-ingest
 * and re-poll. This is the registry's enumeration — every registered
 * importer is a candidate for background sync. Replaces the
 * `["claude", "codex"]` hardcoded constants that used to live in
 * three places (and silently excluded any new source until someone
 * remembered to update them).
 */
export function getRegisteredSourceIds(): readonly OperatorSourceApp[] {
  return listImporters().map((i) => i.id)
}

// ─── Public entry-point types ────────────────────────────────────────────────

export interface ImportResult {
  importRunId: string
  /** Newly-inserted threads on this run. */
  threadCount: number
  /** Sessions skipped because a thread with that sourceThreadKey already exists. */
  dedupedCount: number
  /** Existing threads that grew because the upstream file gained turns. */
  appendedCount?: number
  /** Total turns appended across all updated threads. */
  appendedMessages?: number
  /**
   * Items found-but-not-ingested by the parser, with reasons. Distinct
   * from `errors` (which is for orchestrator-level failures): a parser
   * skip means "we found this file/row, couldn't read it, kept going."
   * Surfaced in the API response so users can see what was rejected
   * without having to pull a debug trace from their machine.
   */
  skipped: SkippedItem[]
  errors: string[]
}

// ─── Public entry points ─────────────────────────────────────────────────────

/** Import every discoverable session from a given source app. */
export async function importFromSource(
  workspaceId: string,
  sourceApp: OperatorSourceApp,
  importedBy: string
): Promise<ImportResult> {
  const runId = `run-${sourceApp}-${Date.now()}`
  await createImportRun({ id: runId, workspaceId, sourceApp, importedBy })

  const importer = getImporter(sourceApp)
  if (!importer) {
    const err = unsupportedSourceMessage(sourceApp)
    await completeImportRun(workspaceId, runId, 0, err)
    return emptyResult(runId, [err])
  }

  let sessions: ParsedSession[] = []
  let parserSkipped: SkippedItem[] = []
  const errors: string[] = []

  try {
    const result = importer.discover()
    sessions = result.sessions
    parserSkipped = result.skipped
  } catch (err) {
    // discover() shouldn't throw — but if it does, treat the whole run
    // as failed rather than silently importing nothing.
    errors.push(
      `Discovery failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const ingest = await ingestAll(
    workspaceId,
    sessions,
    importer,
    importedBy,
    runId,
    errors
  )

  return finalize(workspaceId, runId, ingest, parserSkipped, errors)
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

  const importer = getImporter(sourceApp)
  if (!importer || !importer.supportsSingleImport) {
    const reason = importer
      ? `Single-file import isn't supported for "${sourceApp}".`
      : unsupportedSourceMessage(sourceApp)
    await completeImportRun(workspaceId, runId, 0, reason)
    return emptyResult(runId, [reason])
  }

  const errors: string[] = []
  const skipped: SkippedItem[] = []
  let sessions: ParsedSession[] = []

  const parseResult = importer.parseOne(filePath)
  if (parseResult.ok) {
    sessions = [parseResult.session]
  } else {
    skipped.push({
      locator: parseResult.locator,
      reason: parseResult.reason,
    })
  }

  const ingest = await ingestAll(
    workspaceId,
    sessions,
    importer,
    importedBy,
    runId,
    errors
  )

  return finalize(workspaceId, runId, ingest, skipped, errors)
}

/** Import only specific files that the user selected from the discover preview. */
export async function importSelectedFiles(
  workspaceId: string,
  filePaths: string[],
  sourceApp: OperatorSourceApp,
  importedBy: string
): Promise<ImportResult> {
  const runId = `run-selected-${sourceApp}-${Date.now()}`
  await createImportRun({ id: runId, workspaceId, sourceApp, importedBy })

  const importer = getImporter(sourceApp)
  if (!importer || !importer.supportsSingleImport) {
    const reason = importer
      ? `Single-file import isn't supported for "${sourceApp}".`
      : unsupportedSourceMessage(sourceApp)
    await completeImportRun(workspaceId, runId, 0, reason)
    return emptyResult(runId, [reason])
  }

  const errors: string[] = []
  const skipped: SkippedItem[] = []
  const sessions: ParsedSession[] = []

  for (const filePath of filePaths) {
    const result = importer.parseOne(filePath)
    if (result.ok) sessions.push(result.session)
    else skipped.push({ locator: result.locator, reason: result.reason })
  }

  const ingest = await ingestAll(
    workspaceId,
    sessions,
    importer,
    importedBy,
    runId,
    errors
  )

  return finalize(workspaceId, runId, ingest, skipped, errors)
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

  await createImportRun({ id: runId, workspaceId, sourceApp, importedBy })

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
    return {
      importRunId: runId,
      threadCount: 1,
      dedupedCount: 0,
      skipped: [],
      errors: [],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await completeImportRun(workspaceId, runId, 0, msg)
    return emptyResult(runId, [msg])
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface IngestTallies {
  imported: number
  deduped: number
  appendedThreads: number
  appendedMessages: number
}

async function ingestAll(
  workspaceId: string,
  sessions: ParsedSession[],
  importer: ImporterModule,
  importedBy: string,
  runId: string,
  errors: string[]
): Promise<IngestTallies> {
  const tallies: IngestTallies = {
    imported: 0,
    deduped: 0,
    appendedThreads: 0,
    appendedMessages: 0,
  }

  for (const session of sessions) {
    try {
      const result = await ingestSession(
        workspaceId,
        session,
        importer,
        importedBy,
        runId
      )
      if (result.status === "created") tallies.imported++
      else if (result.status === "appended") {
        tallies.appendedThreads++
        tallies.appendedMessages += result.appendedMessages
      } else tallies.deduped++
    } catch (err) {
      errors.push(
        `Failed to import ${session.sourceThreadId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }
  return tallies
}

async function finalize(
  workspaceId: string,
  runId: string,
  tallies: IngestTallies,
  skipped: SkippedItem[],
  errors: string[]
): Promise<ImportResult> {
  // The import-run row gets a status of "failed" only when there are
  // hard errors. Parser skips are non-fatal — they're recorded in the
  // result payload (and we stash a one-line summary into `error` so it
  // appears in `getRecentImportRuns` for operator visibility) but they
  // do not flip the run's status.
  const parts: string[] = []
  if (errors.length) parts.push(errors.join("; "))
  if (skipped.length)
    parts.push(`${skipped.length} parser skip${skipped.length === 1 ? "" : "s"}`)
  await completeImportRun(
    workspaceId,
    runId,
    tallies.imported,
    errors.length ? parts.join("; ") : undefined
  )

  return {
    importRunId: runId,
    threadCount: tallies.imported,
    dedupedCount: tallies.deduped,
    appendedCount: tallies.appendedThreads,
    appendedMessages: tallies.appendedMessages,
    skipped,
    errors,
  }
}

function emptyResult(runId: string, errors: string[]): ImportResult {
  return {
    importRunId: runId,
    threadCount: 0,
    dedupedCount: 0,
    skipped: [],
    errors,
  }
}

function unsupportedSourceMessage(sourceApp: string): string {
  return `Local discovery isn't wired up for "${sourceApp}" — paste / ingest endpoint accepts every source.`
}

/**
 * Ingest a parsed session, idempotent on `(workspaceId, sourceApp,
 * sourceThreadId)`. Three possible outcomes:
 *
 *   - `{status: "created", threadId}` — first time we've seen this id.
 *   - `{status: "appended", threadId, appendedMessages}` — thread
 *     existed, upstream grew, missing turns appended in turnIndex order.
 *   - `{status: "deduped", threadId}` — thread existed, upstream
 *     unchanged (or shorter, which we never trust).
 *
 * Append-on-grow trusts positional equivalence by turnIndex. Works
 * because every supported source today is append-only at the message
 * level. SQLite-backed sources (OpenCode) preserve this property by
 * ordering rows on `time_created`.
 */
async function ingestSession(
  workspaceId: string,
  session: ParsedSession,
  importer: ImporterModule,
  importedBy: string,
  importRunId: string
): Promise<
  | { status: "created"; threadId: string }
  | { status: "deduped"; threadId: string }
  | { status: "appended"; threadId: string; appendedMessages: number }
> {
  const sourceApp = importer.id
  const existing = await findThreadBySourceKey(
    workspaceId,
    sourceApp,
    session.sourceThreadId
  )

  if (existing) {
    // Auto-heal the title — pick up upstream-assigned AI titles even
    // post-import. We only overwrite raw_title; never promoted_title.
    if (
      session.title &&
      session.title !== existing.rawTitle &&
      !existing.promotedTitle
    ) {
      await updateThreadRawTitle(workspaceId, existing.id, session.title)
    }

    const storedMessages = await getThreadMessages(workspaceId, existing.id)
    const storedCount = storedMessages.length
    const upstreamCount = session.messages.length

    if (upstreamCount > storedCount) {
      const newTurns = session.messages.slice(storedCount)
      const now = new Date()
      const appendedCount = await appendThreadMessages(
        workspaceId,
        existing.id,
        storedCount,
        newTurns.map((m) => ({
          role: m.role,
          content: m.content,
          createdAt: m.timestamp ? new Date(m.timestamp) : now,
          metadataJson: importer.deriveMessageMetadata?.(m) ?? null,
        }))
      )
      return {
        status: "appended",
        threadId: existing.id,
        appendedMessages: appendedCount,
      }
    }

    return { status: "deduped", threadId: existing.id }
  }

  const threadId = `thread-${randomUUID()}`
  const now = new Date()
  const title = session.title ?? (await deriveTitle(session.messages))

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
    metadataJson: importer.deriveMessageMetadata?.(m) ?? null,
    createdAt: m.timestamp ? new Date(m.timestamp) : now,
  }))

  await insertThreadMessages(msgs)
  return { status: "created", threadId }
}
