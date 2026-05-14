/**
 * ADO → Telegento sync-back bridge.
 *
 * Closes the second half of the feedback loop:
 *   1. fetchLinkedTickets() — ask Telegento for every advisory that has
 *      a `requested_by_ado_id` link, with its current sync cursor.
 *   2. For each linked ticket: list its ADO comments via the existing
 *      ADO PAT, filter out the bridge's own outbox-posted comments and
 *      anything too short to be a real reply, and relay the survivors
 *      as Telegento stakeholder_posts.
 *   3. Advance `known_issues.last_synced_ado_comment_id` so the next
 *      sweep skips comments we've already processed.
 *
 * Auth surface used here:
 *   - Telegento internal endpoints: Bearer INTERNAL_API_TOKEN (resolved
 *     via `getTelegentoInternalApiToken`).
 *   - ADO REST: PAT in `ADO_PAT` env (same as the existing poller).
 */

import { getTelegentoInternalApiToken } from "./secrets"

const ADO_ORGANIZATION = "https://dev.azure.com/ClarifyingMarketingGroup"
const ADO_PROJECT = "IT"
const DEFAULT_TELEGENTO_BASE_URL = "https://app.telegento.com"

// Comments authored by these display-name fragments are the bridge's
// own posts coming back at us — skip to avoid loops.
const SELF_AUTHOR_FRAGMENTS = [
  "telegento ai eng",
  "operator-studio",
]
// Bodies starting with this prefix are unmistakably from the bridge's
// own outbox writer (matches the existing `**From:** Telegento AI Eng`
// convention used by Worker F round 1).
const SELF_BODY_PREFIXES = ["**From:** Telegento AI Eng"]
const MIN_RELAY_BODY_LENGTH = 10

export interface LinkedTicket {
  knownIssueId: string
  title: string
  adoWorkItemId: number
  lastSyncedAdoCommentId: number | null
}

export interface AdoCommentToRelay {
  adoWorkItemId: number
  adoCommentId: number
  authorName: string
  authorEmail: string | null
  bodyMarkdown: string
  createdDate: string
}

export interface SweepOptions {
  dryRun?: boolean
  baseUrl?: string
  token?: string
  /** Caps total comments processed per sweep across all tickets. */
  maxComments?: number
  /** Caps tickets touched per sweep. */
  maxTickets?: number
}

export interface SweepReport {
  ticketsConsidered: number
  ticketsExamined: number
  commentsFetched: number
  commentsRelayed: number
  commentsSkippedSelf: number
  commentsSkippedShort: number
  commentsSkippedAlreadySynced: number
  errors: { knownIssueId: string; message: string }[]
  relays: {
    knownIssueId: string
    adoWorkItemId: number
    adoCommentId: number
    stakeholderPostId: string
    authorName: string
  }[]
}

function resolveBaseUrl(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.replace(/\/+$/, "")
  const envBase = process.env.TELEGENTO_BASE_URL?.trim()
  if (envBase) return envBase.replace(/\/+$/, "")
  return DEFAULT_TELEGENTO_BASE_URL
}

function getAdoPat(): string {
  const v = process.env.ADO_PAT?.trim()
  if (!v) {
    throw new Error(
      "ADO_PAT is not set — the sync-back bridge needs a read-only ADO PAT to list comments."
    )
  }
  return v
}

