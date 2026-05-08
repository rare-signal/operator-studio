import "server-only"

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorNotes, operatorPlanSteps } from "@/lib/server/db/schema"

/** Trash retention. Items in the trash older than this are purged
 *  lazily on the next trash-view fetch. Bump with care — the column
 *  has no separate "scheduled purge" job, so this window is effectively
 *  the recovery guarantee. */
export const TRASH_RETENTION_DAYS = 30

/**
 * Workspace-scoped scratchpad notes.
 *
 * The notes tree mirrors the plan-step parent/child shape so a note (or a
 * parent + descendants) can be promoted to plan steps in-place. Single
 * parent per node, arbitrary depth.
 */
export interface OperatorNote {
  id: string
  workspaceId: string
  parentNoteId: string | null
  title: string
  body: string | null
  /** lucide-react icon name (e.g. "Star"). Null = bullet fallback. */
  icon: string | null
  sortIndex: number
  createdAt: string
  updatedAt: string
  /** Set when soft-deleted; null for active notes. */
  deletedAt: string | null
}

function toNote(row: typeof operatorNotes.$inferSelect): OperatorNote {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    parentNoteId: row.parentNoteId,
    title: row.title,
    body: row.body,
    icon: row.icon ?? null,
    sortIndex: row.sortIndex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  }
}

export async function listNotes(
  workspaceId: string
): Promise<OperatorNote[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNull(operatorNotes.deletedAt)
      )
    )
    .orderBy(asc(operatorNotes.sortIndex), asc(operatorNotes.createdAt))
  return rows.map(toNote)
}

/** Fetch by id. Active-only by default; pass `includeDeleted` for the
 *  restore/purge paths that need to read tombstoned rows. */
export async function getNoteById(
  workspaceId: string,
  noteId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<OperatorNote | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        eq(operatorNotes.id, noteId),
        opts.includeDeleted ? undefined : isNull(operatorNotes.deletedAt)
      )
    )
    .limit(1)
  return rows[0] ? toNote(rows[0]) : null
}

function genId(): string {
  return `note-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(
    36
  )}`
}

export async function createNote(
  workspaceId: string,
  opts: {
    parentNoteId?: string | null
    title?: string
    body?: string | null
    icon?: string | null
    sortIndex?: number
  } = {}
): Promise<OperatorNote> {
  const db = getDb()
  const now = new Date()
  // Default sort: append after the last *active* sibling. Tombstoned
  // siblings would inflate the next index pointlessly.
  let sortIndex = opts.sortIndex
  if (typeof sortIndex !== "number") {
    const siblings = await db
      .select({ max: sql<number>`COALESCE(MAX(${operatorNotes.sortIndex}), -1)` })
      .from(operatorNotes)
      .where(
        and(
          eq(operatorNotes.workspaceId, workspaceId),
          isNull(operatorNotes.deletedAt),
          opts.parentNoteId
            ? eq(operatorNotes.parentNoteId, opts.parentNoteId)
            : sql`${operatorNotes.parentNoteId} IS NULL`
        )
      )
    sortIndex = (siblings[0]?.max ?? -1) + 1
  }
  const row = {
    id: genId(),
    workspaceId,
    parentNoteId: opts.parentNoteId ?? null,
    title: opts.title ?? "",
    body: opts.body ?? null,
    icon: opts.icon ?? null,
    sortIndex,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(operatorNotes).values(row)
  return toNote(row as typeof operatorNotes.$inferSelect)
}

export async function updateNote(
  workspaceId: string,
  noteId: string,
  patch: { title?: string; body?: string | null; icon?: string | null }
): Promise<OperatorNote | null> {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorNotes)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        eq(operatorNotes.id, noteId)
      )
    )
  return getNoteById(workspaceId, noteId)
}

/**
 * Soft-delete a note and any of its currently-active descendants. Marks
 * a single grouping timestamp on every affected row so a later restore
 * can pull back the whole subtree as one unit.
 *
 * Already-deleted descendants (trashed at an earlier time) are NOT
 * touched — their original deletedAt stays so they remain individually
 * recoverable / individually subject to TTL purge.
 */
export async function deleteNote(
  workspaceId: string,
  noteId: string
): Promise<void> {
  const db = getDb()
  const target = await getNoteById(workspaceId, noteId)
  if (!target) return // already deleted or doesn't exist — no-op

  // Walk the active subtree client-side. Notes is a small table and the
  // whole workspace fits in one query; recursive CTE would be overkill.
  const activeRows = await db
    .select({ id: operatorNotes.id, parentNoteId: operatorNotes.parentNoteId })
    .from(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNull(operatorNotes.deletedAt)
      )
    )
  const childrenOf = new Map<string, string[]>()
  for (const r of activeRows) {
    if (!r.parentNoteId) continue
    const arr = childrenOf.get(r.parentNoteId) ?? []
    arr.push(r.id)
    childrenOf.set(r.parentNoteId, arr)
  }
  const ids: string[] = []
  const queue = [noteId]
  while (queue.length > 0) {
    const id = queue.shift()!
    ids.push(id)
    queue.push(...(childrenOf.get(id) ?? []))
  }

  const now = new Date()
  await db
    .update(operatorNotes)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        inArray(operatorNotes.id, ids)
      )
    )
}

