import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { ingestInboxEvent } from "@/lib/operator-studio/inbox"
import {
  persistAdoTick,
  type AdoCommentSnapshot,
  type AdoItemSnapshot,
} from "@/lib/operator-studio/ingest/ado-read-model"

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
  /** L1 read-model: id of the ingest_snapshots row written this tick.
   *  Null when L1 persist itself failed (errors[] will explain). */
  snapshotId: string | null
  /** L1 read-model: ado_items rows inserted or rev-bumped. */
  itemsUpserted: number
  /** L1 read-model: ado_revisions rows appended. */
  revisionsAppended: number
  /** L1 read-model: ado_comments rows appended. */
  l1CommentsAppended: number
  /** Whether this tick was driven by a JSON fixture rather than az. */
  fixtureMode: boolean
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

  // L1 ingest: full project query, NOT @Me-scoped. The L1 read-model
  // mirrors every IT-project work item so downstream lenses (David's
  // queue, Micky's stakeholder thread, the triage report) can derive
  // their own filters from a single source of truth.
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
    "ORDER BY [System.ChangedDate] DESC",
  ].join(" ")

  // Fixture mode: when ADO_INGEST_FIXTURE points at a JSON file, the
  // poller reads it instead of shelling out to `az`. Keeps the
  // schema/poller path deterministic for tests and for environments
  // without live credentials.
  const fixturePath = process.env.ADO_INGEST_FIXTURE?.trim()
  const fixtureMode = !!fixturePath
  let workItems: AdoWorkItem[] = []

  if (fixtureMode) {
    try {
      const { readFile } = await import("node:fs/promises")
      const raw = await readFile(fixturePath as string, "utf8")
      const parsed = JSON.parse(raw) as AdoQueryResponse | AdoWorkItem[]
      workItems = Array.isArray(parsed) ? parsed : (parsed.workItems ?? [])
    } catch (err) {
      errors.push(
        `fixture read failed (${fixturePath}): ${err instanceof Error ? err.message : String(err)}`
      )
    }
  } else {
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
      // Don't early-return — we still want to write an
      // ingest_snapshots row recording the failed tick.
      errors.push(
        `az boards query failed: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  itemsSeen = workItems.length

  // Build L1 read-model batches alongside the inbox writes. The inbox
  // path remains unchanged so existing UI / SignalCandidate callers
  // see no change in behavior.
  const l1Items: AdoItemSnapshot[] = []
  const l1Comments: AdoCommentSnapshot[] = []

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

    l1Items.push({
      workItemId: id,
      rev,
      type: type || null,
      title,
      state: state || null,
      priority: priority ? Number(priority) : null,
      assignedTo: assignedTo || null,
      assignedToUniqueName: identityUniqueName(f, "System.AssignedTo"),
      createdBy: createdBy || null,
      changedBy: changedBy || null,
      changedAt,
      fields: f,
    })

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
            l1Comments.push({
              workItemId: id,
              commentId,
              createdBy: author,
              createdAt: c.createdDate ? new Date(c.createdDate) : null,
              modifiedAt: c.modifiedDate ? new Date(c.modifiedDate) : null,
              bodyHtml,
              bodyText,
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

  const finishedAt = new Date()

  // L1 read-model write — current state, append-only history, and
  // an ingest_snapshots row for this tick. Best-effort: a DB
  // failure here surfaces as an error string but does not crash
  // the inbox-side success accounting.
  let l1SnapshotId: string | null = null
  let l1ItemsUpserted = 0
  let l1RevisionsAppended = 0
  let l1CommentsAppended = 0
  try {
    const r = await persistAdoTick({
      workspaceId,
      factoryId,
      pollStartedAt: startedAt,
      pollFinishedAt: finishedAt,
      items: l1Items,
      comments: l1Comments,
      errors,
      fixtureMode,
    })
    l1SnapshotId = r.snapshotId
    l1ItemsUpserted = r.itemsUpserted
    l1RevisionsAppended = r.revisionsAppended
    l1CommentsAppended = r.commentsAppended
  } catch (err) {
    errors.push(
      `L1 persist failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  return {
    factoryId,
    pollStartedAt: startedAt.toISOString(),
    pollFinishedAt: finishedAt.toISOString(),
    itemsSeen,
    rowsIngested,
    rowsSkippedDuplicate,
    commentsIngested,
    commentsSkippedDuplicate,
    snapshotId: l1SnapshotId,
    itemsUpserted: l1ItemsUpserted,
    revisionsAppended: l1RevisionsAppended,
    l1CommentsAppended,
    fixtureMode,
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

function identityUniqueName(
  fields: Record<string, unknown>,
  key: string
): string | null {
  const v = fields[key]
  if (!v || typeof v !== "object") return null
  const ident = v as { uniqueName?: unknown }
  return typeof ident.uniqueName === "string" ? ident.uniqueName : null
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
