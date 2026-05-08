/**
 * Operations — control-loop state model.
 *
 * Operations is NOT a dashboard. It is the executive control loop:
 * the typed surface Codex/Berthier (and the Operations page) read to
 * answer:
 *
 *   - what work is in flight right now?
 *   - what lanes does the current plan break into?
 *   - which cards are chunked out, which are fallow?
 *   - which workers are active / fallow / blocked / review-ready?
 *   - what action should happen next (launch, tap, close)?
 *
 * The shape here is the contract. Storage is an implementation detail.
 * Every consumer — the UI, the executive agent, the future
 * `pnpm os:operations` CLI — calls `deriveOperationsControlLoop` with
 * the same inputs and gets the same compact view back.
 *
 * Inputs:
 *   - the active plan (already loaded via `loadActivePlan`)
 *   - the live agent list + their recent-tail summaries
 *   - durable + manual + sniffed thread→card bindings
 *   - executive recommendations (proposed worker actions)
 *   - open review items (evidence pending review)
 *
 * Outputs: a single OperationsControlLoopView the UI can render
 * without re-deriving anything substantive.
 */

import type { ActivePlan, PlanStep } from "@/app/v3/data/mock"
import type { AgentListItem } from "@/lib/server/agent-bridge/types"
import type { RecentAgentActivity } from "@/lib/server/agent-bridge/recent-activity"
import type {
  ExecutiveRecommendation,
  ExecutiveRecommendationKind,
  ExecutiveRecommendationRisk,
  ExecutiveRecommendationStatus,
} from "./executive-recommendations"
import type { ReviewItem } from "./review-items"

// ─── Status tokens ──────────────────────────────────────────────────────────

/** Per-card status on the operations control loop. Distinct from
 *  PlanStep.status: a card can be `in-motion` on the plan but
 *  `arming` here (worker not attached yet), or `open` on the plan but
 *  `actioning` here (a worker picked it up before the plan caught up). */
export type ControlLoopStatus =
  | "actioning" // worker writing now
  | "arming" // bound, no recent activity
  | "fallow" // bound to in-motion / drifting card but idle past threshold
  | "review" // covered + evidence pending review
  | "blocked" // explicit blocker (a request_review recommendation, or `drifting`)
  | "landed" // covered, no review needed
  | "queued" // open in plan, waiting

/** How a thread got bound to a card. Manual (user clicked Link to plan
 *  card on Bento) > launch (Operator Studio spawned the worker against
 *  this card) > tail-sniff (regex over recent turn text) > scheduled
 *  (executive agent reserved a slot but the worker hasn't started). */
export type ThreadBindingSource =
  | "manual"
  | "launch"
  | "tail-sniff"
  | "scheduled"
  | "durable"

// ─── Object model ───────────────────────────────────────────────────────────

export interface OperationsWorker {
  agentId: string
  kind: "claude" | "codex" | "tmux"
  source: "claude" | "codex" | "tmux"
  project: string | null
  isLive: boolean
  /** Wall-clock age of the worker's most recent activity. `Infinity`
   *  if we have no activity record at all. */
  ageMs: number
  lastActivityAt: string | null
  headline: string
  toolHint: string | null
  bindingSource: ThreadBindingSource
  /** Plan step the worker is bound to. Null = unbound (triage). */
  planStepId: string | null
}

export interface OperationsEvidence {
  reviewItemId: string
  title: string
  summary: string
  sourceType: string
  sourceLabel: string | null
  state: ReviewItem["state"]
  planStepId: string | null
  createdAt: string
  tags: string[]
}

export interface OperationsRecommendation {
  id: string
  kind: ExecutiveRecommendationKind
  title: string
  rationale: string
  status: ExecutiveRecommendationStatus
  risk: ExecutiveRecommendationRisk
  planStepId: string | null
  agentId: string | null
  prompt: string | null
  createdAt: string
}

/** Lane icon tokens — mapped to JSX by the renderer. Keeping the data
 *  layer JSX-free lets the executive agent populate lanes from a tool
 *  call without touching React. */
export type LaneIcon =
  | "workflow"
  | "gamepad"
  | "layers"
  | "compass"
  | "target"
  | "sparkles"
  | "wrench"