function adoAuthHeader(pat: string): string {
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`
}

export async function fetchLinkedTickets(opts?: {
  baseUrl?: string
  token?: string
}): Promise<LinkedTicket[]> {
  const baseUrl = resolveBaseUrl(opts?.baseUrl)
  const token = opts?.token ?? (await getTelegentoInternalApiToken())
  const url = `${baseUrl}/api/telegento/known-issues/internal/linked-tickets`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `fetchLinkedTickets: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    )
  }
  const json = (await res.json()) as { tickets?: unknown }
  if (!Array.isArray(json.tickets)) {
    throw new Error("fetchLinkedTickets: response missing `tickets` array")
  }
  return json.tickets.map((raw) => {
    const r = raw as Record<string, unknown>
    const adoId =
      typeof r.adoWorkItemId === "number" && Number.isFinite(r.adoWorkItemId)
        ? Math.trunc(r.adoWorkItemId)
        : null
    if (typeof r.knownIssueId !== "string" || adoId == null) {
      throw new Error(
        `fetchLinkedTickets: invalid row — ${JSON.stringify(raw).slice(0, 200)}`
      )
    }
    return {
      knownIssueId: r.knownIssueId,
      title: typeof r.title === "string" ? r.title : "",
      adoWorkItemId: adoId,
      lastSyncedAdoCommentId:
        typeof r.lastSyncedAdoCommentId === "number" &&
        Number.isFinite(r.lastSyncedAdoCommentId)
          ? Math.trunc(r.lastSyncedAdoCommentId)
          : null,
    }
  })
}

interface AdoCommentRaw {
  id?: number | string
  text?: string
  createdDate?: string
  createdBy?: { displayName?: string; uniqueName?: string }
}

interface AdoCommentsResponse {
  comments?: AdoCommentRaw[]
}

export async function listAdoComments(
  workItemId: number
): Promise<AdoCommentRaw[]> {
  const pat = getAdoPat()
  const url = `${ADO_ORGANIZATION}/${ADO_PROJECT}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.3`
  const res = await fetch(url, {
    headers: {
      Authorization: adoAuthHeader(pat),
      Accept: "application/json",
    },
    redirect: "manual",
  })
  const ct = res.headers.get("content-type") ?? ""
  if (!res.ok || !ct.includes("application/json")) {
    throw new Error(
      `listAdoComments(#${workItemId}): http=${res.status} content-type=${ct.split(";")[0]}`
    )
  }
  const data = (await res.json()) as AdoCommentsResponse
  return data.comments ?? []
}

