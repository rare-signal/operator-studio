import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { ingestInboxEvent } from "@/lib/operator-studio/inbox"

const execFileAsync = promisify(execFile)

const ORGANIZATION = "https://dev.azure.com/ClarifyingMarketingGroup"
const PROJECT = "IT"

/**
 * One-tick ADO poll for a factory.
 *
 * v1 scope:
 * - Only the items currently assigned to the operator (`@Me` per the
 *   `az` CLI's logged-in identity). Future: also items where Micky
 *   is the creator / last commenter, per pattern-ado-stakeholder-lens-david-micky.
 * - Treats each (work-item-id, rev) as a unique upstream event. The
 *   inbox table's partial unique index on (workspace_id, surface,
 *   upstream_id) makes re-polls idempotent — only new revs land as
 *   new rows.
 * - No comment-body fetch (would require a PAT). Title / state /
 *   priority / assignee / changedBy / changedDate are enough for the
 *   factory inbox panel and for downstream lens scoring.
 *
 * Returns counts so the caller (CLI / HTTP / UI button) can report
 * what happened.
 */
export interface PollAdoResult {
  factoryId: string
  pollStartedAt: string
  pollFinishedAt: string
  itemsSeen: number
  rowsIngested: number
  rowsSkippedDuplicate: number
  errors: string[]
}

export async function pollAdoForFactory(
  workspaceId: string,
  factoryId: string
): Promise<PollAdoResult> {
  const startedAt = new Date()
  const errors: string[] = []
  let itemsSeen = 0
  let rowsIngested = 0
  let rowsSkippedDuplicate = 0

  const wiql = [
    "SELECT",
    "  [System.Id],",
    "  [System.Title],",
    "  [System.State],",
    "  [System.WorkItemType],",
    "  [System.AssignedTo],",
    "  [System.CreatedBy],",
    "  [System.ChangedBy],",
    "  [System.ChangedDate],",
    "  [System.Rev],",
    "  [Microsoft.VSTS.Common.Priority]",
    "FROM WorkItems",
    "WHERE",
    `  [System.TeamProject] = '${PROJECT}'`,
    "  AND [System.AssignedTo] = @Me",
    "ORDER BY [System.ChangedDate] DESC",
  ].join(" ")

  let workItems: AdoWorkItem[] = []
  try {
    const { stdout } = await execFileAsync(
      "az",
      [
        "boards",
        "query",
        "--organization",
        ORGANIZATION,
        "--project",
        PROJECT,
        "--wiql",
        wiql,
        "--output",
        "json",
      ],
      { timeout: 30_000 }
    )
    const data = JSON.parse(stdout) as AdoQueryResponse | AdoWorkItem[]
    workItems = Array.isArray(data) ? data : (data.workItems ?? [])
  } catch (err) {
    errors.push(
      `az boards query failed: ${err instanceof Error ? err.message : String(err)}`
    )
    return {
      factoryId,
      pollStartedAt: startedAt.toISOString(),
      pollFinishedAt: new Date().toISOString(),
      itemsSeen: 0,
      rowsIngested: 0,
      rowsSkippedDuplicate: 0,
      errors,
    }
  }

  itemsSeen = workItems.length

  for (const item of workItems) {
    const f = item.fields
    if (!f) continue
    const id = item.id ?? Number(field(f, "System.Id"))
    if (!Number.isFinite(id) || id <= 0) continue

    const rev = Number(field(f, "System.Rev"))
    if (!Number.isFinite(rev) || rev <= 0) continue

    const upstreamId = `${id}:${rev}`

    const title = field(f, "System.Title") || `Work item ${id}`
    const state = field(f, "System.State")
    const priority = field(f, "Microsoft.VSTS.Common.Priority")
    const type = field(f, "System.WorkItemType")
    const assignedTo = identityName(f, "System.AssignedTo")
    const changedBy = identityName(f, "System.ChangedBy")
    const createdBy = identityName(f, "System.CreatedBy")
    const changedDateStr = field(f, "System.ChangedDate")
    const changedAt = changedDateStr ? new Date(changedDateStr) : new Date()

    const textExcerpt = [
      title,
      state ? `state=${state}` : null,
      priority ? `P${priority}` : null,
      assignedTo ? `assigned=${assignedTo}` : null,
    ]
      .filter(Boolean)
      .join(" · ")

    try {
      const before = await getInboxRowExists(
        workspaceId,
        "ado",
        upstreamId
      )
      await ingestInboxEvent({
        workspaceId,
        factoryId,
        surface: "ado",
        upstreamId,
        upstreamKind: "change",
        actorName: changedBy || createdBy,
        occurredAt: changedAt,
        payload: {
          workItemId: id,
          rev,
          type,
          title,
          state,
          priority: priority ? Number(priority) : null,
          assignedTo,
          createdBy,
          changedBy,
        },
        textExcerpt,
        relatedWorkId: String(id),
        relatedWorkLabel: `ADO #${id}`,
      })
      const after = await getInboxRowExists(
        workspaceId,
        "ado",
        upstreamId
      )
      if (before && after) {
        rowsSkippedDuplicate += 1
      } else {
        rowsIngested += 1
      }
    } catch (err) {
      errors.push(
        `#${id} rev=${rev}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    factoryId,
    pollStartedAt: startedAt.toISOString(),
    pollFinishedAt: new Date().toISOString(),
    itemsSeen,
    rowsIngested,
    rowsSkippedDuplicate,
    errors,
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

interface AdoWorkItem {
  fields?: Record<string, unknown>
  id?: number
  url?: string
}

interface AdoQueryResponse {
  workItems?: AdoWorkItem[]
}

function field(fields: Record<string, unknown>, key: string): string {
  const v = fields[key]
  return typeof v === "string" || typeof v === "number" ? String(v) : ""
}

function identityName(
  fields: Record<string, unknown>,
  key: string
): string {
  const v = fields[key]
  if (!v || typeof v !== "object") return field(fields, key)
  const ident = v as { displayName?: unknown; uniqueName?: unknown }
  if (typeof ident.displayName === "string") return ident.displayName
  if (typeof ident.uniqueName === "string") return ident.uniqueName
  return ""
}

// Lightweight existence check for ingest dedupe accounting. Cheaper
// than a full read since we only need a yes/no.
async function getInboxRowExists(
  workspaceId: string,
  surface: string,
  upstreamId: string
): Promise<boolean> {
  const { getDb } = await import("@/lib/server/db/client")
  const { operatorInboxEvents } = await import("@/lib/server/db/schema")
  const { and, eq } = await import("drizzle-orm")
  const db = getDb()
  const rows = await db
    .select({ id: operatorInboxEvents.id })
    .from(operatorInboxEvents)
    .where(
      and(
        eq(operatorInboxEvents.workspaceId, workspaceId),
        eq(operatorInboxEvents.surface, surface),
        eq(operatorInboxEvents.upstreamId, upstreamId)
      )
    )
    .limit(1)
  return rows.length > 0
}
