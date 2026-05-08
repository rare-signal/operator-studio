import "server-only"

/**
 * Executive agent recommendations.
 *
 * David-only "what should the next worker action be?" surface. First
 * slice of the executive loop: this layer proposes concrete next
 * actions (launch a worker, nudge an existing one, request David's
 * judgment, mutate the plan). Nothing here executes automatically —
 * approval flips status to `approved`, and execution is performed
 * downstream (pbcopy, Bento send, plan mutation) only after that.
 *
 * Storage rides on `operatorReviewItems` with `sourceType =
 * "executive_recommendation"`. The structured payload lives in
 * `rawPayload`; this module is the typed gateway so callers don't
 * touch that schema.
 */

import {
  createReviewItem,
  decideReviewItem,
  getReviewItemById,
  listReviewItems,
  updateReviewItem,
  type ReviewItem,
} from "./review-items"

export const EXECUTIVE_RECOMMENDATION_SOURCE_TYPE =
  "executive_recommendation" as const

export type ExecutiveRecommendationKind =
  | "launch_worker"
  | "continue_worker"
  | "request_review"
  | "update_plan"
  | "mark_covered"

export type WorkerKind = "claude" | "codex" | "tmux" | "app" | "other"

export type ExecutiveRecommendationStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "executed"
  | "superseded"

/** Risk classification — drives the UI affordance and whether hot mode
 *  is required. `low` = read-only / advisory, `medium` = mutates plan
 *  state, `high` = side effects on a live agent (send/launch). */
export type ExecutiveRecommendationRisk = "low" | "medium" | "high"

export interface ExecutiveRecommendationTarget {
  /** Plan step the recommendation is anchored to (e.g. the card the
   *  worker will work on, or the card to mark covered). */
  planStepId?: string | null
  /** Existing live-agent id (e.g. `claude:<uuid>`, `tmux:<name>`),
   *  required for continue_worker. */
  agentId?: string | null
  /** Working directory hint for launch_worker. */
  cwd?: string | null
}

export interface ExecutiveRecommendationPayload {
  kind: ExecutiveRecommendationKind
  workerKind?: WorkerKind | null
  target: ExecutiveRecommendationTarget
  /** Exact prompt for launch_worker, or exact nudge text for
   *  continue_worker. Stored verbatim so David can copy/paste. */
  prompt?: string | null
  expectedOutput?: string | null
  acceptanceCriteria?: string | null
  riskNote?: string | null
  risk: ExecutiveRecommendationRisk
  status: ExecutiveRecommendationStatus
  /** Free-form provenance: source thread id, agent run id, signal id,
   *  or a short human label like "stale tmux session for 17m". */
  evidence?: string | null
  /** Track the launch path actually taken once executed. */
  executionNote?: string | null
  /** Set when the recommendation was launched as a fresh worker via
   *  the agent-launch primitive. Captures enough state to find the
   *  spawned worker after-the-fact. */
  launch?: ExecutiveRecommendationLaunch | null
}

export interface ExecutiveRecommendationLaunch {
  /** Composite agent id, e.g. `tmux:exec-abc123`. Lines up with the
   *  Bento agent listing so the launched worker shows up there. */
  agentId: string
  sessionName: string
  cwd: string | null
  launchCommand: string
  promptPreview: string
  launchedAt: string
  /** Plan step the worker is bound to (mirrors target.planStepId at
   *  launch time, frozen for audit). */
  planStepId: string | null
}

export interface ExecutiveRecommendation {
  id: string
  workspaceId: string
  title: string
  rationale: string
  payload: ExecutiveRecommendationPayload
  /** Mirrors review item state for the inbox UI. */
  reviewState: ReviewItem["state"]
  createdAt: string
  updatedAt: string
  decidedAt: string | null
}

const VALID_KINDS: ExecutiveRecommendationKind[] = [
  "launch_worker",
  "continue_worker",
  "request_review",
  "update_plan",
  "mark_covered",
]

const VALID_RISKS: ExecutiveRecommendationRisk[] = ["low", "medium", "high"]

const VALID_STATUSES: ExecutiveRecommendationStatus[] = [
  "proposed",
  "approved",
  "rejected",
  "executed",
  "superseded",
]

function fromReviewItem(item: ReviewItem): ExecutiveRecommendation | null {
  if (item.sourceType !== EXECUTIVE_RECOMMENDATION_SOURCE_TYPE) return null
  const payload = normalizePayload(item.rawPayload ?? {})
  return {
    id: item.id,
    workspaceId: item.workspaceId,
    title: item.title,
    rationale: item.rationale ?? item.summary ?? "",
    payload,
    reviewState: item.state,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    decidedAt: item.decidedAt,
  }
}

