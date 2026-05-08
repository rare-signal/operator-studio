import "server-only"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { softwareFactories } from "@/lib/server/db/schema"

export interface CommsSubstrate {
  kind: "ado" | "teams" | "slack" | "linear" | "atlassian" | string
  /** Free-form. Examples: org URL, project slug, channel id. */
  details: Record<string, unknown>
}

export interface AudienceMember {
  /** Display name. */
  name: string
  /** Email or stable identity if known. */
  identity?: string
  role: "operator" | "engineering_manager" | "stakeholder" | "audience"
  notes?: string
}

export interface SoftwareFactory {
  id: string
  workspaceId: string
  label: string
  orgName: string
  productName: string
  productRepoPath: string | null
  productProdUrl: string | null
  commsSubstrates: CommsSubstrate[]
  systemMap: Record<string, unknown>
  escalationTargets: Record<string, unknown>
  audience: AudienceMember[]
  operatorNotes: string | null
  createdAt: string
  updatedAt: string
}

function toFactory(
  row: typeof softwareFactories.$inferSelect
): SoftwareFactory {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    orgName: row.orgName,
    productName: row.productName,
    productRepoPath: row.productRepoPath ?? null,
    productProdUrl: row.productProdUrl ?? null,
    commsSubstrates: (row.commsSubstrates ?? []) as unknown as CommsSubstrate[],
    systemMap: row.systemMap ?? {},
    escalationTargets: row.escalationTargets ?? {},
    audience: (row.audience ?? []) as unknown as AudienceMember[],
    operatorNotes: row.operatorNotes ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listFactories(
  workspaceId: string
): Promise<SoftwareFactory[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(softwareFactories)
    .where(eq(softwareFactories.workspaceId, workspaceId))
  return rows.map(toFactory)
}

export async function getFactory(
  workspaceId: string,
  id: string
): Promise<SoftwareFactory | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(softwareFactories)
    .where(
      and(
        eq(softwareFactories.workspaceId, workspaceId),
        eq(softwareFactories.id, id)
      )
    )
    .limit(1)
  return rows[0] ? toFactory(rows[0]) : null
}

export interface UpsertFactoryInput {
  id: string
  workspaceId: string
  label: string
  orgName: string
  productName: string
  productRepoPath?: string
  productProdUrl?: string
  commsSubstrates?: CommsSubstrate[]
  systemMap?: Record<string, unknown>
  escalationTargets?: Record<string, unknown>
  audience?: AudienceMember[]
  operatorNotes?: string
}

export async function upsertFactory(
  input: UpsertFactoryInput
): Promise<SoftwareFactory> {
  const db = getDb()
  const now = new Date()
  const existing = await getFactory(input.workspaceId, input.id)
  if (existing) {
    await db
      .update(softwareFactories)
      .set({
        label: input.label,
        orgName: input.orgName,
        productName: input.productName,
        productRepoPath: input.productRepoPath ?? null,
        productProdUrl: input.productProdUrl ?? null,
        commsSubstrates: (input.commsSubstrates ?? []) as unknown as Array<
          Record<string, unknown>
        >,
        systemMap: input.systemMap ?? {},
        escalationTargets: input.escalationTargets ?? {},
        audience: (input.audience ?? []) as unknown as Array<
          Record<string, unknown>
        >,
        operatorNotes: input.operatorNotes ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(softwareFactories.workspaceId, input.workspaceId),
          eq(softwareFactories.id, input.id)
        )
      )
  } else {
    await db.insert(softwareFactories).values({
      id: input.id,
      workspaceId: input.workspaceId,
      label: input.label,
      orgName: input.orgName,
      productName: input.productName,
      productRepoPath: input.productRepoPath ?? null,
      productProdUrl: input.productProdUrl ?? null,
      commsSubstrates: (input.commsSubstrates ?? []) as unknown as Array<
        Record<string, unknown>
      >,
      systemMap: input.systemMap ?? {},
      escalationTargets: input.escalationTargets ?? {},
      audience: (input.audience ?? []) as unknown as Array<
        Record<string, unknown>
      >,
      operatorNotes: input.operatorNotes ?? null,
      createdAt: now,
      updatedAt: now,
    })
  }
  const fresh = await getFactory(input.workspaceId, input.id)
  if (!fresh) throw new Error(`upsertFactory: ${input.id} did not read back`)
  return fresh
}

/**
 * Build the launch-prompt header text for an agent dispatched to do
 * work inside this factory. Future agents should call this at launch
 * to get an unambiguous context bundle (per
 * `pattern-software-factory-context-air-gap`).
 */
export function renderFactoryContextHeader(f: SoftwareFactory): string {
  const lines: string[] = []
  lines.push(`[FACTORY CONTEXT]`)
  lines.push(`Org: ${f.orgName}`)
  lines.push(`Product: ${f.productName}`)
  if (f.productRepoPath) lines.push(`Repo: ${f.productRepoPath}`)
  if (f.productProdUrl) lines.push(`Prod URL: ${f.productProdUrl}`)
  if (f.commsSubstrates.length > 0) {
    const labels = f.commsSubstrates
      .map((s) => `${s.kind}(${Object.keys(s.details).join(",")})`)
      .join(", ")
    lines.push(`Comms: ${labels}`)
  }
  if (f.audience.length > 0) {
    const aud = f.audience
      .map((a) => `${a.name}${a.role ? ` (${a.role})` : ""}`)
      .join(", ")
    lines.push(`Audience: ${aud}`)
  }
  lines.push(``)
  lines.push(
    `You are working on this factory. Do not edit other factories' code. Do not post to comms substrates directly — stage via outbox per pattern-outbox-staging.`
  )
  if (f.operatorNotes) {
    lines.push(``)
    lines.push(f.operatorNotes)
  }
  lines.push(`[/FACTORY CONTEXT]`)
  return lines.join("\n")
}
