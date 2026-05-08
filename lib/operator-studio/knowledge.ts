import "server-only"

import { and, desc, eq, sql } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorKbClaims,
  operatorKbEntries,
  workspaceModules,
  type KbCitation,
} from "@/lib/server/db/schema"

/**
 * Knowledge Base — server queries.
 *
 * Two-layer model:
 *   - operator_kb_entries  : encyclopedic markdown articles
 *   - operator_kb_claims   : atomic, dated, sourced propositions
 *
 * The KB is an opt-in module (workspace_modules.knowledge_base.enabled = 1).
 * Surfaces gate on `isKbEnabled` before doing work.
 */

export const KB_MODULE_KEY = "knowledge_base"

export type KbEntryType =
  | "concept"
  | "pattern"
  | "metric"
  | "procedure"
  | "agent"
  | "comparison"
  | "anomaly"
  | "todo"
  | "report"

export type KbStability = "evergreen" | "stable" | "fluctuant" | "draft"

export const KB_ENTRY_TYPES: KbEntryType[] = [
  "concept",
  "pattern",
  "metric",
  "procedure",
  "agent",
  "comparison",
  "anomaly",
  "todo",
  "report",
]

export const KB_STABILITIES: KbStability[] = [
  "evergreen",
  "stable",
  "fluctuant",
  "draft",
]

export interface KbEntry {
  id: string
  workspaceId: string
  entryType: KbEntryType
  stability: KbStability
  title: string
  summary: string
  bodyMarkdown: string
  tags: string[]
  relatedEntryIds: string[]
  parentEntryId: string | null
  sourceThreadId: string | null
  sourcePassageIds: string[]
  citations: KbCitation[]
  lastVerifiedAt: string | null
  refreshIntervalHours: number | null
  nextRefreshAt: string | null
  lastUserEditAt: string | null
  lastUserEditBy: string | null
  modelProvider: string | null
  modelName: string | null
  promptVersion: string | null
  versionCount: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface KbClaim {
  id: string
  workspaceId: string
  statement: string
  subject: string | null
  confidence: number
  sourceThreadId: string | null
  sourceMessageId: string | null
  sourcePassageId: string | null
  sourceExcerpt: string | null
  validAt: string
  supersededById: string | null
  citedByEntryIds: string[]
  modelProvider: string | null
  modelName: string | null
  promptVersion: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function toEntry(row: typeof operatorKbEntries.$inferSelect): KbEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    entryType: row.entryType as KbEntryType,
    stability: row.stability as KbStability,
    title: row.title,
    summary: row.summary,
    bodyMarkdown: row.bodyMarkdown,
    tags: (row.tags ?? []) as string[],
    relatedEntryIds: (row.relatedEntryIds ?? []) as string[],
    parentEntryId: row.parentEntryId,
    sourceThreadId: row.sourceThreadId,
    sourcePassageIds: (row.sourcePassageIds ?? []) as string[],
    citations: (row.citations ?? []) as KbCitation[],
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    refreshIntervalHours: row.refreshIntervalHours,
    nextRefreshAt: row.nextRefreshAt?.toISOString() ?? null,
    lastUserEditAt: row.lastUserEditAt?.toISOString() ?? null,
    lastUserEditBy: row.lastUserEditBy,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    promptVersion: row.promptVersion,
    versionCount: row.versionCount,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toClaim(row: typeof operatorKbClaims.$inferSelect): KbClaim {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    statement: row.statement,
    subject: row.subject,
    confidence: row.confidence,
    sourceThreadId: row.sourceThreadId,
    sourceMessageId: row.sourceMessageId,
    sourcePassageId: row.sourcePassageId,
    sourceExcerpt: row.sourceExcerpt,
    validAt: row.validAt.toISOString(),
    supersededById: row.supersededById,
    citedByEntryIds: (row.citedByEntryIds ?? []) as string[],
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    promptVersion: row.promptVersion,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ─── Module enablement ──────────────────────────────────────────────

export async function isKbEnabled(workspaceId: string): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .select()
    .from(workspaceModules)
    .where(
      and(
        eq(workspaceModules.workspaceId, workspaceId),
        eq(workspaceModules.moduleKey, KB_MODULE_KEY)
      )
    )
  return rows.length > 0 && rows[0].enabled === 1
}

export async function setKbEnabled(
  workspaceId: string,
  enabled: boolean,
  enabledBy: string
): Promise<void> {
  const db = getDb()
  const now = new Date()
  await db
    .insert(workspaceModules)
    .values({
      workspaceId,
      moduleKey: KB_MODULE_KEY,
      enabled: enabled ? 1 : 0,
      enabledAt: enabled ? now : null,
      enabledBy: enabled ? enabledBy : null,
    })
    .onConflictDoUpdate({
      target: [workspaceModules.workspaceId, workspaceModules.moduleKey],
      set: {
        enabled: enabled ? 1 : 0,
        enabledAt: enabled ? now : null,
        enabledBy: enabled ? enabledBy : null,
      },
    })
}

// ─── Entries ────────────────────────────────────────────────────────

export async function listEntries(
  workspaceId: string
): Promise<KbEntry[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorKbEntries)
    .where(eq(operatorKbEntries.workspaceId, workspaceId))
    .orderBy(desc(operatorKbEntries.updatedAt))
  return rows.map(toEntry)
}

export async function getEntryById(
  workspaceId: string,
  id: string
): Promise<KbEntry | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorKbEntries)
    .where(
      and(
        eq(operatorKbEntries.workspaceId, workspaceId),
        eq(operatorKbEntries.id, id)
      )
    )
  return rows[0] ? toEntry(rows[0]) : null
}

