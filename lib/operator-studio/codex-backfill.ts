import * as fs from "fs"
import { and, eq, sql } from "drizzle-orm"

import { getDb } from "../server/db/client"
import {
  operatorThreadMessages,
  operatorThreads,
} from "../server/db/schema"
import { parseCodexFile } from "./importers/codex"

/**
 * Backfill `codex_turn_id` into existing Codex message rows.
 *
 * The Codex importer used to drop `turn_id` on the floor — now that
 * the parser captures it and the helper at
 * `lib/operator-studio/source-deeplinks.ts` reads it for per-turn
 * deep links, we need to enrich already-imported rows or every
 * existing message-level "Open in Codex" stays dark.
 *
 * Strategy:
 *   1. Find every Codex thread with a non-null `sourceLocator`.
 *   2. Re-parse the .jsonl with the updated parser (which is a pure
 *      read — no side effects on disk).
 *   3. For each parsed message, locate the matching DB row by
 *      `(threadId, turnIndex)` and patch `metadataJson` with the
 *      `codex_turn_id` if we got one.
 *
 * Safe to run multiple times — the patch overwrites only when the
 * upstream parse produced a turn_id.
 */
export async function backfillCodexTurnIds(workspaceId?: string): Promise<{
  threadsScanned: number
  threadsUpdated: number
  messagesUpdated: number
  errors: Array<{ threadId: string; error: string }>
}> {
  const db = getDb()
  const threadConditions = workspaceId
    ? and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.sourceApp, "codex")
      )
    : eq(operatorThreads.sourceApp, "codex")
  const threads = await db
    .select({
      id: operatorThreads.id,
      workspaceId: operatorThreads.workspaceId,
      sourceLocator: operatorThreads.sourceLocator,
    })
    .from(operatorThreads)
    .where(threadConditions)

  let threadsUpdated = 0
  let messagesUpdated = 0
  const errors: Array<{ threadId: string; error: string }> = []

  for (const thread of threads) {
    if (!thread.sourceLocator) continue
    if (!fs.existsSync(thread.sourceLocator)) {
      errors.push({
        threadId: thread.id,
        error: `Source file no longer exists: ${thread.sourceLocator}`,
      })
      continue
    }
    const parsed = parseCodexFile(thread.sourceLocator)
    if (!parsed) {
      errors.push({
        threadId: thread.id,
        error: `Reparse returned null for ${thread.sourceLocator}`,
      })
      continue
    }

    let touched = 0
    // Patch in a transaction per thread so a failure mid-thread
    // doesn't leave half the messages enriched and half not.
    await db.transaction(async (tx) => {
      for (let i = 0; i < parsed.messages.length; i++) {
        const m = parsed.messages[i]
        const turnId = m.metadata?.codex_turn_id
        if (typeof turnId !== "string" || !turnId) continue
        const result = await tx
          .update(operatorThreadMessages)
          .set({
            // jsonb merge via a SQL `||` so we don't clobber any
            // future metadata other writers stash on the row.
            metadataJson: sql`COALESCE(${operatorThreadMessages.metadataJson}, '{}'::jsonb) || ${JSON.stringify({ codex_turn_id: turnId })}::jsonb`,
          })
          .where(
            and(
              eq(operatorThreadMessages.workspaceId, thread.workspaceId),
              eq(operatorThreadMessages.threadId, thread.id),
              eq(operatorThreadMessages.turnIndex, i)
            )
          )
        // drizzle's pg returns rowCount via the underlying QueryResult.
        const rowCount = (result as unknown as { rowCount?: number }).rowCount ?? 0
        if (rowCount > 0) touched += 1
      }
    })

    if (touched > 0) {
      threadsUpdated += 1
      messagesUpdated += touched
    }
  }

  return {
    threadsScanned: threads.length,
    threadsUpdated,
    messagesUpdated,
    errors,
  }
}
