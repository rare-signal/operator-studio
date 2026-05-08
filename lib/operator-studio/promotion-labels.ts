import "server-only"

import { and, asc, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorPromotionLabels } from "@/lib/server/db/schema"

/**
 * Workspace-scoped promotion labels.
 *
 * Admin-managed set of named flags. Each label has a display name +
 * an `aiContext` blurb that downstream AI consumers (Wayseer prompts,
 * KB generation) treat as the label's definition. Soft-deletable so
 * historical passages don't lose their label name when retired.
 */
export interface OperatorPromotionLabel {
  id: string
  workspaceId: string
  label: string
  aiContext: string
  icon: string | null
  color: string | null
  sortIndex: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

function toLabel(
  row: typeof operatorPromotionLabels.$inferSelect
): OperatorPromotionLabel {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    aiContext: row.aiContext,
    icon: row.icon,
    color: row.color,
    sortIndex: row.sortIndex,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  }
}

export async function listLabels(
  workspaceId: string,
  options: { includeArchived?: boolean } = {}
): Promise<OperatorPromotionLabel[]> {
  const db = getDb()
  const rows = options.includeArchived
    ? await db
        .select()
        .from(operatorPromotionLabels)
        .where(eq(operatorPromotionLabels.workspaceId, workspaceId))
        .orderBy(
          asc(operatorPromotionLabels.sortIndex),
          asc(operatorPromotionLabels.createdAt)
        )
    : await db
        .select()
        .from(operatorPromotionLabels)
        .where(
          and(
            eq(operatorPromotionLabels.workspaceId, workspaceId),
            isNull(operatorPromotionLabels.archivedAt)
          )
        )
        .orderBy(
          asc(operatorPromotionLabels.sortIndex),
          asc(operatorPromotionLabels.createdAt)
        )
  return rows.map(toLabel)
}

export async function getLabelById(
  workspaceId: string,
  id: string
): Promise<OperatorPromotionLabel | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorPromotionLabels)
    .where(
      and(
        eq(operatorPromotionLabels.workspaceId, workspaceId),
        eq(operatorPromotionLabels.id, id)
      )
    )
  return rows[0] ? toLabel(rows[0]) : null
}

export interface UpsertLabelInput {
  id?: string
  label: string
  aiContext?: string
  icon?: string | null
  color?: string | null
  sortIndex?: number
}

export async function createLabel(
  workspaceId: string,
  input: UpsertLabelInput
): Promise<OperatorPromotionLabel> {
  const db = getDb()
  const now = new Date()
  const id =
    input.id ??
    `lbl-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`
  await db.insert(operatorPromotionLabels).values({
    id,
    workspaceId,
    label: input.label.trim() || "Untitled",
    aiContext: input.aiContext ?? "",
    icon: input.icon ?? null,
    color: input.color ?? null,
    sortIndex: input.sortIndex ?? 0,
    createdAt: now,
    updatedAt: now,
  })
  const fresh = await getLabelById(workspaceId, id)
  if (!fresh) throw new Error("createLabel: failed to read back")
  return fresh
}

export async function updateLabel(
  workspaceId: string,
  id: string,
  patch: Partial<UpsertLabelInput>
): Promise<OperatorPromotionLabel | null> {
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorPromotionLabels)
    .set({
      ...(patch.label !== undefined ? { label: patch.label.trim() } : {}),
      ...(patch.aiContext !== undefined ? { aiContext: patch.aiContext } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.sortIndex !== undefined
        ? { sortIndex: patch.sortIndex }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(operatorPromotionLabels.workspaceId, workspaceId),
        eq(operatorPromotionLabels.id, id)
      )
    )
  return getLabelById(workspaceId, id)
}

/** Soft-delete. Use `deleteLabel` to hard-remove (which sets passages
 *  back to label_id = null via FK ON DELETE SET NULL). */
export async function archiveLabel(
  workspaceId: string,
  id: string
): Promise<OperatorPromotionLabel | null> {
  const db = getDb()
  await db
    .update(operatorPromotionLabels)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(operatorPromotionLabels.workspaceId, workspaceId),
        eq(operatorPromotionLabels.id, id)
      )
    )
  return getLabelById(workspaceId, id)
}

export async function unarchiveLabel(
  workspaceId: string,
  id: string
): Promise<OperatorPromotionLabel | null> {
  const db = getDb()
  await db
    .update(operatorPromotionLabels)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(operatorPromotionLabels.workspaceId, workspaceId),
        eq(operatorPromotionLabels.id, id)
      )
    )
  return getLabelById(workspaceId, id)
}

export async function deleteLabel(
  workspaceId: string,
  id: string
): Promise<boolean> {
  const db = getDb()
  const r = await db
    .delete(operatorPromotionLabels)
    .where(
      and(
        eq(operatorPromotionLabels.workspaceId, workspaceId),
        eq(operatorPromotionLabels.id, id)
      )
    )
  return (r.rowCount ?? 0) > 0
}
