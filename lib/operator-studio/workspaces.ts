import "server-only"

import { cookies } from "next/headers"
import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorChatMessages,
  operatorChatSessions,
  operatorThreadMessages,
  operatorThreadSummaries,
  operatorThreads,
  workspaces,
} from "@/lib/server/db/schema"

export const GLOBAL_WORKSPACE_ID = "global"
export const ACTIVE_WORKSPACE_COOKIE = "operator_studio_workspace"

export interface Workspace {
  id: string
  label: string
  isGlobal: boolean
  createdAt: string
  updatedAt: string
}

type WorkspaceRow = typeof workspaces.$inferSelect

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    label: row.label,
    isGlobal: row.isGlobal === 1,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Read the active workspace id from the request cookie. Falls back to the
 * global workspace. Validates against the DB so a deleted workspace doesn't
 * leak through.
 */
export async function getActiveWorkspaceId(): Promise<string> {
  const jar = await cookies()
  const raw = jar.get(ACTIVE_WORKSPACE_COOKIE)?.value?.trim()
  if (!raw) return GLOBAL_WORKSPACE_ID

  const db = getDb()
  const found = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, raw))
    .limit(1)

  return found.length > 0 ? found[0].id : GLOBAL_WORKSPACE_ID
}

export async function getActiveWorkspace(): Promise<Workspace> {
  const id = await getActiveWorkspaceId()
  const db = getDb()
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1)
  if (rows.length > 0) return rowToWorkspace(rows[0])
  return {
    id: GLOBAL_WORKSPACE_ID,
    label: "Global library",
    isGlobal: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(workspaces)
    .orderBy(desc(workspaces.isGlobal), workspaces.label)
  return rows.map(rowToWorkspace)
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1)
  return rows.length > 0 ? rowToWorkspace(rows[0]) : null
}

export async function createWorkspace(input: {
  id: string
  label: string
}): Promise<Workspace> {
  const db = getDb()
  const now = new Date()
  const slug = input.id
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) throw new Error("Workspace id cannot be empty")
  if (slug === GLOBAL_WORKSPACE_ID) throw new Error("Reserved workspace id")

  await db.insert(workspaces).values({
    id: slug,
    label: input.label.trim() || slug,
    isGlobal: 0,
    createdAt: now,
    updatedAt: now,
  })

  const fresh = await getWorkspaceById(slug)
  if (!fresh) throw new Error("Workspace creation failed")
  return fresh
}

export async function renameWorkspace(
  id: string,
  label: string
): Promise<Workspace | null> {
  const db = getDb()
  await db
    .update(workspaces)
    .set({ label: label.trim(), updatedAt: new Date() })
    .where(eq(workspaces.id, id))
  return getWorkspaceById(id)
}

export async function deleteWorkspace(id: string): Promise<void> {
  if (id === GLOBAL_WORKSPACE_ID) {
    throw new Error("Cannot delete the global workspace")
  }
  const db = getDb()
  // ON DELETE CASCADE handles threads/messages/summaries/chat/import runs.
  await db.delete(workspaces).where(eq(workspaces.id, id))
}

/**
 * Promote a thread: copy it from its source workspace into global.
 * The original stays. Messages and summaries are copied too so the promoted
 * thread is self-contained. Continuation chat sessions are NOT copied —
 * they're operator-scoped and promotion shouldn't drag chat history across
 * workspace boundaries.
 */
