/**
 * Fork divergence detection — shared across Pulse (session-scoped graph
 * rendering) and the thread detail page (per-thread deep-dive).
 *
 * Two kinds of fork families in this product:
 *
 *   1. Explicit parent/child — thread B has parentThreadId = A. Created
 *      by the in-app "Fork" action, which copies A's messages into B as
 *      frozen context and then lets the operator keep chatting.
 *   2. Kickoff siblings — threads with the same (or near-identical)
 *      opening message, imported from separate agent sessions that
 *      were each started from a shared prompt template. These DON'T
 *      share a parentThreadId but DO share a large verbatim prefix.
 *
 * Both cases leave the child thread with a block of "inherited" turns
 * at the top — not original work, just carried context. The thread
 * detail view wants to collapse that block by default and jump the
 * reader straight to the fork point.
 *
 * Algorithm (canonical-source, lifted from load-pulse):
 *
 *   1. Find candidate siblings for the target thread. For kickoff
 *      siblings: threads in the same workspace whose first-60-char
 *      title signature matches. For explicit parent/child: walk
 *      parentThreadId pointers back to a root, then include all
 *      siblings of the root.
 *   2. Load all siblings' messages.
 *   3. Walk members in birth order (earliest firstAt first) and stake
 *      claims on unique content keys. Whoever saw a given message
 *      content FIRST owns it canonically.
 *   4. For the target thread, the first message whose owner is itself
 *      = its fork point. Everything before that was inherited.
 *
 * Result: the target thread's divergedAtTurnIndex + inheritedCount +
 * a short list of sibling ids for display in the UI.
 */

import "server-only"

import { and, eq, inArray, ne } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorThreadMessages,
  operatorThreads,
} from "@/lib/server/db/schema"
import type { OperatorThread } from "@/lib/operator-studio/types"

// ─── Text signatures ──────────────────────────────────────────────────────

/** Normalize a title for kickoff-sibling grouping — collapse whitespace,
 *  lowercase, slice to 60 chars. Mirrors load-pulse.ts. */
export function titleSignature(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60)
}

/** Content signature for canonical-source ownership. Bounded length so
 *  comparing hundreds of messages per thread stays cheap. */
export function contentKey(content: string): string {
  return content.trim().replace(/\s+/g, " ").slice(0, 500).toLowerCase()
}

// ─── Result shape ─────────────────────────────────────────────────────────

export interface ThreadForkContext {
  /** First message turn index (0-based) that this thread OWNS —
   *  i.e., the first message whose content is not claimed by any
   *  earlier-born sibling. Zero means no inheritance. */
  divergedAtTurnIndex: number
  /** How many turns of this thread were inherited from siblings. */
  inheritedCount: number
  /** Target thread itself is the earliest-born member of the family
   *  (the "origin" everyone else inherits from). */
  isForkOrigin: boolean
  /** Fellow family members, sorted by firstAt ascending. Display info
   *  only — not all of this thread's messages came from any single
   *  sibling, since the canonical algorithm tracks per-message. */
  siblings: Array<{
    id: string
    title: string
    firstAt: string | null
    messageCount: number
  }>
  /** Machine-detectable family kind — surfaced for UI copy. */
  kind: "kickoff-siblings" | "explicit-parent" | "none"
}

// ─── Query ────────────────────────────────────────────────────────────────

/**
 * Compute the fork context for a single thread.
 *
 * Returns `divergedAtTurnIndex = 0` and `inheritedCount = 0` when the
 * thread has no detectable family (lone thread, unique title, no
 * parent pointer). Callers can branch on `kind === "none"` to skip
 * rendering fork UI entirely.
 */
