import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { ingestInboxEvent } from "@/lib/operator-studio/inbox"

const execFileAsync = promisify(execFile)

const ORGANIZATION = "https://dev.azure.com/ClarifyingMarketingGroup"
const PROJECT = "IT"

/**
 * ADO PAT for comment-body fetch. Optional — when unset, the poller
 * still ingests work-item changes via the `az` CLI but skips
 * comment ingestion. Mickey/Rob's comment text is the richest
 * single signal in the inbox, so set this when you can.
 *
 * Scope: read-only on Work Items. Set in .env.local as ADO_PAT.
 */
function getAdoPat(): string | null {
  const v = process.env.ADO_PAT?.trim()
  return v && v.length > 0 ? v : null
}

function adoAuthHeader(pat: string): string {
  // ADO PATs use basic auth with empty username.
  const token = Buffer.from(`:${pat}`).toString("base64")
  return `Basic ${token}`
}

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
  /** Comments fetched + ingested across all items. Stays at 0 when
   *  ADO_PAT is unset (graceful degrade — work-item changes still
   *  flow). */
  commentsIngested: number
  commentsSkippedDuplicate: number
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
  let commentsIngested = 0
  let commentsSkippedDuplicate = 0
  const pat = getAdoPat()

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
      commentsIngested: 0,
      commentsSkippedDuplicate: 0,
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

    // Comment ingestion — gated on PAT being set. Each comment becomes
    // its own inbox event keyed on `comment:<commentId>` so re-polls
    // dedupe via the partial unique index. Best-effort: a single
    // item's comment fetch failing does not abort the rest of the poll.
    if (pat && Number.isFinite(id) && id > 0) {
      try {
        const r = await fetch(
          `${ORGANIZATION}/${PROJECT}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.3`,
          {
            headers: {
              Authorization: adoAuthHeader(pat),
              Accept: "application/json",
            },
            // Don't auto-follow ADO's auth-redirect to login.live.com —
            // we want a 302 to surface as a 302 so the auth-failure
            // path is distinguishable from a real comment payload.
            redirect: "manual",
          }
        )
        const contentType = r.headers.get("content-type") ?? ""
        if (!r.ok || !contentType.includes("application/json")) {
          errors.push(
            `#${id} comments fetch http=${r.status}${contentType ? ` (${contentType.split(";")[0]})` : ""} — ADO_PAT may be invalid or out of scope`
          )
        } else {
          const data = (await r.json()) as AdoCommentsResponse
          for (const c of data.comments ?? []) {
            const commentId =
              typeof c.id === "number" ? c.id : Number(c.id)
            if (!Number.isFinite(commentId) || commentId <= 0) continue
            // ADO comment ids are scoped PER work item, so comment id 1
            // on item #39 and comment id 1 on item #40 are different
            // events. Including the work-item id in the upstream key
            // prevents the partial unique index from collapsing them.
            const upstreamCommentId = `${id}:comment:${commentId}`
            const before = await getInboxRowExists(
              workspaceId,
              "ado",
              upstreamCommentId
            )
            const bodyHtml = typeof c.text === "string" ? c.text : ""
            const bodyText = stripHtml(bodyHtml)
            const occurredAt = c.createdDate
              ? new Date(c.createdDate)
              : new Date()
            const author =
              (c.createdBy && (c.createdBy.displayName as string)) ||
              "(unknown)"
            await ingestInboxEvent({
              workspaceId,
              factoryId,
              surface: "ado",
              upstreamId: upstreamCommentId,
              upstreamKind: "comment",
              actorName: author,
              occurredAt,
              payload: {
                workItemId: id,
                commentId,
                bodyHtml,
                bodyText,
                createdBy: author,
                createdDate: c.createdDate ?? null,
                modifiedDate: c.modifiedDate ?? null,
              },
              textExcerpt: bodyText.slice(0, 500),
              relatedWorkId: String(id),
              relatedWorkLabel: `ADO #${id}`,
            })
            if (before) commentsSkippedDuplicate += 1
            else commentsIngested += 1
          }
        }
      } catch (err) {
        errors.push(
          `#${id} comments: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  }

  return {
    factoryId,
    pollStartedAt: startedAt.toISOString(),
    pollFinishedAt: new Date().toISOString(),
    itemsSeen,
    rowsIngested,
    rowsSkippedDuplicate,
    commentsIngested,
    commentsSkippedDuplicate,
    errors,
  }
}

interface AdoCommentsResponse {
  comments?: Array<{
    id?: number | string
    text?: string
    createdDate?: string
    modifiedDate?: string
    createdBy?: { displayName?: string; uniqueName?: string }
  }>
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
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