export interface OperationsCard {
  stepId: string
  parentStepId: string | null
  n: number
  title: string
  description: string
  planStatus: PlanStep["status"]
  controlLoopStatus: ControlLoopStatus
  /** Short human-readable reason for this status. */
  reason: string
  workers: OperationsWorker[]
  evidence: OperationsEvidence[]
  recommendations: OperationsRecommendation[]
  evidenceSnippet: string | null
  laneKey: string
  /** Newest worker activity time on this card, ISO. Null if none. */
  newestActivityAt: string | null
  /** True if this card needs David's eye (review state, blocked, or
   *  has a high-risk recommendation pending). */
  needsAttention: boolean
}

export interface OperationsLane {
  key: string
  title: string
  blurb: string
  icon: LaneIcon
  kbTags: string[]
  cards: OperationsCard[]
  /** Pre-summed counts for quick chip rendering. */
  counts: Record<ControlLoopStatus, number>
  source: "heuristic" | "agent-curated"
}

export interface OperationsTotals {
  actioning: number
  arming: number
  fallow: number
  review: number
  blocked: number
  landed: number
  queued: number
}

export interface OperationsControlLoopView {
  /** Plan scope — anything in this view is anchored to this plan. */
  planId: string | null
  planTitle: string | null
  planState: PlanStep["status"] | string | null
  generatedAt: string
  lanes: OperationsLane[]
  /** Workers running with no bound card. Triage list. */
  unboundWorkers: OperationsWorker[]
  /** Recommendations that don't anchor to any plan step in scope. */
  floatingRecommendations: OperationsRecommendation[]
  /** Top-N "what should happen next" — open recommendations ranked by
   *  kind/risk/recency. The hero of the page. */
  nextActions: OperationsRecommendation[]
  totals: OperationsTotals
  /** Counts of cards that need David's eye (review+blocked+high-risk). */
  needsAttentionCount: number
  /** Self-describing notes about heuristics + remaining gaps so the
   *  consumer can reason about the data. Surfaces in the page footer
   *  and in the CLI payload. */
  notes: string[]
}

// ─── Lane heuristics ─────────────────────────────────────────────────────────

interface LaneRule {
  key: string
  title: string
  blurb: string
  icon: LaneIcon
  kbTags: string[]
  match: (step: PlanStep) => boolean
}

const LANE_RULES: LaneRule[] = [
  {
    key: "telegento",
    title: "Telegento",
    blurb:
      "Drop-in agent platform · Justin Searcy alliance · insurance ops.",
    icon: "workflow",
    kbTags: ["telegento", "justin-searcy", "jsa"],
    match: (s) =>
      /^step-telegento-/.test(s.id) ||
      /-ado-/.test(s.id) ||
      /-teams-/.test(s.id) ||
      /telegento/i.test(s.title),
  },
  {
    key: "game-engine",
    title: "Game engine",
    blurb:
      "Valikharlia agentic-studio buildout · scenes, NPCs, director.",
    icon: "gamepad",
    kbTags: ["valikharlia", "game-engine", "scenario"],
    match: (s) =>
      /^step-valikharlia-/.test(s.id) ||
      /^step-side-game-engine/.test(s.id) ||
      /valikharlia|game engine/i.test(s.title),
  },
  {
    key: "operator-studio",
    title: "Operator Studio",
    blurb: "The cockpit · Plan, Work, Bento, executive loop.",
    icon: "layers",
    kbTags: ["operator-studio", "operations", "bento"],
    match: () => true,
  },
]