function normalizePayload(
  raw: Record<string, unknown>
): ExecutiveRecommendationPayload {
  const kind = VALID_KINDS.includes(raw.kind as ExecutiveRecommendationKind)
    ? (raw.kind as ExecutiveRecommendationKind)
    : "request_review"
  const risk = VALID_RISKS.includes(
    raw.risk as ExecutiveRecommendationRisk
  )
    ? (raw.risk as ExecutiveRecommendationRisk)
    : kind === "launch_worker" || kind === "continue_worker"
      ? "high"
      : "medium"
  const status = VALID_STATUSES.includes(
    raw.status as ExecutiveRecommendationStatus
  )
    ? (raw.status as ExecutiveRecommendationStatus)
    : "proposed"
  const target = (raw.target ?? {}) as ExecutiveRecommendationTarget
  return {
    kind,
    workerKind:
      typeof raw.workerKind === "string"
        ? (raw.workerKind as WorkerKind)
        : null,
    target: {
      planStepId:
        typeof target.planStepId === "string" ? target.planStepId : null,
      agentId: typeof target.agentId === "string" ? target.agentId : null,
      cwd: typeof target.cwd === "string" ? target.cwd : null,
    },
    prompt: typeof raw.prompt === "string" ? raw.prompt : null,
    expectedOutput:
      typeof raw.expectedOutput === "string" ? raw.expectedOutput : null,
    acceptanceCriteria:
      typeof raw.acceptanceCriteria === "string"
        ? raw.acceptanceCriteria
        : null,
    riskNote: typeof raw.riskNote === "string" ? raw.riskNote : null,
    risk,
    status,
    evidence: typeof raw.evidence === "string" ? raw.evidence : null,
    executionNote:
      typeof raw.executionNote === "string" ? raw.executionNote : null,
    launch: normalizeLaunch(raw.launch),
  }
}

function normalizeLaunch(
  raw: unknown
): ExecutiveRecommendationLaunch | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.agentId !== "string" || typeof r.sessionName !== "string") {
    return null
  }
  return {
    agentId: r.agentId,
    sessionName: r.sessionName,
    cwd: typeof r.cwd === "string" ? r.cwd : null,
    launchCommand:
      typeof r.launchCommand === "string" ? r.launchCommand : "",
    promptPreview:
      typeof r.promptPreview === "string" ? r.promptPreview : "",
    launchedAt:
      typeof r.launchedAt === "string"
        ? r.launchedAt
        : new Date().toISOString(),
    planStepId: typeof r.planStepId === "string" ? r.planStepId : null,
  }
}

export interface CreateExecutiveRecommendationInput {
  title: string
  rationale: string
  kind: ExecutiveRecommendationKind
  workerKind?: WorkerKind | null
  target?: ExecutiveRecommendationTarget
  prompt?: string | null
  expectedOutput?: string | null
  acceptanceCriteria?: string | null
  riskNote?: string | null
  risk?: ExecutiveRecommendationRisk
  evidence?: string | null
  /** Optional dedupe handle. When set, re-creating an identical
   *  recommendation updates the existing row in place. */
  sourceId?: string | null
  /** Free-form labels for filtering. Always tagged with the kind. */
  tags?: string[]
}

export async function createExecutiveRecommendation(
  workspaceId: string,
  input: CreateExecutiveRecommendationInput
): Promise<ExecutiveRecommendation> {
  if (!VALID_KINDS.includes(input.kind)) {
    throw new Error(`Invalid recommendation kind: ${input.kind}`)
  }
  if (input.risk && !VALID_RISKS.includes(input.risk)) {
    throw new Error(`Invalid risk: ${input.risk}`)
  }

  const payload: ExecutiveRecommendationPayload = normalizePayload({
    kind: input.kind,
    workerKind: input.workerKind ?? null,
    target: input.target ?? {},
    prompt: input.prompt ?? null,
    expectedOutput: input.expectedOutput ?? null,
    acceptanceCriteria: input.acceptanceCriteria ?? null,
    riskNote: input.riskNote ?? null,
    risk: input.risk,
    status: "proposed",
    evidence: input.evidence ?? null,
  })

  const tags = Array.from(
    new Set([
      "executive",
      input.kind,
      ...(input.tags ?? []).filter((t) => typeof t === "string"),
    ])
  )

  const item = await createReviewItem(workspaceId, {
    sourceType: EXECUTIVE_RECOMMENDATION_SOURCE_TYPE,
    sourceLabel: "executive",
    sourceId: input.sourceId ?? null,
    title: input.title,
    summary: input.rationale,
    rationale: input.rationale,
    rawPayload: payload as unknown as Record<string, unknown>,
    relatedPlanStepId: payload.target.planStepId ?? null,
    proposedAction: input.prompt ?? null,
    visibility: "david_only",
    state: "raw",
    tags,
  })

  const rec = fromReviewItem(item)
  if (!rec) throw new Error("Failed to materialize executive recommendation")
  return rec
}