/** Trash listing — newest deletions first. Lazily purges any rows whose
 *  retention window has elapsed before returning. */
export async function listTrash(
  workspaceId: string
): Promise<OperatorNote[]> {
  await purgeExpiredTrash(workspaceId)
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNotNull(operatorNotes.deletedAt)
      )
    )
    .orderBy(desc(operatorNotes.deletedAt))
  return rows.map(toNote)
}

/**
 * Bring a note (and any descendants still in the trash) back to active.
 * If the note's parent is itself still in trash — or the parent is gone
 * entirely — the restored note is re-parented to root so it doesn't
 * vanish into a hidden subtree on return.
 */
export async function restoreNote(
  workspaceId: string,
  noteId: string
): Promise<OperatorNote | null> {
  const db = getDb()
  const target = await getNoteById(workspaceId, noteId, { includeDeleted: true })
  if (!target || !target.deletedAt) return target

  // Walk descendants currently in trash. Same pattern as soft-delete:
  // pull the full deleted set and BFS in memory.
  const trashedRows = await db
    .select({ id: operatorNotes.id, parentNoteId: operatorNotes.parentNoteId })
    .from(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNotNull(operatorNotes.deletedAt)
      )
    )
  const childrenOf = new Map<string, string[]>()
  for (const r of trashedRows) {
    if (!r.parentNoteId) continue
    const arr = childrenOf.get(r.parentNoteId) ?? []
    arr.push(r.id)
    childrenOf.set(r.parentNoteId, arr)
  }
  const ids: string[] = []
  const queue = [noteId]
  while (queue.length > 0) {
    const id = queue.shift()!
    ids.push(id)
    queue.push(...(childrenOf.get(id) ?? []))
  }

  const now = new Date()
  // Decide the clicked note's parent. If the original parent is missing
  // from the active set after restore (i.e. still trashed and not part
  // of this restore batch — which it never is, since we restore from
  // the clicked node down), re-parent to root.
  const restoreSet = new Set(ids)
  const parentStillReachable =
    target.parentNoteId !== null && !restoreSet.has(target.parentNoteId)
      ? await getNoteById(workspaceId, target.parentNoteId)
      : null
  const newParent =
    target.parentNoteId === null
      ? null
      : parentStillReachable
        ? target.parentNoteId
        : null

  await db.transaction(async (tx) => {
    // Reparent the clicked note if needed.
    if (newParent !== target.parentNoteId) {
      await tx
        .update(operatorNotes)
        .set({ parentNoteId: newParent, updatedAt: now })
        .where(
          and(
            eq(operatorNotes.workspaceId, workspaceId),
            eq(operatorNotes.id, noteId)
          )
        )
    }
    // Clear deletedAt across the subtree.
    await tx
      .update(operatorNotes)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(
          eq(operatorNotes.workspaceId, workspaceId),
          inArray(operatorNotes.id, ids)
        )
      )
  })

  return getNoteById(workspaceId, noteId)
}

/** Permanently delete a single trashed note. Any deleted descendants
 *  cascade via the existing FK ON DELETE CASCADE. */
export async function purgeNote(
  workspaceId: string,
  noteId: string
): Promise<void> {
  const db = getDb()
  await db
    .delete(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        eq(operatorNotes.id, noteId),
        isNotNull(operatorNotes.deletedAt)
      )
    )
}

/** Permanently delete every trashed note for the workspace. */
export async function emptyTrash(workspaceId: string): Promise<void> {
  const db = getDb()
  await db
    .delete(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNotNull(operatorNotes.deletedAt)
      )
    )
}

/** Hard-delete trash rows whose retention window has elapsed. Cheap
 *  enough to call on every trash open; relies on the partial index
 *  `idx_os_notes_workspace_trash`. */
export async function purgeExpiredTrash(workspaceId: string): Promise<void> {
  const db = getDb()
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  )
  await db
    .delete(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNotNull(operatorNotes.deletedAt),
        lt(operatorNotes.deletedAt, cutoff)
      )
    )
}

/**
 * Reparent and/or reorder a note. Refuses to make a node the descendant of
 * itself (would create a cycle). Recompacts sibling sort_index so the new
 * position is exactly `targetSortIndex` and other siblings shift.
 */