function classifyStep(step: PlanStep): string {
  for (const lane of LANE_RULES) if (lane.match(step)) return lane.key
  return "operator-studio"
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LIVE_WINDOW_MS = 5 * 60_000
const FALLOW_AFTER_MS = 30 * 60_000

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface DeriveOperationsControlLoopInput {
  activePlan: ActivePlan | null
  agents: AgentListItem[]
  recent: RecentAgentActivity[]
  /** Durable bindings keyed by agentId. */
  durableLinks?: Record<string, { stepId: string; planId: string | null }>
  /** Manual bindings keyed by agentId (localStorage on the client). */
  manualLinks?: Record<string, string>
  recommendations?: ExecutiveRecommendation[]
  /** Open review items from the inbox (excluding executive
   *  recommendations — those are passed in `recommendations`). */
  reviewItems?: ReviewItem[]
  now?: Date
}

// ─── Derivation ─────────────────────────────────────────────────────────────

export function deriveOperationsControlLoop(
  input: DeriveOperationsControlLoopInput
): OperationsControlLoopView {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const activePlan = input.activePlan
  const planSteps = activePlan?.steps ?? []
  const stepIdSet = new Set(planSteps.map((s) => s.id))
  const recommendations = input.recommendations ?? []
  const reviewItems = input.reviewItems ?? []

  const recentById = new Map(input.recent.map((r) => [r.agentId, r]))

  // ── Resolve agent → stepId (durable > manual > tail-sniff) ──────────────
  const agentLink = new Map<
    string,
    { stepId: string; source: ThreadBindingSource }
  >()
  for (const a of input.agents) {
    const durable = input.durableLinks?.[a.id]
    if (durable) {
      agentLink.set(a.id, { stepId: durable.stepId, source: "durable" })
      continue
    }
    const manual = input.manualLinks?.[a.id]
    if (manual) {
      agentLink.set(a.id, { stepId: manual, source: "manual" })
      continue
    }
    const r = recentById.get(a.id)
    if (r?.detectedPlanCardId) {
      agentLink.set(a.id, {
        stepId: r.detectedPlanCardId,
        source: "tail-sniff",
      })
    }
  }

  // ── Build worker objects, bucket by step ─────────────────────────────────
  const workersByStep = new Map<string, OperationsWorker[]>()
  const unboundWorkers: OperationsWorker[] = []
  for (const a of input.agents) {
    const r = recentById.get(a.id) ?? null
    const link = agentLink.get(a.id)
    const planStepId = link?.stepId ?? null
    // Drop bindings that point at a step not in the active plan; the
    // worker is still listed as unbound so the user knows it exists.
    const inScope = planStepId !== null && stepIdSet.has(planStepId)
    const ageMs = r?.lastActivityAgeMs ?? Number.POSITIVE_INFINITY
    const isLive = Boolean(r?.isLive) || ageMs < LIVE_WINDOW_MS
    const worker: OperationsWorker = {
      agentId: a.id,
      kind: a.kind,
      source: a.source,
      project: a.project,
      isLive,
      ageMs,
      lastActivityAt: r?.lastActivityAt ?? a.lastActivityAt ?? null,
      headline: deriveHeadline(r, a),
      toolHint: deriveToolHint(r),
      bindingSource: link?.source ?? "tail-sniff",
      planStepId: inScope ? planStepId : null,
    }
    if (inScope && planStepId) {
      const arr = workersByStep.get(planStepId) ?? []
      arr.push(worker)
      workersByStep.set(planStepId, arr)
    } else {
      unboundWorkers.push(worker)
    }
  }

  // ── Bucket evidence (review items) and recommendations by step ──────────
  const evidenceByStep = new Map<string, OperationsEvidence[]>()
  for (const item of reviewItems) {
    if (!item.relatedPlanStepId) continue
    if (!stepIdSet.has(item.relatedPlanStepId)) continue
    const ev: OperationsEvidence = {
      reviewItemId: item.id,
      title: item.title,
      summary: item.summary,
      sourceType: String(item.sourceType),
      sourceLabel: item.sourceLabel,
      state: item.state,
      planStepId: item.relatedPlanStepId,
      createdAt: item.createdAt,
      tags: item.tags,
    }
    const arr = evidenceByStep.get(item.relatedPlanStepId) ?? []
    arr.push(ev)
    evidenceByStep.set(item.relatedPlanStepId, arr)
  }

  const recsByStep = new Map<string, OperationsRecommendation[]>()
  const floatingRecs: OperationsRecommendation[] = []
  const openRecs: OperationsRecommendation[] = []
  for (const r of recommendations) {
    const compact: OperationsRecommendation = {
      id: r.id,
      kind: r.payload.kind,
      title: r.title,
      rationale: r.rationale,
      status: r.payload.status,
      risk: r.payload.risk,
      planStepId: r.payload.target.planStepId ?? null,
      agentId: r.payload.target.agentId ?? null,
      prompt: r.payload.prompt ?? null,
      createdAt: r.createdAt,
    }
    if (compact.status === "proposed" || compact.status === "approved") {
      openRecs.push(compact)
    }
    if (compact.planStepId && stepIdSet.has(compact.planStepId)) {
      const arr = recsByStep.get(compact.planStepId) ?? []
      arr.push(compact)
      recsByStep.set(compact.planStepId, arr)
    } else if (
      compact.status === "proposed" ||
      compact.status === "approved"
    ) {
      floatingRecs.push(compact)
    }
  }

  // ── Build per-card view, bucket into lanes ──────────────────────────────
  const lanesByKey = new Map<string, OperationsLane>()
  for (const rule of LANE_RULES) {
    lanesByKey.set(rule.key, {
      key: rule.key,
      title: rule.title,
      blurb: rule.blurb,
      icon: rule.icon,
      kbTags: rule.kbTags,
      cards: [],
      counts: emptyCounts(),
      source: "heuristic",
    })
  }

  const totals: OperationsTotals = emptyCounts()
  let needsAttentionCount = 0

  for (const step of planSteps) {
    const workers = workersByStep.get(step.id) ?? []
    const evidence = evidenceByStep.get(step.id) ?? []
    const recs = recsByStep.get(step.id) ?? []

    // Earn-a-spot rule: a card lands on the desk only if it is in
    // motion, has bound workers, has unreviewed evidence, has an open
    // recommendation, or is drifting. Otherwise it lives only on the
    // strategic Plan.
    const inFlight =
      step.status === "in-motion" || step.status === "drifting"
    const hasOpenRec = recs.some(
      (r) => r.status === "proposed" || r.status === "approved"
    )
    const inReview =
      step.status === "covered" && (step.coverage?.items ?? 0) > 0
    if (
      workers.length === 0 &&
      !inFlight &&
      !inReview &&
      evidence.length === 0 &&
      !hasOpenRec
    ) {
      continue
    }

    const { status, reason, newestAt } = deriveStatus(
      step,
      workers,
      evidence,
      recs
    )
    const card: OperationsCard = {
      stepId: step.id,
      parentStepId: step.parentStepId ?? null,
      n: step.n,
      title: step.title,
      description: step.description,
      planStatus: step.status,
      controlLoopStatus: status,
      reason,
      workers,
      evidence,
      recommendations: recs,
      evidenceSnippet: step.coverage?.lastSnippet ?? null,
      laneKey: classifyStep(step),
      newestActivityAt: newestAt,
      needsAttention:
        status === "review" ||
        status === "blocked" ||
        status === "fallow" ||
        recs.some(
          (r) =>
            (r.status === "proposed" || r.status === "approved") &&
            r.risk === "high"
        ),
    }
    if (card.needsAttention) needsAttentionCount++
    totals[status]++

    const lane = lanesByKey.get(card.laneKey)
    if (lane) {
      lane.cards.push(card)
      lane.counts[status]++
    }
  }

  // Sort within lane: needsAttention first, then status precedence,
  // then plan order.
  const statusRank: Record<ControlLoopStatus, number> = {
    actioning: 0,
    fallow: 1,
    blocked: 2,
    arming: 3,
    review: 4,
    landed: 5,
    queued: 6,
  }
  for (const lane of lanesByKey.values()) {
    lane.cards.sort(
      (a, b) =>
        Number(b.needsAttention) - Number(a.needsAttention) ||
        statusRank[a.controlLoopStatus] - statusRank[b.controlLoopStatus] ||
        a.n - b.n
    )
  }

  // ── Rank "next actions" ────────────────────────────────────────────────
  const kindRank: Record<ExecutiveRecommendationKind, number> = {
    request_review: 0,
    continue_worker: 1,
    launch_worker: 2,
    mark_covered: 3,
    update_plan: 4,
  }
  const riskRank: Record<ExecutiveRecommendationRisk, number> = {
    high: 0,
    medium: 1,
    low: 2,
  }
  const nextActions = openRecs
    .slice()
    .sort(
      (a, b) =>
        kindRank[a.kind] - kindRank[b.kind] ||
        riskRank[a.risk] - riskRank[b.risk] ||
        b.createdAt.localeCompare(a.createdAt)
    )
    .slice(0, 5)

  return {
    planId: activePlan?.id ?? null,
    planTitle: activePlan?.title ?? null,
    planState: activePlan?.state ?? null,
    generatedAt: now.toISOString(),
    lanes: Array.from(lanesByKey.values()),
    unboundWorkers,
    floatingRecommendations: floatingRecs,
    nextActions,
    totals,
    needsAttentionCount,
    notes: [
      "Lane membership is heuristic (id-prefix + title regex). A first-class lane_id column is the next schema step.",
      "Card→worker binding precedence: durable (operator_thread_card_bindings) > manual (Bento localStorage) > tail-sniff over recent turns.",
      "Workers bound to a step outside the active plan are surfaced as unbound to make cross-plan mixing visible.",
      "Recommendations and evidence are first-class objects; the verbalized operation-plan goal still lives in localStorage on the client (durable schema is the next step).",
    ],
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function emptyCounts(): OperationsTotals {
  return {
    actioning: 0,
    arming: 0,
    fallow: 0,
    review: 0,
    blocked: 0,
    landed: 0,
    queued: 0,
  }
}

function deriveHeadline(
  r: RecentAgentActivity | null,
  a: AgentListItem
): string {
  return (
    r?.latestUserInstruction?.text ??
    r?.latestAssistantStatus?.text ??
    r?.staleTitle ??
    a.title ??
    a.label ??
    "(no recent text)"
  )
}

function deriveToolHint(r: RecentAgentActivity | null): string | null {
  if (!r) return null
  if (r.latestFileActivity) {
    return `${r.latestFileActivity.tool} ${r.latestFileActivity.path}`
  }
  if (r.latestToolActivity) {
    return `${r.latestToolActivity.name} ${r.latestToolActivity.summary.slice(0, 80)}`
  }
  return null
}

function deriveStatus(
  step: PlanStep,
  workers: OperationsWorker[],
  evidence: OperationsEvidence[],
  recs: OperationsRecommendation[]
): { status: ControlLoopStatus; reason: string; newestAt: string | null } {
  const newestAt = workers.reduce<string | null>((best, w) => {
    if (!w.lastActivityAt) return best
    if (!best) return w.lastActivityAt
    return w.lastActivityAt > best ? w.lastActivityAt : best
  }, null)

  // Explicit blocker via request_review recommendation.
  const blocker = recs.find(
    (r) =>
      (r.status === "proposed" || r.status === "approved") &&
      r.kind === "request_review"
  )
  if (blocker) {
    return {
      status: "blocked",
      reason: blocker.title || "review requested",
      newestAt,
    }
  }

  if (step.status === "drifting") {
    return {
      status: "blocked",
      reason: "drifting on plan",
      newestAt,
    }
  }

  const liveWorkers = workers.filter(
    (w) => w.isLive || w.ageMs < LIVE_WINDOW_MS
  )
  if (liveWorkers.length > 0) {
    return {
      status: "actioning",
      reason:
        liveWorkers.length === 1
          ? "1 worker live now"
          : `${liveWorkers.length} workers live now`,
      newestAt,
    }
  }

  if (workers.length > 0) {
    const oldestActiveAge = Math.min(...workers.map((w) => w.ageMs))
    if (step.status === "in-motion" && oldestActiveAge > FALLOW_AFTER_MS) {
      return {
        status: "fallow",
        reason: `bound worker idle for ${Math.round(oldestActiveAge / 60_000)}m`,
        newestAt,
      }
    }
    return {
      status: "arming",
      reason: "worker bound, no recent activity",
      newestAt,
    }
  }

  if (step.status === "in-motion") {
    return {
      status: "fallow",
      reason: "in-motion on plan, no worker attached",
      newestAt,
    }
  }

  if (step.status === "covered") {
    if (evidence.length > 0 || (step.coverage?.items ?? 0) > 0) {
      const n = evidence.length || step.coverage?.items || 0
      return {
        status: "review",
        reason: `${n} evidence item${n === 1 ? "" : "s"} pending review`,
        newestAt,
      }
    }
    return { status: "landed", reason: "covered on plan", newestAt }
  }

  return { status: "queued", reason: "open in plan", newestAt }
}