export function htmlToMarkdown(html: string): string {
  // Lightweight conversion — we're not trying to be pandoc. ADO comment
  // HTML uses a small vocabulary (<div>, <br>, <p>, <a>, <strong>, <em>,
  // <ul>/<li>) and the receiver renders markdown anyway, so a coarse
  // pass is good enough.
  let s = html
  s = s.replace(/<br\s*\/?>/gi, "\n")
  s = s.replace(/<\/(div|p|li|h[1-6])>/gi, "\n")
  s = s.replace(/<li[^>]*>/gi, "- ")
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
  s = s.replace(/<\/?(strong|b)>/gi, "**")
  s = s.replace(/<\/?(em|i)>/gi, "_")
  s = s.replace(/<[^>]+>/g, "")
  s = s.replace(/&nbsp;/g, " ")
  s = s.replace(/&amp;/g, "&")
  s = s.replace(/&lt;/g, "<")
  s = s.replace(/&gt;/g, ">")
  s = s.replace(/&quot;/g, '"')
  s = s.replace(/&#39;/g, "'")
  s = s.replace(/\n{3,}/g, "\n\n")
  return s.trim()
}

export type CommentFilterReason =
  | "self-author"
  | "self-body-prefix"
  | "too-short"
  | "already-synced"

export function classifyComment(
  raw: AdoCommentRaw,
  lastSyncedAdoCommentId: number | null
): { decision: "relay" } | { decision: "skip"; reason: CommentFilterReason } {
  const commentId =
    typeof raw.id === "number" ? raw.id : Number(raw.id)
  if (
    lastSyncedAdoCommentId != null &&
    Number.isFinite(commentId) &&
    commentId <= lastSyncedAdoCommentId
  ) {
    return { decision: "skip", reason: "already-synced" }
  }
  const authorName = (raw.createdBy?.displayName ?? "").toLowerCase()
  if (
    SELF_AUTHOR_FRAGMENTS.some((frag) => authorName.includes(frag))
  ) {
    return { decision: "skip", reason: "self-author" }
  }
  const bodyMarkdown = htmlToMarkdown(raw.text ?? "")
  if (
    SELF_BODY_PREFIXES.some((prefix) =>
      bodyMarkdown.toLowerCase().startsWith(prefix.toLowerCase())
    )
  ) {
    return { decision: "skip", reason: "self-body-prefix" }
  }
  if (bodyMarkdown.replace(/\s+/g, "").length < MIN_RELAY_BODY_LENGTH) {
    return { decision: "skip", reason: "too-short" }
  }
  return { decision: "relay" }
}

export async function postStakeholderPost(input: {
  knownIssueId: string
  postedBySub: string
  postedByName: string
  body: string
  kind?: "note" | "status" | "test-result" | "decision"
  advanceCursorTo?: number
  baseUrl?: string
  token?: string
}): Promise<{ stakeholderPostId: string; lastSyncedAdoCommentId: number | null }> {
  const baseUrl = resolveBaseUrl(input.baseUrl)
  const token = input.token ?? (await getTelegentoInternalApiToken())
  const url = `${baseUrl}/api/telegento/known-issues/${encodeURIComponent(input.knownIssueId)}/internal/stakeholder-posts`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      postedBySub: input.postedBySub,
      postedByName: input.postedByName,
      body: input.body,
      kind: input.kind ?? "note",
      advanceCursorTo: input.advanceCursorTo,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `postStakeholderPost(${input.knownIssueId}): ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    )
  }
  const data = (await res.json()) as {
    post?: { id?: string }
    lastSyncedAdoCommentId?: number | null
  }
  if (!data.post?.id) {
    throw new Error("postStakeholderPost: response missing post.id")
  }
  return {
    stakeholderPostId: data.post.id,
    lastSyncedAdoCommentId: data.lastSyncedAdoCommentId ?? null,
  }
}

export async function advanceSyncCursor(input: {
  knownIssueId: string
  advanceTo: number
  baseUrl?: string
  token?: string
}): Promise<void> {
  const baseUrl = resolveBaseUrl(input.baseUrl)
  const token = input.token ?? (await getTelegentoInternalApiToken())
  const url = `${baseUrl}/api/telegento/known-issues/${encodeURIComponent(input.knownIssueId)}/internal/sync-cursor`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ advanceTo: input.advanceTo }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `advanceSyncCursor(${input.knownIssueId}): ${res.status} ${res.statusText} — ${body.slice(0, 300)}`
    )
  }
}

function syntheticSub(raw: AdoCommentRaw): string {
  const unique = raw.createdBy?.uniqueName?.trim()
  if (unique) return unique
  return `ado:${raw.createdBy?.displayName ?? "unknown"}`
}

function authorEmail(raw: AdoCommentRaw): string | null {
  const u = raw.createdBy?.uniqueName?.trim() ?? ""
  return u.includes("@") ? u : null
}

export function toRelayCandidate(
  adoWorkItemId: number,
  raw: AdoCommentRaw
): AdoCommentToRelay | null {
  const commentId =
    typeof raw.id === "number" ? raw.id : Number(raw.id)
  if (!Number.isFinite(commentId) || commentId <= 0) return null
  return {
    adoWorkItemId,
    adoCommentId: Math.trunc(commentId),
    authorName: raw.createdBy?.displayName ?? "(unknown)",
    authorEmail: authorEmail(raw),
    bodyMarkdown: htmlToMarkdown(raw.text ?? ""),
    createdDate: raw.createdDate ?? new Date().toISOString(),
  }
}

export async function sweepAdoSyncBack(
  opts?: SweepOptions
): Promise<SweepReport> {
  const dryRun = opts?.dryRun === true
  const report: SweepReport = {
    ticketsConsidered: 0,
    ticketsExamined: 0,
    commentsFetched: 0,
    commentsRelayed: 0,
    commentsSkippedSelf: 0,
    commentsSkippedShort: 0,
    commentsSkippedAlreadySynced: 0,
    errors: [],
    relays: [],
  }

  const tickets = await fetchLinkedTickets({
    baseUrl: opts?.baseUrl,
    token: opts?.token,
  })
  report.ticketsConsidered = tickets.length
  const cappedTickets =
    opts?.maxTickets != null ? tickets.slice(0, opts.maxTickets) : tickets

  let commentsBudget = opts?.maxComments ?? Infinity

  for (const ticket of cappedTickets) {
    if (commentsBudget <= 0) break
    report.ticketsExamined += 1
    let comments: AdoCommentRaw[]
    try {
      comments = await listAdoComments(ticket.adoWorkItemId)
    } catch (err) {
      report.errors.push({
        knownIssueId: ticket.knownIssueId,
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }
    report.commentsFetched += comments.length

    // Sort ascending by commentId so cursor advances monotonically.
    const sorted = [...comments].sort((a, b) => {
      const ai = typeof a.id === "number" ? a.id : Number(a.id)
      const bi = typeof b.id === "number" ? b.id : Number(b.id)
      return ai - bi
    })

    let highestSeen: number = ticket.lastSyncedAdoCommentId ?? 0

    for (const c of sorted) {
      if (commentsBudget <= 0) break
      const classification = classifyComment(c, ticket.lastSyncedAdoCommentId)
      const commentId = typeof c.id === "number" ? c.id : Number(c.id)
      if (Number.isFinite(commentId) && commentId > highestSeen) {
        highestSeen = Math.trunc(commentId)
      }
      if (classification.decision === "skip") {
        if (classification.reason === "self-author")
          report.commentsSkippedSelf += 1
        else if (classification.reason === "self-body-prefix")
          report.commentsSkippedSelf += 1
        else if (classification.reason === "too-short")
          report.commentsSkippedShort += 1
        else if (classification.reason === "already-synced")
          report.commentsSkippedAlreadySynced += 1
        continue
      }

      const candidate = toRelayCandidate(ticket.adoWorkItemId, c)
      if (!candidate) continue
      commentsBudget -= 1

      if (dryRun) {
        report.relays.push({
          knownIssueId: ticket.knownIssueId,
          adoWorkItemId: ticket.adoWorkItemId,
          adoCommentId: candidate.adoCommentId,
          stakeholderPostId: "(dry-run)",
          authorName: candidate.authorName,
        })
        report.commentsRelayed += 1
        continue
      }

      try {
        const result = await postStakeholderPost({
          knownIssueId: ticket.knownIssueId,
          postedBySub: candidate.authorEmail ?? syntheticSub(c),
          postedByName: candidate.authorName,
          body: candidate.bodyMarkdown,
          kind: "note",
          advanceCursorTo: candidate.adoCommentId,
          baseUrl: opts?.baseUrl,
          token: opts?.token,
        })
        report.relays.push({
          knownIssueId: ticket.knownIssueId,
          adoWorkItemId: ticket.adoWorkItemId,
          adoCommentId: candidate.adoCommentId,
          stakeholderPostId: result.stakeholderPostId,
          authorName: candidate.authorName,
        })
        report.commentsRelayed += 1
      } catch (err) {
        report.errors.push({
          knownIssueId: ticket.knownIssueId,
          message: `relay ado-comment #${candidate.adoCommentId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        })
      }
    }

    // If nothing was relayed but we did inspect new comments (everything
    // filtered), bump the cursor so we don't reprocess them next sweep.
    if (
      !dryRun &&
      highestSeen > (ticket.lastSyncedAdoCommentId ?? 0) &&
      !report.relays.some((r) => r.knownIssueId === ticket.knownIssueId)
    ) {
      try {
        await advanceSyncCursor({
          knownIssueId: ticket.knownIssueId,
          advanceTo: highestSeen,
          baseUrl: opts?.baseUrl,
          token: opts?.token,
        })
      } catch (err) {
        report.errors.push({
          knownIssueId: ticket.knownIssueId,
          message: `advance-cursor: ${
            err instanceof Error ? err.message : String(err)
          }`,
        })
      }
    }
  }

  return report
}
