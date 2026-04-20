import "server-only"

import { randomUUID, randomBytes } from "crypto"
import { and, desc, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { apiTokens } from "@/lib/server/db/schema"
import { sha256 } from "./auth"

/**
 * Per-user API tokens.
 *
 * Token plaintext is shown ONCE at creation time. The DB stores only the
 * SHA-256 hash, plus a short prefix (for display/auditing) and the token's
 * `display_name` (which becomes the `importedBy` attribution when the
 * token is used).
 *
 * Tokens can be workspace-scoped (`workspaceId` set) or global (`null`).
 * A global token is allowed to act in any workspace the caller selects
 * via query param or cookie.
 */

export interface ApiTokenRow {
  id: string
  workspaceId: string | null
  label: string
  displayName: string
  tokenPrefix: string
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

type Row = typeof apiTokens.$inferSelect

function toApiTokenRow(row: Row): ApiTokenRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    displayName: row.displayName,
    tokenPrefix: row.tokenPrefix,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  }
}

export interface CreatedToken extends ApiTokenRow {
  // Plaintext. Shown once.
  token: string
}

const TOKEN_PREFIX = "ops_"

function generateTokenPlaintext(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("hex")}`
}

export async function createApiToken(input: {
  label: string
  displayName: string
  createdBy: string
  workspaceId?: string | null
}): Promise<CreatedToken> {
  const db = getDb()
  const id = `tok-${randomUUID()}`
  const plaintext = generateTokenPlaintext()
  const tokenHash = sha256(plaintext)
  const tokenPrefix = plaintext.slice(0, 12) // "ops_" + 8 hex chars
  const now = new Date()

  const row = {
    id,
    workspaceId: input.workspaceId ?? null,
    label: input.label.trim(),
    displayName: input.displayName.trim(),
    tokenHash,
    tokenPrefix,
    createdBy: input.createdBy.trim(),
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null,
  }
  await db.insert(apiTokens).values(row)

  return {
    ...toApiTokenRow(row as Row),
    token: plaintext,
  }
}

export async function listApiTokens(
  workspaceId?: string | null
): Promise<ApiTokenRow[]> {
  const db = getDb()
  const base = db.select().from(apiTokens)
  const rows = await (workspaceId === undefined
    ? base.orderBy(desc(apiTokens.createdAt))
    : base
        .where(
          workspaceId === null
            ? isNull(apiTokens.workspaceId)
            : eq(apiTokens.workspaceId, workspaceId)
        )
        .orderBy(desc(apiTokens.createdAt)))
  return rows.map(toApiTokenRow)
}

export async function revokeApiToken(id: string): Promise<boolean> {
  const db = getDb()
  const r = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id })
  return r.length > 0
}
