import "server-only"

import { randomUUID } from "crypto"
import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { webhookSubscriptions } from "@/lib/server/db/schema"

export interface WebhookSubRow {
  id: string
  workspaceId: string
  label: string
  url: string
  hasSecret: boolean
  events: string | null
  createdBy: string
  createdAt: string
  lastDeliveredAt: string | null
  lastStatus: number | null
  disabledAt: string | null
}

type Row = typeof webhookSubscriptions.$inferSelect

function toRow(row: Row): WebhookSubRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    url: row.url,
    hasSecret: !!row.secret,
    events: row.events,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    disabledAt: row.disabledAt?.toISOString() ?? null,
  }
}

export async function listWebhookSubs(
  workspaceId: string
): Promise<WebhookSubRow[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.workspaceId, workspaceId))
    .orderBy(desc(webhookSubscriptions.createdAt))
  return rows.map(toRow)
}

export async function createWebhookSub(input: {
  workspaceId: string
  label: string
  url: string
  secret?: string | null
  events?: string | null
  createdBy: string
}): Promise<WebhookSubRow> {
  const db = getDb()
  const id = `whk-${randomUUID()}`
  const row = {
    id,
    workspaceId: input.workspaceId,
    label: input.label.trim(),
    url: input.url.trim(),
    secret: input.secret?.trim() || null,
    events: input.events?.trim() || null,
    createdBy: input.createdBy.trim(),
    createdAt: new Date(),
    lastDeliveredAt: null,
    lastStatus: null,
    disabledAt: null,
  }
  await db.insert(webhookSubscriptions).values(row)
  return toRow(row as Row)
}

export async function toggleWebhookSub(
  id: string,
  disabled: boolean
): Promise<boolean> {
  const db = getDb()
  const r = await db
    .update(webhookSubscriptions)
    .set({ disabledAt: disabled ? new Date() : null })
    .where(eq(webhookSubscriptions.id, id))
    .returning({ id: webhookSubscriptions.id })
  return r.length > 0
}

export async function deleteWebhookSub(id: string): Promise<boolean> {
  const db = getDb()
  const r = await db
    .delete(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, id))
    .returning({ id: webhookSubscriptions.id })
  return r.length > 0
}