export async function moveNote(
  workspaceId: string,
  noteId: string,
  opts: {
    parentNoteId: string | null
    targetSortIndex: number
  }
): Promise<OperatorNote | null> {
  const db = getDb()

  // Cycle check: walk up from the proposed parent. If we encounter noteId
  // anywhere, the move would orphan the subtree. Reject by no-op.
  if (opts.parentNoteId) {
    let cursor: string | null = opts.parentNoteId
    const seen = new Set<string>()
    while (cursor) {
      if (cursor === noteId) return getNoteById(workspaceId, noteId)
      if (seen.has(cursor)) break
      seen.add(cursor)
      const parent = await getNoteById(workspaceId, cursor)
      cursor = parent?.parentNoteId ?? null
    }
  }

  // Pull current siblings of the destination, excluding the moving note
  // and any tombstoned rows (which would otherwise renumber alongside
  // active siblings and re-introduce gaps when restored later).
  const siblings = await db
    .select()
    .from(operatorNotes)
    .where(
      and(
        eq(operatorNotes.workspaceId, workspaceId),
        isNull(operatorNotes.deletedAt),
        opts.parentNoteId
          ? eq(operatorNotes.parentNoteId, opts.parentNoteId)
          : sql`${operatorNotes.parentNoteId} IS NULL`
      )
    )
    .orderBy(asc(operatorNotes.sortIndex), asc(operatorNotes.createdAt))
  const filtered = siblings.filter((s) => s.id !== noteId)

  const clamped = Math.max(0, Math.min(opts.targetSortIndex, filtered.length))
  // Splice: insert moving id at clamped, then renumber 0..n-1.
  const ordered = [
    ...filtered.slice(0, clamped).map((s) => s.id),
    noteId,
    ...filtered.slice(clamped).map((s) => s.id),
  ]
  const now = new Date()
  // Renumber + reparent the moving note. One transaction so a failure
  // can't leave half the siblings renumbered.
  await db.transaction(async (tx) => {
    for (let i = 0; i < ordered.length; i++) {
      const id = ordered[i]
      if (id === noteId) {
        await tx
          .update(operatorNotes)
          .set({
            parentNoteId: opts.parentNoteId,
            sortIndex: i,
            updatedAt: now,
          })
          .where(
            and(
              eq(operatorNotes.workspaceId, workspaceId),
              eq(operatorNotes.id, id)
            )
          )
      } else {
        await tx
          .update(operatorNotes)
          .set({ sortIndex: i, updatedAt: now })
          .where(
            and(
              eq(operatorNotes.workspaceId, workspaceId),
              eq(operatorNotes.id, id)
            )
          )
      }
    }
  })
  return getNoteById(workspaceId, noteId)
}

/** Returns `noteId` plus every descendant, breadth-first. */
export async function getNoteSubtree(
  workspaceId: string,
  noteId: string
): Promise<OperatorNote[]> {
  const all = await listNotes(workspaceId)
  const byParent = new Map<string | null, OperatorNote[]>()
  for (const n of all) {
    const k = n.parentNoteId
    const arr = byParent.get(k) ?? []
    arr.push(n)
    byParent.set(k, arr)
  }
  const root = all.find((n) => n.id === noteId)
  if (!root) return []
  const out: OperatorNote[] = []
  const queue: OperatorNote[] = [root]
  while (queue.length > 0) {
    const cur = queue.shift()!
    out.push(cur)
    queue.push(...(byParent.get(cur.id) ?? []))
  }
  return out
}

// ─── Promote / demote ──────────────────────────────────────────────────────

/**
 * Materialize a note (and its descendants) as plan steps under `planId`,
 * preserving the parent/child shape. The root note is positioned at
 * (positionX, positionY); descendants get null positions so the canvas
 * grid layout takes over for them. Notes are deleted on success.
 */
