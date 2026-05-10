import { randomUUID } from "node:crypto"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  adoAssignmentHistory,
  adoComments,
  adoItems,
  adoPriorityHistory,
  adoRevisions,
  adoStateHistory,
  identityAliases,
  ingestSnapshots,
} from "@/lib/server/db/ado-read-model-schema"

/**
 * L1 ADO read-model — local mirror of upstream ADO state.
 *
 * Per `step-ado-ingest-schema-and-poller`. The poller calls
 * persistAdoTick() once per tick with whatever it observed; the
 * writer is responsible for:
 *   - upserting current state into ado_items,
 *   - appending a row into ado_revisions when (work_item_id, rev) is
 *     unseen, including a per-field diff vs the prior ado_items row,
 *   - appending into ado_assignment_history / ado_priority_history /
 *     ado_state_history when those specific fields change,
 *   - upserting comments into ado_comments,
 *   - recording one ingest_snapshots row for the tick,
 *   - recording observed identities in identity_aliases.
 *
 * Read-only mirror — the writer never calls upstream ADO. Outbound
 * mutation flows through operator_outbox_messages under the PIN
 * gate.
 */

export interface AdoItemSnapshot {
  workItemId: number
  rev: number
  type: string | null
  title: string | null
  state: string | null
  priority: number | null
  assignedTo: string | null
  assignedToUniqueName: string | null
  createdBy: string | null
  changedBy: string | null
  changedAt: Date | null
  fields: Record<string, unknown>
}

export interface AdoCommentSnapshot {
  workItemId: number
  commentId: number
  createdBy: string | null
  createdAt: Date | null
  modifiedAt: Date | null
  bodyHtml: string | null
  bodyText: string | null
}

export interface AdoTickInput {
  workspaceId: string
  factoryId: string | null
  pollStartedAt: Date
  pollFinishedAt: Date
  items: AdoItemSnapshot[]
  comments: AdoCommentSnapshot[]
  errors: string[]
  fixtureMode?: boolean
}

export interface AdoTickResult {
  snapshotId: string
  itemsSeen: number
  itemsUpserted: number
  revisionsAppended: number
  commentsAppended: number
}

const TRACKED_FIELDS = [
  "type",
  "title",
  "state",
  "priority",
  "assignedTo",
  "assignedToUniqueName",
  "createdBy",
  "changedBy",
] as const

type TrackedField = (typeof TRACKED_FIELDS)[number]

interface PriorItemRow {
  rev: number
  type: string | null
  title: string | null
  state: string | null
  priority: number | null
  assignedTo: string | null
  assignedToUniqueName: string | null
  createdBy: string | null
  changedBy: string | null
}

/**
 * Pure diff between a prior ado_items row and a new snapshot.
 * Pulled out so it can be unit-tested without a live DB.
 *
 * Returns null when the new rev is not strictly greater than the
 * prior rev (i.e. the poller saw the same or older snapshot — common
 * on re-polls).
 */
export function diffItem(
  prior: PriorItemRow | null,
  next: AdoItemSnapshot
): {
  shouldAppendRevision: boolean
  changedFields: Record<string, { from: unknown; to: unknown }>
  stateChanged: { from: string | null; to: string | null } | null
  assignmentChanged: { from: string | null; to: string | null } | null
  priorityChanged: { from: number | null; to: number | null } | null
} {
  if (prior && next.rev <= prior.rev) {
    return {
      shouldAppendRevision: false,
      changedFields: {},
      stateChanged: null,
      assignmentChanged: null,
      priorityChanged: null,
    }
  }
  const changedFields: Record<string, { from: unknown; to: unknown }> = {}
  if (prior) {
    for (const f of TRACKED_FIELDS) {
      const a = prior[f] as unknown
      const b = next[f as TrackedField] as unknown
      if (a !== b) changedFields[f] = { from: a, to: b }
    }
  }
  return {
    shouldAppendRevision: true,
    changedFields,
    stateChanged:
      prior && prior.state !== next.state
        ? { from: prior.state, to: next.state }
        : null,
    assignmentChanged:
      prior && prior.assignedTo !== next.assignedTo
        ? { from: prior.assignedTo, to: next.assignedTo }
        : null,
    priorityChanged:
      prior && prior.priority !== next.priority
        ? { from: prior.priority, to: next.priority }
        : null,
  }
}