export async function listExecutiveRecommendations(
  workspaceId: string,
  opts: { includeClosed?: boolean; limit?: number } = {}
): Promise<ExecutiveRecommendation[]> {
  const items = await listReviewItems(workspaceId, {
    sourceType: EXECUTIVE_RECOMMENDATION_SOURCE_TYPE,
    includeClosed: opts.includeClosed ?? true,
    limit: opts.limit ?? 200,
  })
  return items
    .map(fromReviewItem)
    .filter((r): r is ExecutiveRecommendation => r !== null)
}

export async function getExecutiveRecommendation(
  workspaceId: string,
  id: string
): Promise<ExecutiveRecommendation | null> {
  const item = await getReviewItemById(workspaceId, id)
  if (!item) return null
  return fromReviewItem(item)
}

export type ExecutiveDecision =
  | "approve"
  | "reject"
  | "mark_executed"
  | "supersede"

/**
 * Approve / reject / mark executed / supersede.
 *
 * - approve     → status=approved, review state stays open so David can
 *                 still mark it executed afterwards.
 * - reject      → status=rejected, review state=rejected (closed).
 * - mark_executed → status=executed, review state=imported (closed).
 *                 Caller should pass an executionNote describing what
 *                 actually happened (copied prompt, sent to agent X,
 *                 plan card updated).
 * - supersede   → status=superseded, review state=rejected (closed).
 *                 For when a newer recommendation replaces this one.
 */
export async function decideExecutiveRecommendation(
  workspaceId: string,
  id: string,
  decision: ExecutiveDecision,
  opts: { executionNote?: string | null } = {}
): Promise<ExecutiveRecommendation | null> {
  const current = await getExecutiveRecommendation(workspaceId, id)
  if (!current) return null

  const nextPayload: ExecutiveRecommendationPayload = {
    ...current.payload,
    status:
      decision === "approve"
        ? "approved"
        : decision === "reject"
          ? "rejected"
          : decision === "mark_executed"
            ? "executed"
            : "superseded",
    executionNote:
      decision === "mark_executed"
        ? (opts.executionNote ?? current.payload.executionNote ?? null)
        : current.payload.executionNote,
  }

  // Persist the new payload via update first.
  await updateReviewItem(workspaceId, id, {
    rationale: current.rationale,
  })

  // Direct rawPayload update — review-items doesn't expose payload
  // patches, so we go through createReviewItem with sourceId=id is
  // unsafe; instead we read the row and rewrite via decideReviewItem
  // for closed states, or stash the payload on the rawPayload column
  // through a fresh upsert. The dedupe path in createReviewItem only
  // matches on sourceType+sourceId, so we can't reuse it here. Keep
  // the payload mutation small and explicit.
  await rewriteRecommendationPayload(workspaceId, id, nextPayload)

  if (decision === "reject" || decision === "supersede") {
    await decideReviewItem(workspaceId, id, "reject")
  } else if (decision === "mark_executed") {
    // Imported = "this recommendation produced an action that landed".
    // Reuse the existing review-item closed state so the inbox count
    // drops without inventing a new state column.
    await decideReviewItem(workspaceId, id, "promote")
  }
  // approve: stay open. David can mark_executed later.

  return getExecutiveRecommendation(workspaceId, id)
}

/**
 * Record a fresh-worker launch against this recommendation. Sets the
 * structured `launch` metadata, flips status to `executed`, and
 * closes the review row. Caller is expected to have already gated on
 * approval + hot mode.
 */
export async function recordRecommendationLaunch(
  workspaceId: string,
  id: string,
  launch: ExecutiveRecommendationLaunch,
  executionNote: string
): Promise<ExecutiveRecommendation | null> {
  const current = await getExecutiveRecommendation(workspaceId, id)
  if (!current) return null
  const nextPayload: ExecutiveRecommendationPayload = {
    ...current.payload,
    status: "executed",
    executionNote,
    launch,
  }
  await rewriteRecommendationPayload(workspaceId, id, nextPayload)
  await decideReviewItem(workspaceId, id, "promote")
  return getExecutiveRecommendation(workspaceId, id)
}

/**
 * Direct rawPayload patch. Kept private to this module because the
 * review-items helper deliberately doesn't expose it — for ADO/Teams
 * sources the payload is the upstream snapshot and must be immutable.
 * Executive recommendations are different: the payload is *our* state.
 */
async function rewriteRecommendationPayload(
  workspaceId: string,
  id: string,
  payload: ExecutiveRecommendationPayload
): Promise<void> {
  const { getDb } = await import("@/lib/server/db/client")
  const { operatorReviewItems } = await import("@/lib/server/db/schema")
  const { and, eq } = await import("drizzle-orm")
  const db = getDb()
  await db
    .update(operatorReviewItems)
    .set({
      rawPayload: payload as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operatorReviewItems.workspaceId, workspaceId),
        eq(operatorReviewItems.id, id)
      )
    )
}