export interface UpsertEntryInput {
  id?: string
  entryType: KbEntryType
  stability?: KbStability
  title: string
  summary?: string
  bodyMarkdown?: string
  tags?: string[]
  relatedEntryIds?: string[]
  parentEntryId?: string | null
  sourceThreadId?: string | null
  sourcePassageIds?: string[]
  citations?: KbCitation[]
  lastVerifiedAt?: string | null
  refreshIntervalHours?: number | null
  nextRefreshAt?: string | null
  modelProvider?: string | null
  modelName?: string | null
  promptVersion?: string | null
  metadata?: Record<string, unknown>
  /** Marks this write as a user edit (sets last_user_edit_*). */
  userEditBy?: string | null
}

function slugify(text: string, type: KbEntryType): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 96)
  return `${type}-${slug || "untitled"}`
}

export async function upsertEntry(
  workspaceId: string,
  input: UpsertEntryInput
): Promise<KbEntry> {
  const db = getDb()
  const now = new Date()
  const id = input.id ?? slugify(input.title, input.entryType)

  const existing = await db
    .select()
    .from(operatorKbEntries)
    .where(
      and(
        eq(operatorKbEntries.workspaceId, workspaceId),
        eq(operatorKbEntries.id, id)
      )
    )
  const isNew = existing.length === 0

  const baseValues = {
    title: input.title.trim() || "Untitled",
    summary: input.summary ?? "",
    bodyMarkdown: input.bodyMarkdown ?? "",
    entryType: input.entryType,
    stability: input.stability ?? "draft",
    tags: input.tags ?? [],
    relatedEntryIds: input.relatedEntryIds ?? [],
    parentEntryId: input.parentEntryId ?? null,
    sourceThreadId: input.sourceThreadId ?? null,
    sourcePassageIds: input.sourcePassageIds ?? [],
    citations: input.citations ?? [],
    lastVerifiedAt: input.lastVerifiedAt
      ? new Date(input.lastVerifiedAt)
      : null,
    refreshIntervalHours: input.refreshIntervalHours ?? null,
    nextRefreshAt: input.nextRefreshAt ? new Date(input.nextRefreshAt) : null,
    modelProvider: input.modelProvider ?? null,
    modelName: input.modelName ?? null,
    promptVersion: input.promptVersion ?? null,
    metadata: input.metadata ?? {},
    updatedAt: now,
  }

  if (isNew) {
    await db.insert(operatorKbEntries).values({
      id,
      workspaceId,
      ...baseValues,
      lastUserEditAt: input.userEditBy ? now : null,
      lastUserEditBy: input.userEditBy ?? null,
      versionCount: 1,
      createdAt: now,
    })
  } else {
    await db
      .update(operatorKbEntries)
      .set({
        ...baseValues,
        ...(input.userEditBy
          ? { lastUserEditAt: now, lastUserEditBy: input.userEditBy }
          : {}),
        versionCount: sql`${operatorKbEntries.versionCount} + 1`,
      })
      .where(
        and(
          eq(operatorKbEntries.workspaceId, workspaceId),
          eq(operatorKbEntries.id, id)
        )
      )
  }

  const fresh = await getEntryById(workspaceId, id)
  if (!fresh) throw new Error("upsertEntry: failed to read back entry")
  return fresh
}