export async function persistAdoTick(
  input: AdoTickInput
): Promise<AdoTickResult> {
  const db = getDb()
  const snapshotId = randomUUID()
  const ingestedAt = new Date()
  const {
    workspaceId,
    factoryId,
    pollStartedAt,
    pollFinishedAt,
    items,
    comments,
    errors,
    fixtureMode,
  } = input

  let itemsUpserted = 0
  let revisionsAppended = 0
  let commentsAppended = 0

  for (const item of items) {
    const prior = await db
      .select({
        rev: adoItems.rev,
        type: adoItems.type,
        title: adoItems.title,
        state: adoItems.state,
        priority: adoItems.priority,
        assignedTo: adoItems.assignedTo,
        assignedToUniqueName: adoItems.assignedToUniqueName,
        createdBy: adoItems.createdBy,
        changedBy: adoItems.changedBy,
      })
      .from(adoItems)
      .where(
        and(
          eq(adoItems.workspaceId, workspaceId),
          eq(adoItems.workItemId, item.workItemId)
        )
      )
      .limit(1)

    const priorRow = (prior[0] as PriorItemRow | undefined) ?? null
    const diff = diffItem(priorRow, item)

    // Upsert ado_items only when the rev is new — ignore stale snapshots.
    if (!priorRow || item.rev > priorRow.rev) {
      if (priorRow) {
        await db
          .update(adoItems)
          .set({
            factoryId,
            rev: item.rev,
            type: item.type,
            title: item.title,
            state: item.state,
            priority: item.priority,
            assignedTo: item.assignedTo,
            assignedToUniqueName: item.assignedToUniqueName,
            createdBy: item.createdBy,
            changedBy: item.changedBy,
            changedAt: item.changedAt,
            fieldsJson: item.fields,
            lastSeenAt: ingestedAt,
          })
          .where(
            and(
              eq(adoItems.workspaceId, workspaceId),
              eq(adoItems.workItemId, item.workItemId)
            )
          )
      } else {
        await db.insert(adoItems).values({
          workspaceId,
          factoryId,
          workItemId: item.workItemId,
          rev: item.rev,
          type: item.type,
          title: item.title,
          state: item.state,
          priority: item.priority,
          assignedTo: item.assignedTo,
          assignedToUniqueName: item.assignedToUniqueName,
          createdBy: item.createdBy,
          changedBy: item.changedBy,
          changedAt: item.changedAt,
          fieldsJson: item.fields,
          firstSeenAt: ingestedAt,
          lastSeenAt: ingestedAt,
        })
      }
      itemsUpserted += 1
    } else {
      // Rev unchanged — just bump last_seen_at so we know the poller
      // observed it this tick.
      await db
        .update(adoItems)
        .set({ lastSeenAt: ingestedAt })
        .where(
          and(
            eq(adoItems.workspaceId, workspaceId),
            eq(adoItems.workItemId, item.workItemId)
          )
        )
    }

    if (diff.shouldAppendRevision) {
      try {
        await db.insert(adoRevisions).values({
          id: randomUUID(),
          workspaceId,
          factoryId,
          workItemId: item.workItemId,
          rev: item.rev,
          changedBy: item.changedBy,
          changedAt: item.changedAt,
          fieldsJson: item.fields,
          changedFieldsJson: diff.changedFields,
          snapshotId,
          ingestedAt,
        })
        revisionsAppended += 1
      } catch {
        // Unique violation on (workspace, item, rev) — already
        // appended on a prior tick. Safe to ignore.
      }

      if (diff.stateChanged) {
        await safeInsertHistory(
          adoStateHistory,
          {
            id: randomUUID(),
            workspaceId,
            factoryId,
            workItemId: item.workItemId,
            rev: item.rev,
            fromState: diff.stateChanged.from,
            toState: diff.stateChanged.to,
            changedBy: item.changedBy,
            changedAt: item.changedAt,
            snapshotId,
            ingestedAt,
          }
        )
      }
      if (diff.assignmentChanged) {
        await safeInsertHistory(
          adoAssignmentHistory,
          {
            id: randomUUID(),
            workspaceId,
            factoryId,
            workItemId: item.workItemId,
            rev: item.rev,
            fromAssignee: diff.assignmentChanged.from,
            toAssignee: diff.assignmentChanged.to,
            changedBy: item.changedBy,
            changedAt: item.changedAt,
            snapshotId,
            ingestedAt,
          }
        )
      }
      if (diff.priorityChanged) {
        await safeInsertHistory(
          adoPriorityHistory,
          {
            id: randomUUID(),
            workspaceId,
            factoryId,
            workItemId: item.workItemId,
            rev: item.rev,
            fromPriority: diff.priorityChanged.from,
            toPriority: diff.priorityChanged.to,
            changedBy: item.changedBy,
            changedAt: item.changedAt,
            snapshotId,
            ingestedAt,
          }
        )
      }
    }

    await recordIdentity(
      workspaceId,
      "ado",
      item.assignedToUniqueName,
      item.assignedTo,
      ingestedAt
    )
    await recordIdentity(
      workspaceId,
      "ado",
      null,
      item.changedBy,
      ingestedAt
    )
  }

  for (const c of comments) {
    const exists = await db
      .select({ id: adoComments.id })
      .from(adoComments)
      .where(
        and(
          eq(adoComments.workspaceId, workspaceId),
          eq(adoComments.workItemId, c.workItemId),
          eq(adoComments.commentId, c.commentId)
        )
      )
      .limit(1)
    if (exists.length === 0) {
      await db.insert(adoComments).values({
        id: randomUUID(),
        workspaceId,
        factoryId,
        workItemId: c.workItemId,
        commentId: c.commentId,
        createdBy: c.createdBy,
        createdAt: c.createdAt,
        modifiedAt: c.modifiedAt,
        bodyHtml: c.bodyHtml,
        bodyText: c.bodyText,
        snapshotId,
        ingestedAt,
      })
      commentsAppended += 1
    }
  }

  await db.insert(ingestSnapshots).values({
    id: snapshotId,
    workspaceId,
    factoryId,
    source: "ado",
    pollStartedAt,
    pollFinishedAt,
    itemsSeen: items.length,
    itemsUpserted,
    revisionsAppended,
    commentsAppended,
    errorsJson: errors,
    fixtureMode: fixtureMode ? 1 : 0,
    ingestedAt,
  })

  return {
    snapshotId,
    itemsSeen: items.length,
    itemsUpserted,
    revisionsAppended,
    commentsAppended,
  }
}

