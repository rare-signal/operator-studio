/**
 * Thread-done state — "this thread's purpose is fulfilled, stop
 * watching its lane."
 *
 * Two writers, one persisted state on `operator_threads`:
 *
 *   1. PHRASE — the operator types the configured sentinel as a user
 *      turn in the source chat. Detected lazily by readers: a thread
 *      with no `marked_done_at` is scanned once; on a hit, columns are
 *      stamped and never re-scanned. Whole-message match (case +
 *      whitespace insensitive) on USER turns only. Agent turns that
 *      quote the phrase are ignored; substring matches are ignored.
 *
 *   2. MANUAL — the operator clicks "Mark done" in Operator Studio's
 *      thread-detail header. Direct write to the same columns,
 *      `marked_done_source = 'manual'`, `marked_done_by = display
 *      name at click time`.
 *
 * The phrase string can change over time (env override) without
 * re-flagging history: existing rows are sticky. New phrase only
 * affects threads that have never been flagged.
 *
 * Reading: every consumer reads `marked_done_at` from the thread row.
 * No more scanning messages on every render.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorThreadMessages, operatorThreads } from "@/lib/server/db/schema"
import type { ThreadDoneSource } from "./types"

const DEFAULT_PHRASE = "All done in this chat, TY!"

/** Single source of truth for the active sentinel phrase. Override
 *  with OPERATOR_STUDIO_DONE_PHRASE in the environment. */
export function getActiveDonePhrase(): string {
  const envPhrase = process.env.OPERATOR_STUDIO_DONE_PHRASE
  if (typeof envPhrase === "string" && envPhrase.trim().length > 0) {
    return envPhrase.trim()
  }
  return DEFAULT_PHRASE
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

/** True when `content` exactly equals the active done phrase
 *  (case + whitespace insensitive). */
export function isDoneSignal(content: string, phrase?: string): boolean {
  const target = normalize(phrase ?? getActiveDonePhrase())
  if (!target) return false
  return normalize(content) === target
}

export interface DoneMessageLike {
  role: string
  content: string
  createdAt: string
  turnIndex?: number
}

export interface ThreadDoneStatus {
  markedDone: boolean
  markedDoneAt: string | null
  /** Turn index of the matching message — kept for a future
   *  "fork at the done inflection point" action. */
  markedDoneTurnIndex: number | null
}

/** Cheap pre-filter for SQL: lower(trim(content)) compared to the
 *  active phrase. SQL can't replicate the full whitespace-collapse
 *  rule, so call this for the prefilter and re-validate JS-side
 *  with `isDoneSignal`. */
export function donePhraseSqlNeedle(phrase?: string): string {
  return (phrase ?? getActiveDonePhrase()).trim().toLowerCase()
}

/** Find the FIRST user message in chronological order that matches
 *  the done signal. Pure — does not touch the DB. */
export function detectThreadDone(
  messages: readonly DoneMessageLike[],
  phrase?: string
): ThreadDoneStatus {
  const sorted = [...messages].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  )
  for (const m of sorted) {
    if (m.role !== "user") continue
    if (!isDoneSignal(m.content, phrase)) continue
    return {
      markedDone: true,
      markedDoneAt: m.createdAt,
      markedDoneTurnIndex: typeof m.turnIndex === "number" ? m.turnIndex : null,
    }
  }
  return { markedDone: false, markedDoneAt: null, markedDoneTurnIndex: null }
}

// ─── Persistence ────────────────────────────────────────────────────
// (HMR cache-bust — drizzle inArray bindings)


/** Stamp a thread as done. Idempotent — repeat calls update the
 *  source/by/at fields. */
export async function markThreadDone(
  workspaceId: string,
  threadId: string,
  opts: {
    source: ThreadDoneSource
    by: string
    at?: Date
  }
): Promise<void> {
  const db = getDb()
  const at = opts.at ?? new Date()
  await db
    .update(operatorThreads)
    .set({
      markedDoneAt: at,
      markedDoneBy: opts.by,
      markedDoneSource: opts.source,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.id, threadId)
      )
    )
}

/** Read the persisted done-set for a candidate list of thread ids.
 *  Cheap one-shot SELECT — no message-table touch. Use after
 *  `applyDonePhraseDetection` to pick up rows that were just stamped. */
export async function getPersistedDoneThreadIds(
  workspaceId: string,
  candidateIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>()
  if (candidateIds.length === 0) return out
  const db = getDb()
  const rows = await db
    .select({ id: operatorThreads.id })
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        inArray(operatorThreads.id, candidateIds),
        sql`${operatorThreads.markedDoneAt} IS NOT NULL`
      )
    )
  for (const r of rows) out.add(r.id)
  return out
}

/** Clear the done state from a thread, regardless of source. */
export async function unmarkThreadDone(
  workspaceId: string,
  threadId: string
): Promise<void> {
  const db = getDb()
  await db
    .update(operatorThreads)
    .set({
      markedDoneAt: null,
      markedDoneBy: null,
      markedDoneSource: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.id, threadId)
      )
    )
}

/**
 * Lazy phrase detection: for each thread id in `candidateIds` that
 * is NOT already marked done, look for a user-role message matching
 * the active phrase. On hit, stamp the row with source='phrase' and
 * the matching message's createdAt. Idempotent — already-done
 * threads are skipped.
 *
 * Call before reading `marked_done_at` so the column reflects any
 * un-stamped phrase matches in the candidate set. Cost is a single
 * query against the messages table filtered by the SQL prefilter,
 * plus per-row JS validation.
 *
 * Returns a map of newly-stamped thread ids to their `markedDoneAt`
 * timestamp so callers can patch their in-memory thread rows without
 * a follow-up SELECT.
 */
export async function applyDonePhraseDetection(
  workspaceId: string,
  candidateIds: string[]
): Promise<Map<string, Date>> {
  const newlyDone = new Map<string, Date>()
  if (candidateIds.length === 0) return newlyDone
  const db = getDb()
  const needle = donePhraseSqlNeedle()

  // Find candidate user messages: one row per (thread, message) pair
  // whose content matches the SQL needle and whose thread is not yet
  // marked done. We carry createdAt so we can stamp the right
  // timestamp on the first match.
  const rows = await db
    .select({
      threadId: operatorThreadMessages.threadId,
      content: operatorThreadMessages.content,
      createdAt: operatorThreadMessages.createdAt,
    })
    .from(operatorThreadMessages)
    .innerJoin(
      operatorThreads,
      and(
        eq(operatorThreads.id, operatorThreadMessages.threadId),
        eq(operatorThreads.workspaceId, operatorThreadMessages.workspaceId)
      )
    )
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        eq(operatorThreadMessages.role, "user"),
        inArray(operatorThreadMessages.threadId, candidateIds),
        isNull(operatorThreads.markedDoneAt),
        sql`lower(trim(${operatorThreadMessages.content})) = ${needle}`
      )
    )
    .orderBy(operatorThreadMessages.createdAt)

  // First match wins per thread (rows already ordered by createdAt
  // ascending). Re-validate with the strict JS rule so we never
  // stamp a thread on a SQL-only "looks-close-enough" hit.
  const earliest = new Map<string, Date>()
  for (const r of rows) {
    if (!isDoneSignal(r.content)) continue
    if (!earliest.has(r.threadId)) earliest.set(r.threadId, r.createdAt)
  }

  for (const [threadId, at] of earliest) {
    await markThreadDone(workspaceId, threadId, {
      source: "phrase",
      by: "phrase-detector",
      at,
    })
    newlyDone.set(threadId, at)
  }
  return newlyDone
}