export async function promoteThread(params: {
  sourceThreadId: string
  sourceWorkspaceId: string
  actorName: string
}): Promise<string> {
  const db = getDb()
  const now = new Date()

  const src = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.id, params.sourceThreadId),
        eq(operatorThreads.workspaceId, params.sourceWorkspaceId)
      )
    )
    .limit(1)

  if (src.length === 0) throw new Error("Source thread not found")
  const source = src[0]

  const newId = `${params.sourceThreadId}--${params.sourceWorkspaceId}`
  const existing = await db
    .select({ id: operatorThreads.id })
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.id, newId),
        eq(operatorThreads.workspaceId, GLOBAL_WORKSPACE_ID)
      )
    )
    .limit(1)
  if (existing.length > 0) return newId

  await db.insert(operatorThreads).values({
    ...source,
    id: newId,
    workspaceId: GLOBAL_WORKSPACE_ID,
    importedBy: params.actorName,
    promotedFromId: source.id,
    pulledFromId: null,
    parentThreadId: null,
    createdAt: now,
    updatedAt: now,
  })

  // Copy messages.
  const srcMessages = await db
    .select()
    .from(operatorThreadMessages)
    .where(eq(operatorThreadMessages.threadId, params.sourceThreadId))
  for (const m of srcMessages) {
    await db
      .insert(operatorThreadMessages)
      .values({
        ...m,
        id: `${newId}::msg::${m.turnIndex}`,
        workspaceId: GLOBAL_WORKSPACE_ID,
        threadId: newId,
      })
      .onConflictDoNothing()
  }

  // Copy summaries.
  const srcSummaries = await db
    .select()
    .from(operatorThreadSummaries)
    .where(eq(operatorThreadSummaries.threadId, params.sourceThreadId))
  for (const s of srcSummaries) {
    await db
      .insert(operatorThreadSummaries)
      .values({
        ...s,
        id: `${newId}::sum::${s.id}`,
        workspaceId: GLOBAL_WORKSPACE_ID,
        threadId: newId,
      })
      .onConflictDoNothing()
  }

  return newId
}

/**
 * Pull a thread from global into a sub-workspace. Creates a local copy with
 * its messages and summaries. Chat sessions are not copied.
 */
export async function pullThread(params: {
  globalThreadId: string
  targetWorkspaceId: string
  actorName: string
}): Promise<string> {
  if (params.targetWorkspaceId === GLOBAL_WORKSPACE_ID) {
    throw new Error("Pull target cannot be the global workspace")
  }

  const db = getDb()
  const now = new Date()

  const src = await db
    .select()
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.id, params.globalThreadId),
        eq(operatorThreads.workspaceId, GLOBAL_WORKSPACE_ID)
      )
    )
    .limit(1)

  if (src.length === 0) throw new Error("Global thread not found")
  const source = src[0]

  const newId = `${params.globalThreadId}@${params.targetWorkspaceId}`
  const existing = await db
    .select({ id: operatorThreads.id })
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.id, newId),
        eq(operatorThreads.workspaceId, params.targetWorkspaceId)
      )
    )
    .limit(1)
  if (existing.length > 0) return newId

  await db.insert(operatorThreads).values({
    ...source,
    id: newId,
    workspaceId: params.targetWorkspaceId,
    importedBy: params.actorName,
    promotedFromId: null,
    pulledFromId: source.id,
    parentThreadId: null,
    createdAt: now,
    updatedAt: now,
  })

  const srcMessages = await db
    .select()
    .from(operatorThreadMessages)
    .where(eq(operatorThreadMessages.threadId, params.globalThreadId))
  for (const m of srcMessages) {
    await db
      .insert(operatorThreadMessages)
      .values({
        ...m,
        id: `${newId}::msg::${m.turnIndex}`,
        workspaceId: params.targetWorkspaceId,
        threadId: newId,
      })
      .onConflictDoNothing()
  }

  const srcSummaries = await db
    .select()
    .from(operatorThreadSummaries)
    .where(eq(operatorThreadSummaries.threadId, params.globalThreadId))
  for (const s of srcSummaries) {
    await db
      .insert(operatorThreadSummaries)
      .values({
        ...s,
        id: `${newId}::sum::${s.id}`,
        workspaceId: params.targetWorkspaceId,
        threadId: newId,
      })
      .onConflictDoNothing()
  }

  return newId
}

// Re-export for API routes.
export { operatorChatMessages, operatorChatSessions }