async function safeInsertHistory<T extends { id: string }>(
  table:
    | typeof adoAssignmentHistory
    | typeof adoPriorityHistory
    | typeof adoStateHistory,
  values: T
): Promise<void> {
  const db = getDb()
  try {
    // Drizzle's typing for the union of these tables is awkward;
    // each table's columns are validated by the SQL unique index,
    // and a duplicate (workspace, item, rev) is the only expected
    // failure mode here.
    await db.insert(table as never).values(values as never)
  } catch {
    // Duplicate per unique index — safe to ignore on re-polls.
  }
}

async function recordIdentity(
  workspaceId: string,
  surface: string,
  externalId: string | null,
  displayName: string | null,
  now: Date
): Promise<void> {
  if (!externalId || externalId.length === 0) return
  const db = getDb()
  const existing = await db
    .select({ id: identityAliases.id })
    .from(identityAliases)
    .where(
      and(
        eq(identityAliases.workspaceId, workspaceId),
        eq(identityAliases.surface, surface),
        eq(identityAliases.externalId, externalId)
      )
    )
    .limit(1)
  if (existing.length > 0) {
    await db
      .update(identityAliases)
      .set({ displayName, lastSeenAt: now })
      .where(eq(identityAliases.id, existing[0].id))
    return
  }
  try {
    await db.insert(identityAliases).values({
      id: randomUUID(),
      workspaceId,
      surface,
      externalId,
      displayName,
      canonicalId: externalId,
      firstSeenAt: now,
      lastSeenAt: now,
    })
  } catch {
    // Race on the unique index — another tick inserted concurrently.
  }
}