export async function deleteEntry(
  workspaceId: string,
  id: string
): Promise<boolean> {
  const db = getDb()
  const r = await db
    .delete(operatorKbEntries)
    .where(
      and(
        eq(operatorKbEntries.workspaceId, workspaceId),
        eq(operatorKbEntries.id, id)
      )
    )
  return (r.rowCount ?? 0) > 0
}

// ─── Claims ─────────────────────────────────────────────────────────

export async function listClaims(
  workspaceId: string,
  options: { activeOnly?: boolean } = {}
): Promise<KbClaim[]> {
  const db = getDb()
  const rows = options.activeOnly
    ? await db
        .select()
        .from(operatorKbClaims)
        .where(
          and(
            eq(operatorKbClaims.workspaceId, workspaceId),
            sql`${operatorKbClaims.supersededById} IS NULL`
          )
        )
        .orderBy(desc(operatorKbClaims.validAt))
    : await db
        .select()
        .from(operatorKbClaims)
        .where(eq(operatorKbClaims.workspaceId, workspaceId))
        .orderBy(desc(operatorKbClaims.validAt))
  return rows.map(toClaim)
}

export async function getClaimById(
  workspaceId: string,
  id: string
): Promise<KbClaim | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorKbClaims)
    .where(
      and(
        eq(operatorKbClaims.workspaceId, workspaceId),
        eq(operatorKbClaims.id, id)
      )
    )
  return rows[0] ? toClaim(rows[0]) : null
}

export interface UpsertClaimInput {
  id?: string
  statement: string
  subject?: string | null
  confidence?: number
  sourceThreadId?: string | null
  sourceMessageId?: string | null
  sourcePassageId?: string | null
  sourceExcerpt?: string | null
  validAt?: string
  supersededById?: string | null
  modelProvider?: string | null
  modelName?: string | null
  promptVersion?: string | null
  metadata?: Record<string, unknown>
}

export async function upsertClaim(
  workspaceId: string,
  input: UpsertClaimInput
): Promise<KbClaim> {
  const db = getDb()
  const now = new Date()
  const id =
    input.id ??
    `claim-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`

  const validAt = input.validAt ? new Date(input.validAt) : now
  const baseValues = {
    statement: input.statement,
    subject: input.subject ?? null,
    confidence: input.confidence ?? 0.8,
    sourceThreadId: input.sourceThreadId ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
    sourcePassageId: input.sourcePassageId ?? null,
    sourceExcerpt: input.sourceExcerpt ?? null,
    validAt,
    supersededById: input.supersededById ?? null,
    modelProvider: input.modelProvider ?? null,
    modelName: input.modelName ?? null,
    promptVersion: input.promptVersion ?? null,
    metadata: input.metadata ?? {},
    updatedAt: now,
  }

  const existing = await db
    .select()
    .from(operatorKbClaims)
    .where(
      and(
        eq(operatorKbClaims.workspaceId, workspaceId),
        eq(operatorKbClaims.id, id)
      )
    )

  if (existing.length === 0) {
    await db.insert(operatorKbClaims).values({
      id,
      workspaceId,
      ...baseValues,
      createdAt: now,
    })
  } else {
    await db
      .update(operatorKbClaims)
      .set(baseValues)
      .where(
        and(
          eq(operatorKbClaims.workspaceId, workspaceId),
          eq(operatorKbClaims.id, id)
        )
      )
  }

  const fresh = await getClaimById(workspaceId, id)
  if (!fresh) throw new Error("upsertClaim: failed to read back claim")
  return fresh
}

export async function deleteClaim(
  workspaceId: string,
  id: string
): Promise<boolean> {
  const db = getDb()
  const r = await db
    .delete(operatorKbClaims)
    .where(
      and(
        eq(operatorKbClaims.workspaceId, workspaceId),
        eq(operatorKbClaims.id, id)
      )
    )
  return (r.rowCount ?? 0) > 0
}