export async function getThreadForkContext(
  workspaceId: string,
  threadId: string
): Promise<ThreadForkContext> {
  const db = getDb()

  // 1. Load the target thread.
  const targetRows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        eq(operatorThreads.id, threadId)
      )
    )
    .limit(1)
  const target = targetRows[0]
  if (!target) {
    return emptyContext()
  }

  // 2. Detect the family.
  //    (a) If target has a parentThreadId, walk the chain back to the
  //        root. All threads that share this root (direct/transitive
  //        children) form the explicit fork family.
  //    (b) Otherwise, find workspace threads with a matching title
  //        signature as kickoff siblings. We scope to workspace (not
  //        whole DB) so cross-workspace forks don't pollute.
  const targetTitle = target.promotedTitle ?? target.rawTitle ?? ""
  const targetSig = titleSignature(targetTitle)

  let familyIds: string[] = [target.id]
  let kind: ThreadForkContext["kind"] = "none"

  if (target.parentThreadId) {
    // Walk back to root. Depth is bounded by the number of threads in
    // the workspace; a single-query recursive CTE would be cleaner but
    // loops are fine at this scale.
    const seen = new Set<string>([target.id])
    let cursor = target.parentThreadId
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const pr = await db
        .select()
        .from(operatorThreads)
        .where(
          and(
            eq(operatorThreads.workspaceId, workspaceId),
            eq(operatorThreads.id, cursor)
          )
        )
        .limit(1)
      const p = pr[0]
      if (!p) break
      if (!p.parentThreadId) break
      cursor = p.parentThreadId
    }
    const rootId = cursor ?? target.id
    // Everyone whose transitive-root is rootId. Simplest: all threads
    // whose parentThreadId equals rootId or target's ancestors. For
    // MVP we just include direct children of the root + the root.
    const kids = await db
      .select()
      .from(operatorThreads)
      .where(
        and(
          eq(operatorThreads.workspaceId, workspaceId),
          eq(operatorThreads.parentThreadId, rootId)
        )
      )
    familyIds = [rootId, ...kids.map((k) => k.id)]
    if (!familyIds.includes(target.id)) familyIds.push(target.id)
    kind = "explicit-parent"
  } else if (targetSig) {
    // Kickoff siblings — pull workspace threads, filter by signature.
    // For a real scale we'd want a generated column on title_signature;
    // at ~1k threads this is fine.
    const candidates = await db
      .select({
        id: operatorThreads.id,
        rawTitle: operatorThreads.rawTitle,
        promotedTitle: operatorThreads.promotedTitle,
      })
      .from(operatorThreads)
      .where(eq(operatorThreads.workspaceId, workspaceId))
    familyIds = candidates
      .filter(
        (c) =>
          titleSignature(c.promotedTitle ?? c.rawTitle ?? "") === targetSig
      )
      .map((c) => c.id)
    if (!familyIds.includes(target.id)) familyIds.push(target.id)
    if (familyIds.length >= 2) kind = "kickoff-siblings"
  }

  if (kind === "none" || familyIds.length < 2) {
    return emptyContext()
  }

  // 3. Load family members + their messages.
  const familyRows = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.workspaceId, workspaceId),
        inArray(operatorThreads.id, familyIds)
      )
    )

  const messageRows = await db
    .select({
      threadId: operatorThreadMessages.threadId,
      content: operatorThreadMessages.content,
      turnIndex: operatorThreadMessages.turnIndex,
      createdAt: operatorThreadMessages.createdAt,
    })
    .from(operatorThreadMessages)
    .where(
      and(
        eq(operatorThreadMessages.workspaceId, workspaceId),
        inArray(operatorThreadMessages.threadId, familyIds)
      )
    )
    .orderBy(operatorThreadMessages.turnIndex)

  const byThread = new Map<
    string,
    Array<{ content: string; turnIndex: number; createdAt: Date }>
  >()
  for (const m of messageRows) {
    const bucket = byThread.get(m.threadId) ?? []
    bucket.push({
      content: m.content,
      turnIndex: m.turnIndex,
      createdAt: m.createdAt,
    })
    byThread.set(m.threadId, bucket)
  }

  // 4. Sort members by firstAt ascending (earliest = origin).
  const membersSorted = familyRows
    .map((f) => {
      const ms = byThread.get(f.id) ?? []
      const firstAt = ms[0]?.createdAt ?? null
      return {
        thread: f,
        messages: ms,
        firstAt: firstAt ? firstAt.toISOString() : null,
      }
    })
    .filter((m) => m.messages.length > 0)
    .sort((a, b) => {
      if (!a.firstAt && !b.firstAt) return 0
      if (!a.firstAt) return 1
      if (!b.firstAt) return -1
      return a.firstAt.localeCompare(b.firstAt)
    })

  // 5. Canonical-source pass: earlier members stake claims on unique
  //    content keys. Whoever said it first "owns" it.
  const canonical = new Map<string, string>()
  for (const { thread, messages } of membersSorted) {
    for (const m of messages) {
      const key = contentKey(m.content)
      if (!canonical.has(key)) canonical.set(key, thread.id)
    }
  }

  // 6. For the target thread: first message whose canonical owner is
  //    itself. That's its divergence.
  const targetMessages = byThread.get(target.id) ?? []
  let divergedAtTurnIndex = 0
  let inheritedCount = 0
  let foundDivergence = false
  for (let i = 0; i < targetMessages.length; i++) {
    const key = contentKey(targetMessages[i].content)
    if (canonical.get(key) === target.id) {
      divergedAtTurnIndex = targetMessages[i].turnIndex
      foundDivergence = true
      break
    }
    inheritedCount++
  }
  // If no message is canonically the target's, it's a pure mirror of
  // an earlier sibling — treat the whole thread as inherited.
  if (!foundDivergence && targetMessages.length > 0) {
    divergedAtTurnIndex = targetMessages[targetMessages.length - 1].turnIndex + 1
    inheritedCount = targetMessages.length
  }

  const isForkOrigin = membersSorted[0]?.thread.id === target.id

  return {
    divergedAtTurnIndex,
    inheritedCount,
    isForkOrigin,
    siblings: membersSorted
      .filter((m) => m.thread.id !== target.id)
      .map((m) => ({
        id: m.thread.id,
        title: m.thread.promotedTitle ?? m.thread.rawTitle ?? `Thread ${m.thread.id.slice(0, 6)}`,
        firstAt: m.firstAt,
        messageCount: m.messages.length,
      })),
    kind,
  }
}

function emptyContext(): ThreadForkContext {
  return {
    divergedAtTurnIndex: 0,
    inheritedCount: 0,
    isForkOrigin: true,
    siblings: [],
    kind: "none",
  }
}