export async function promoteNoteToPlanSteps(
  workspaceId: string,
  planId: string,
  noteId: string,
  opts: { positionX: number; positionY: number }
): Promise<{ rootStepId: string; createdStepIds: string[] }> {
  const db = getDb()
  const subtree = await getNoteSubtree(workspaceId, noteId)
  if (subtree.length === 0) {
    throw new Error(`note ${noteId} not found`)
  }

  // Highest existing step_order so new steps don't collide. Skip trashed
  // rows so the next-order allocation reflects the visible canvas.
  const maxOrderRow = await db
    .select({
      max: sql<number>`COALESCE(MAX(${operatorPlanSteps.stepOrder}), -1)`,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, planId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
  const baseOrder = (maxOrderRow[0]?.max ?? -1) + 1

  // Map noteId → newly-allocated stepId so we can rewrite parent links.
  const idMap = new Map<string, string>()
  for (const n of subtree) {
    idMap.set(n.id, `step-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`)
  }

  const now = new Date()
  const rootStepId = idMap.get(noteId)!
  await db.transaction(async (tx) => {
    for (let i = 0; i < subtree.length; i++) {
      const n = subtree[i]
      const isRoot = n.id === noteId
      await tx.insert(operatorPlanSteps).values({
        id: idMap.get(n.id)!,
        planId,
        workspaceId,
        title: n.title || "(untitled)",
        description: n.body,
        stepOrder: baseOrder + i,
        status: "open",
        parentStepId: n.parentNoteId ? idMap.get(n.parentNoteId) ?? null : null,
        positionX: isRoot ? opts.positionX : null,
        positionY: isRoot ? opts.positionY : null,
        createdAt: now,
        updatedAt: now,
      })
    }
    // Delete the notes (subtree). Order-independent thanks to FK
    // ON DELETE CASCADE — but we explicitly target the root and let
    // the cascade clean up children.
    await tx
      .delete(operatorNotes)
      .where(
        and(
          eq(operatorNotes.workspaceId, workspaceId),
          eq(operatorNotes.id, noteId)
        )
      )
  })

  return {
    rootStepId,
    createdStepIds: Array.from(idMap.values()),
  }
}

/**
 * Reverse direction — convert a plan step (and its descendants in the
 * plan) into notes, then delete the steps. Used when the user drags a
 * card off the canvas back into the notes drawer.
 */
export async function demoteStepToNotes(
  workspaceId: string,
  planId: string,
  stepId: string,
  opts: { parentNoteId: string | null; sortIndex: number }
): Promise<{ rootNoteId: string }> {
  const db = getDb()
  // Pull every step in the plan once and walk locally — keeps us to one
  // SELECT regardless of depth. Skip trashed rows so demote-to-notes only
  // converts what's visible on the canvas.
  const allSteps = await db
    .select()
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, planId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
  const root = allSteps.find((s) => s.id === stepId)
  if (!root) throw new Error(`step ${stepId} not found in plan ${planId}`)

  const byParent = new Map<string | null, typeof allSteps>()
  for (const s of allSteps) {
    const arr = byParent.get(s.parentStepId) ?? []
    arr.push(s)
    byParent.set(s.parentStepId, arr)
  }
  const ordered: typeof allSteps = []
  const queue = [root]
  while (queue.length > 0) {
    const cur = queue.shift()!
    ordered.push(cur)
    queue.push(...(byParent.get(cur.id) ?? []))
  }

  // Allocate new note ids and remap parent links. Bump siblings under
  // the destination so the new root lands at sortIndex.
  const idMap = new Map<string, string>()
  for (const s of ordered) idMap.set(s.id, genId())
  const now = new Date()

  await db.transaction(async (tx) => {
    // Shift destination siblings ≥ sortIndex up by one. Skip trashed
    // rows — they're not in the visible ordering anyway.
    await tx
      .update(operatorNotes)
      .set({ sortIndex: sql`${operatorNotes.sortIndex} + 1`, updatedAt: now })
      .where(
        and(
          eq(operatorNotes.workspaceId, workspaceId),
          isNull(operatorNotes.deletedAt),
          opts.parentNoteId
            ? eq(operatorNotes.parentNoteId, opts.parentNoteId)
            : sql`${operatorNotes.parentNoteId} IS NULL`,
          sql`${operatorNotes.sortIndex} >= ${opts.sortIndex}`
        )
      )
    for (let i = 0; i < ordered.length; i++) {
      const s = ordered[i]
      const isRoot = s.id === stepId
      await tx.insert(operatorNotes).values({
        id: idMap.get(s.id)!,
        workspaceId,
        parentNoteId: isRoot
          ? opts.parentNoteId
          : s.parentStepId
            ? idMap.get(s.parentStepId) ?? null
            : null,
        title: s.title,
        body: s.description ?? null,
        sortIndex: isRoot ? opts.sortIndex : i,
        createdAt: now,
        updatedAt: now,
      })
    }
    // Soft-delete the original step + every descendant we just demoted
    // to notes. Stamps `deleted_at` so the rows stay recoverable from
    // trash; active reads filter them out, which removes them from the
    // canvas. (Previously this was a hard delete that cascaded via FK.)
    const demotedIds = ordered.map((s) => s.id)
    await tx
      .update(operatorPlanSteps)
      .set({ deletedAt: now, updatedAt: now })
      .where(
        and(
          eq(operatorPlanSteps.workspaceId, workspaceId),
          inArray(operatorPlanSteps.id, demotedIds)
        )
      )
  })

  return { rootNoteId: idMap.get(stepId)! }
}
