/**
 * Pull pending user-feedback rows from Telegento's internal API.
 *
 * Counterpart endpoint (Worker E) on the Telegento side:
 *   GET /api/telegento/known-issues/feedback/pending
 * Authenticated via `Authorization: Bearer ${INTERNAL_API_TOKEN}`.
 *
 * The fetcher is a thin transport — no DB writes, no outbox calls.
 * Callers compose it with the stager + mark-forwarded post.
 */

import { getTelegentoInternalApiToken } from "./secrets"

export interface TelegentoFeedbackRow {
  id: string
  knownIssueId: string
  knownIssueTitle: string
  currentVersion: string | null
  requestedByName: string | null
  requestedByAdoId: number | null
  feedbackPrompt: string | null
  feedbackTargetVersion: string | null
  submittedByEmail: string
  submittedBySub: string
  pageScope: string | null
  verdict: "approve" | "request-changes" | "reject" | "needs-discussion"
  notes: string
  submittedAt: string
}

const DEFAULT_BASE_URL = "https://app.telegento.com"

function resolveBaseUrl(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.replace(/\/+$/, "")
  const envBase = process.env.TELEGENTO_BASE_URL?.trim()
  if (envBase) return envBase.replace(/\/+$/, "")
  return DEFAULT_BASE_URL
}

export async function fetchPendingFeedback(opts?: {
  baseUrl?: string
  token?: string
}): Promise<TelegentoFeedbackRow[]> {
  const baseUrl = resolveBaseUrl(opts?.baseUrl)
  const token = opts?.token ?? (await getTelegentoInternalApiToken())
  const url = `${baseUrl}/api/telegento/known-issues/feedback/pending`

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `fetchPendingFeedback: ${res.status} ${res.statusText} from ${url}${
        body ? ` — ${body.slice(0, 500)}` : ""
      }`
    )
  }

  const json = (await res.json()) as unknown
  const rows = extractRows(json)
  return rows.map(normalize)
}

function extractRows(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>
    if (Array.isArray(obj.rows)) return obj.rows
    if (Array.isArray(obj.feedback)) return obj.feedback
    if (Array.isArray(obj.data)) return obj.data
  }
  throw new Error(
    "fetchPendingFeedback: unexpected response shape — expected an array or { rows: [] }"
  )
}

function normalize(raw: unknown): TelegentoFeedbackRow {
  if (!raw || typeof raw !== "object") {
    throw new Error("fetchPendingFeedback: row is not an object")
  }
  const r = raw as Record<string, unknown>
  return {
    id: asString(r.id, "id"),
    knownIssueId: asString(r.knownIssueId ?? r.known_issue_id, "knownIssueId"),
    knownIssueTitle: asString(
      r.knownIssueTitle ?? r.known_issue_title,
      "knownIssueTitle"
    ),
    currentVersion: asOptString(r.currentVersion ?? r.current_version),
    requestedByName: asOptString(r.requestedByName ?? r.requested_by_name),
    requestedByAdoId: asOptInt(r.requestedByAdoId ?? r.requested_by_ado_id),
    feedbackPrompt: asOptString(r.feedbackPrompt ?? r.feedback_prompt),
    feedbackTargetVersion: asOptString(
      r.feedbackTargetVersion ?? r.feedback_target_version
    ),
    submittedByEmail: asString(
      r.submittedByEmail ?? r.submitted_by_email,
      "submittedByEmail"
    ),
    submittedBySub: asString(
      r.submittedBySub ?? r.submitted_by_sub,
      "submittedBySub"
    ),
    pageScope: asOptString(r.pageScope ?? r.page_scope),
    verdict: asVerdict(r.verdict),
    notes: asString(r.notes ?? "", "notes"),
    submittedAt: asString(r.submittedAt ?? r.submitted_at, "submittedAt"),
  }
}

function asString(v: unknown, field: string): string {
  if (typeof v !== "string") {
    throw new Error(`fetchPendingFeedback: field "${field}" must be a string`)
  }
  return v
}

function asOptString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v !== "string") return null
  return v
}

function asOptInt(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return null
}

function asVerdict(v: unknown): TelegentoFeedbackRow["verdict"] {
  const allowed: TelegentoFeedbackRow["verdict"][] = [
    "approve",
    "request-changes",
    "reject",
    "needs-discussion",
  ]
  if (typeof v === "string" && (allowed as string[]).includes(v)) {
    return v as TelegentoFeedbackRow["verdict"]
  }
  throw new Error(
    `fetchPendingFeedback: verdict "${String(v)}" is not one of ${allowed.join(", ")}`
  )
}

export async function markFeedbackForwarded(input: {
  feedbackId: string
  outboxRowId: string
  baseUrl?: string
  token?: string
}): Promise<void> {
  const baseUrl = resolveBaseUrl(input.baseUrl)
  const token = input.token ?? (await getTelegentoInternalApiToken())
  const url = `${baseUrl}/api/telegento/known-issues/feedback/${encodeURIComponent(input.feedbackId)}/mark-forwarded`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ outboxRowId: input.outboxRowId }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(
      `markFeedbackForwarded: ${res.status} ${res.statusText} from ${url}${
        body ? ` — ${body.slice(0, 500)}` : ""
      }`
    )
  }
}
