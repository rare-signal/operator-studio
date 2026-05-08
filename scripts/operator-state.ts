/**
 * pnpm os:state — fast operational snapshot for agentic planning.
 *
 * Designed to be cheap enough for Codex/Claude to call every turn:
 *
 *   pnpm os:state                 # compact human-readable summary
 *   pnpm os:state --json          # machine-readable
 *   pnpm os:state --compact       # one-line headline + counts
 *   pnpm os:state --waiting       # focus: review waits + pending recs
 *   pnpm os:state --agent-tail    # include recent agent tail derivation
 *   pnpm os:state --completed     # include recently-covered cards
 *   pnpm os:state --workspace=ID  # default: global
 *
 * Performance notes:
 *  - Plan/recommendation/review queries are pre-indexed DB reads.
 *  - Agent activity uses the same current-tail helper that powers
 *    Bento; it scans a small number of JSONL files + tmux panes.
 *  - We do NOT invoke decision-extractor / theme-graph / wayseer
 *    sleuth here — those are slow synthesis paths and belong upstream.
 */

import { and, eq, inArray, isNull } from "drizzle-orm"

import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getActivePlan } from "../lib/operator-studio/plans"
import {
  listExecutiveRecommendations,
  type ExecutiveRecommendation,
} from "../lib/operator-studio/executive-recommendations"
import { listReviewItems, type ReviewItem } from "../lib/operator-studio/review-items"
import {
  getRecentAgentActivity,
  type RecentAgentActivity,
} from "../lib/server/agent-bridge/recent-activity"
import type { OperatorPlanStep, OperatorSessionPlan } from "../lib/operator-studio/types"
import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"

interface Options {
  workspaceId: string
  json: boolean
  compact: boolean
  waiting: boolean
  agentTail: boolean
  completed: boolean
}

interface OperatorStateSnapshot {
  fetchedAt: string
  tookMs: number
  workspaceId: string
  freshnessNote: string
  plan: PlanSummary | null
  cards: {
    inMotion: CardSummary[]
    open: CardSummary[]
    recentlyCovered: CardSummary[]
    counts: { inMotion: number; open: number; covered: number; skipped: number }
  }
  executive: {
    open: ExecutiveSummary[]
    counts: {
      proposed: number
      approved: number
      executed: number
      rejected: number
      total: number
    }
  }
  reviewWaits: ReviewSummary[]
  recentAgents: AgentSummary[]
  blockers: string[]
}

interface PlanSummary {
  id: string
  title: string
  state: string
  pinned: boolean
  goal: string | null
  outcome: string | null
  updatedAt: string
}

interface CardSummary {
  id: string
  title: string
  status: OperatorPlanStep["status"]
  parentStepId: string | null
  /** Number of non-deleted child cards (any status). */
  childCount: number
  /** Number of children that are still open or in-motion. */
  openChildCount: number
  /** True if this card has at least one child — used by os:cycle to
   *  skip parent/orchestration cards from "no active agent" nags. */
  isParent: boolean
  /** Trimmed description preview — used by leaf/actionable heuristics
   *  in os:cycle. Null if no description on the row. */
  descriptionPreview: string | null
  /** Length of the full description in chars (not the preview). */
  descriptionLength: number
  /** ISO timestamp of the row's last update. Used for freshness
   *  dampening in os:cycle. */
  updatedAt: string | null
  updatedAtAgeMs: number | null
}

interface ExecutiveSummary {
  id: string
  title: string
  kind: string
  status: string
  risk: string
  planStepId: string | null
  agentId: string | null
  rationale: string
  promptPreview: string | null
  acceptanceCriteria: string | null
  ageMs: number
  updatedAt: string
}

interface ReviewSummary {
  id: string
  title: string
  sourceType: string
  state: string
  visibility: string
  relatedPlanStepId: string | null
  ageMs: number
  updatedAt: string
}

interface AgentSummary {
  agentId: string
  source: string
  isLive: boolean
  ageMs: number
  lastActivityAt: string
  status: string
  detectedPlanCardId: string | null
  staleTitle: string | null
  latestUserInstruction: string | null
  latestAssistantStatus: string | null
  latestToolActivity: string | null
  latestFileActivity: string | null
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    workspaceId: GLOBAL_WORKSPACE_ID,
    json: false,
    compact: false,
    waiting: false,
    agentTail: false,
    completed: false,
  }
  for (const arg of argv) {
    if (arg === "--json") opts.json = true
    else if (arg === "--compact") opts.compact = true
    else if (arg === "--waiting") opts.waiting = true
    else if (arg === "--agent-tail") opts.agentTail = true
    else if (arg === "--completed") opts.completed = true
    else if (arg.startsWith("--workspace=")) opts.workspaceId = arg.slice("--workspace=".length)
    else if (arg === "--help" || arg === "-h") {
      printUsage()
      process.exit(0)
    } else {
      console.error(`unknown flag: ${arg}`)
      printUsage()
      process.exit(1)
    }
  }
  return opts
}

function printUsage(): void {
  console.error(
    [
      "usage: pnpm os:state [flags]",
      "",
      "flags:",
      "  --json              machine-readable output",
      "  --compact           single-line headline + counts only",
      "  --waiting           focus: review waits + pending recommendations",
      "  --agent-tail        include recent agent tail derivation",
      "  --completed         include recently-covered cards",
      "  --workspace=ID      default: global",
    ].join("\n")
  )
}

function ageMs(iso: string): number {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Date.now() - t)
}

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function trim(s: string | null | undefined, n: number): string | null {
  if (!s) return null
  const cleaned = s.replace(/\s+/g, " ").trim()
  if (cleaned.length <= n) return cleaned
  return cleaned.slice(0, n - 1) + "…"
}

function summarizePlan(plan: OperatorSessionPlan): PlanSummary {
  return {
    id: plan.id,
    title: plan.title,
    state: plan.state,
    pinned: plan.pinned,
    goal: plan.goal,
    outcome: plan.outcome,
    updatedAt: plan.updatedAt,
  }
}

interface StepMeta {
  childCount: number
  openChildCount: number
  description: string | null
  updatedAt: string | null
}

function summarizeCard(step: OperatorPlanStep, meta: StepMeta): CardSummary {
  const desc = meta.description
  const updatedAt = meta.updatedAt
  return {
    id: step.id,
    title: step.title,
    status: step.status,
    parentStepId: step.parentStepId,
    childCount: meta.childCount,
    openChildCount: meta.openChildCount,
    isParent: meta.childCount > 0,
    descriptionPreview: trim(desc, 240),
    descriptionLength: desc ? desc.length : 0,
    updatedAt,
    updatedAtAgeMs: updatedAt ? ageMs(updatedAt) : null,
  }
}

async function loadStepMeta(
  workspaceId: string,
  planId: string,
  steps: OperatorPlanStep[]
): Promise<Map<string, StepMeta>> {
  const meta = new Map<string, StepMeta>()
  if (steps.length === 0) return meta

  // Children counts derive from the in-memory plan steps.
  const childCount = new Map<string, number>()
  const openChildCount = new Map<string, number>()
  for (const s of steps) {
    if (!s.parentStepId) continue
    childCount.set(s.parentStepId, (childCount.get(s.parentStepId) ?? 0) + 1)
    if (s.status === "open" || s.status === "in-motion") {
      openChildCount.set(
        s.parentStepId,
        (openChildCount.get(s.parentStepId) ?? 0) + 1
      )
    }
  }

  // Pull updatedAt + description directly from the table — these aren't
  // exposed on the OperatorPlanStep interface and we want them without
  // widening the type.
  const db = getDb()
  const rows = await db
    .select({
      id: operatorPlanSteps.id,
      description: operatorPlanSteps.description,
      updatedAt: operatorPlanSteps.updatedAt,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.planId, planId),
        isNull(operatorPlanSteps.deletedAt),
        inArray(
          operatorPlanSteps.id,
          steps.map((s) => s.id)
        )
      )
    )
  const rowById = new Map(rows.map((r) => [r.id, r]))

  for (const s of steps) {
    const row = rowById.get(s.id)
    meta.set(s.id, {
      childCount: childCount.get(s.id) ?? 0,
      openChildCount: openChildCount.get(s.id) ?? 0,
      description: row?.description ?? s.description ?? null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    })
  }
  return meta
}

function summarizeRecommendation(rec: ExecutiveRecommendation): ExecutiveSummary {
  return {
    id: rec.id,
    title: rec.title,
    kind: rec.payload.kind,
    status: rec.payload.status,
    risk: rec.payload.risk,
    planStepId: rec.payload.target.planStepId ?? null,
    agentId: rec.payload.target.agentId ?? null,
    rationale: rec.rationale,
    promptPreview: trim(rec.payload.prompt, 160),
    acceptanceCriteria: trim(rec.payload.acceptanceCriteria, 240),
    ageMs: ageMs(rec.updatedAt),
    updatedAt: rec.updatedAt,
  }
}

function summarizeReview(item: ReviewItem): ReviewSummary {
  return {
    id: item.id,
    title: item.title,
    sourceType: item.sourceType,
    state: item.state,
    visibility: item.visibility,
    relatedPlanStepId: item.relatedPlanStepId,
    ageMs: ageMs(item.updatedAt),
    updatedAt: item.updatedAt,
  }
}

function summarizeAgent(a: RecentAgentActivity): AgentSummary {
  return {
    agentId: a.agentId,
    source: a.source,
    isLive: a.isLive,
    ageMs: a.lastActivityAgeMs,
    lastActivityAt: a.lastActivityAt,
    status: a.status,
    detectedPlanCardId: a.detectedPlanCardId,
    staleTitle: a.staleTitle,
    latestUserInstruction: trim(a.latestUserInstruction?.text ?? null, 160),
    latestAssistantStatus: trim(a.latestAssistantStatus?.text ?? null, 200),
    latestToolActivity: a.latestToolActivity
      ? `${a.latestToolActivity.name} ${trim(a.latestToolActivity.summary, 120) ?? ""}`.trim()
      : null,
    latestFileActivity: a.latestFileActivity
      ? `${a.latestFileActivity.tool} ${a.latestFileActivity.path}`
      : null,
  }
}

const RECENT_COVERED_WINDOW_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

async function buildSnapshot(opts: Options): Promise<OperatorStateSnapshot> {
  const startedAt = Date.now()
  const fetchedAt = new Date().toISOString()

  const [plan, recommendations, reviewItems, agents] = await Promise.all([
    getActivePlan(opts.workspaceId, null, "os:state").catch(() => null),
    listExecutiveRecommendations(opts.workspaceId, {
      includeClosed: opts.completed || opts.waiting,
      limit: 200,
    }).catch(() => [] as ExecutiveRecommendation[]),
    listReviewItems(opts.workspaceId, {
      includeClosed: false,
      limit: 100,
    }).catch(() => [] as ReviewItem[]),
    getRecentAgentActivity({
      appLimit: opts.agentTail ? 8 : 4,
      recentTurns: opts.agentTail ? 12 : 6,
      tmuxLines: opts.agentTail ? 60 : 30,
      limit: opts.agentTail ? 12 : 6,
      // Only count agents active in the last 6h by default — older
      // sessions add scan time and are rarely actionable.
      freshWithinMs: opts.agentTail ? 0 : 1000 * 60 * 60 * 6,
    }).catch(() => [] as RecentAgentActivity[]),
  ])

  const cards = (plan?.steps ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)

  const stepMeta = plan
    ? await loadStepMeta(opts.workspaceId, plan.id, cards).catch(
        () => new Map<string, StepMeta>()
      )
    : new Map<string, StepMeta>()
  const metaFor = (s: OperatorPlanStep): StepMeta =>
    stepMeta.get(s.id) ?? {
      childCount: 0,
      openChildCount: 0,
      description: s.description ?? null,
      updatedAt: null,
    }

  const inMotion = cards.filter((s) => s.status === "in-motion")
  const open = cards.filter((s) => s.status === "open")
  const covered = cards.filter((s) => s.status === "covered")
  const skipped = cards.filter((s) => s.status === "skipped")

  // We don't have updatedAt on OperatorPlanStep; "recently covered" is
  // best-effort: take the last N covered cards in plan order.
  const recentlyCovered = covered.slice(-5)

  // Filter executive recommendations to "open" set (proposed / approved
  // and not closed). Caller can opt into closed via --completed.
  const open_recs = recommendations.filter(
    (r) => r.payload.status === "proposed" || r.payload.status === "approved"
  )
  const counts = {
    proposed: recommendations.filter((r) => r.payload.status === "proposed").length,
    approved: recommendations.filter((r) => r.payload.status === "approved").length,
    executed: recommendations.filter((r) => r.payload.status === "executed").length,
    rejected: recommendations.filter(
      (r) => r.payload.status === "rejected" || r.payload.status === "superseded"
    ).length,
    total: recommendations.length,
  }

  // Review waits: open David-only items only (everything else is
  // already plumbed elsewhere).
  const reviewWaits = reviewItems
    .filter((r) => r.visibility === "david_only")
    // Drop executive recommendations from this bucket — they have
    // their own section above.
    .filter((r) => r.sourceType !== "executive_recommendation")

  // Blockers: stale in-motion cards with no live agent activity
  // pointing at them, or recommendations rejected with note.
  const detectedCards = new Set(
    agents
      .map((a) => a.detectedPlanCardId)
      .filter((s): s is string => typeof s === "string")
  )
  const blockers: string[] = []
  for (const card of inMotion) {
    if (!detectedCards.has(card.id)) {
      blockers.push(`in-motion card without active agent: ${card.id} (${card.title})`)
    }
  }

  const snapshot: OperatorStateSnapshot = {
    fetchedAt,
    tookMs: Date.now() - startedAt,
    workspaceId: opts.workspaceId,
    freshnessNote:
      "Plan/recs/reviews are live DB reads. Agent activity is current-tail-derived; treat staleTitle as advisory and trust latest* fields and ageMs.",
    plan: plan ? summarizePlan(plan) : null,
    cards: {
      inMotion: inMotion.map(((s) => summarizeCard(s, metaFor(s)))),
      open: open.map(((s) => summarizeCard(s, metaFor(s)))),
      recentlyCovered: opts.completed
        ? recentlyCovered.map(((s) => summarizeCard(s, metaFor(s))))
        : recentlyCovered.slice(-3).map(((s) => summarizeCard(s, metaFor(s)))),
      counts: {
        inMotion: inMotion.length,
        open: open.length,
        covered: covered.length,
        skipped: skipped.length,
      },
    },
    executive: {
      open: open_recs.map(summarizeRecommendation),
      counts,
    },
    reviewWaits: reviewWaits.map(summarizeReview),
    recentAgents: agents.map(summarizeAgent),
    blockers,
  }
  // Quiet unused warning for window constant (kept for future stale
  // detection on covered timestamps).
  void RECENT_COVERED_WINDOW_MS
  return snapshot
}

function renderText(snap: OperatorStateSnapshot, opts: Options): string {
  const lines: string[] = []
  const headline = `os:state · ${snap.fetchedAt} · workspace=${snap.workspaceId} · took ${snap.tookMs}ms`
  if (opts.compact) {
    const c = snap.cards.counts
    const e = snap.executive.counts
    return [
      headline,
      `plan=${snap.plan?.title ?? "<none>"} (${snap.plan?.state ?? "?"})`,
      `cards in-motion=${c.inMotion} open=${c.open} covered=${c.covered}`,
      `recs proposed=${e.proposed} approved=${e.approved} executed=${e.executed}`,
      `reviews=${snap.reviewWaits.length} agents=${snap.recentAgents.length} blockers=${snap.blockers.length}`,
    ].join("\n")
  }

  lines.push(headline)
  lines.push(`note: ${snap.freshnessNote}`)
  lines.push("")

  if (snap.plan) {
    const tags: string[] = [snap.plan.state]
    if (snap.plan.pinned) tags.push("pinned")
    lines.push(`PLAN: ${snap.plan.title}  (${snap.plan.id} · ${tags.join("·")})`)
    if (snap.plan.goal) lines.push(`  goal: ${trim(snap.plan.goal, 240)}`)
    if (snap.plan.outcome) lines.push(`  outcome: ${trim(snap.plan.outcome, 240)}`)
  } else {
    lines.push("PLAN: <none resolved>")
  }
  lines.push("")

  // Cards
  const c = snap.cards
  lines.push(
    `CARDS: in-motion=${c.counts.inMotion} open=${c.counts.open} covered=${c.counts.covered} skipped=${c.counts.skipped}`
  )
  if (c.inMotion.length > 0) {
    lines.push(`  in-motion (${c.inMotion.length}):`)
    for (const s of c.inMotion) lines.push(`    [in-motion] ${s.id}  ${trim(s.title, 100)}`)
  }
  const openSlice = opts.waiting ? c.open : c.open.slice(0, 8)
  if (openSlice.length > 0) {
    lines.push(`  open (${c.counts.open}${openSlice.length < c.counts.open ? `, top ${openSlice.length}` : ""}):`)
    for (const s of openSlice) lines.push(`    [open]      ${s.id}  ${trim(s.title, 100)}`)
  }
  if (c.recentlyCovered.length > 0 && (opts.completed || !opts.waiting)) {
    lines.push(`  recently covered (${c.recentlyCovered.length}):`)
    for (const s of c.recentlyCovered) lines.push(`    [covered]   ${s.id}  ${trim(s.title, 100)}`)
  }
  lines.push("")

  // Executive recommendations
  const e = snap.executive
  lines.push(
    `EXECUTIVE RECOMMENDATIONS: proposed=${e.counts.proposed} approved=${e.counts.approved} executed=${e.counts.executed} rejected/superseded=${e.counts.rejected}`
  )
  if (e.open.length === 0) {
    lines.push("  (no open recommendations)")
  } else {
    for (const r of e.open) {
      const target = r.planStepId ? ` · card=${r.planStepId}` : ""
      const agent = r.agentId ? ` · agent=${r.agentId}` : ""
      lines.push(
        `  [${r.status}/${r.risk}] ${r.kind}${target}${agent}  age=${fmtAge(r.ageMs)}`
      )
      lines.push(`    ${r.id}  ${trim(r.title, 120)}`)
      if (r.rationale) lines.push(`    why: ${trim(r.rationale, 200)}`)
      if (r.promptPreview) lines.push(`    prompt: ${r.promptPreview}`)
      if (r.acceptanceCriteria) lines.push(`    accept: ${r.acceptanceCriteria}`)
    }
  }
  lines.push("")

  // Review waits
  if (snap.reviewWaits.length > 0) {
    lines.push(`REVIEW WAITS (David, ${snap.reviewWaits.length}):`)
    const slice = opts.waiting ? snap.reviewWaits : snap.reviewWaits.slice(0, 8)
    for (const r of slice) {
      const card = r.relatedPlanStepId ? ` · card=${r.relatedPlanStepId}` : ""
      lines.push(
        `  [${r.state}] ${r.sourceType}${card}  age=${fmtAge(r.ageMs)}  ${trim(r.title, 100)}`
      )
    }
    if (!opts.waiting && snap.reviewWaits.length > slice.length) {
      lines.push(`  … (+${snap.reviewWaits.length - slice.length} more, use --waiting)`)
    }
    lines.push("")
  }

  // Agents
  if (snap.recentAgents.length > 0) {
    lines.push(`RECENT AGENT ACTIVITY (${snap.recentAgents.length}):`)
    for (const a of snap.recentAgents) {
      const live = a.isLive ? "live" : "idle"
      const card = a.detectedPlanCardId ? ` card=${a.detectedPlanCardId}` : ""
      lines.push(`  [${live}/${a.source}] ${a.agentId}  age=${fmtAge(a.ageMs)}${card}  status=${a.status}`)
      if (opts.agentTail) {
        if (a.latestUserInstruction) lines.push(`    user: ${a.latestUserInstruction}`)
        if (a.latestAssistantStatus) lines.push(`    asst: ${a.latestAssistantStatus}`)
        if (a.latestToolActivity) lines.push(`    tool: ${a.latestToolActivity}`)
        if (a.latestFileActivity) lines.push(`    file: ${a.latestFileActivity}`)
      } else if (a.latestUserInstruction) {
        lines.push(`    user: ${a.latestUserInstruction}`)
      }
    }
    lines.push("")
  }

  if (snap.blockers.length > 0) {
    lines.push(`BLOCKERS (${snap.blockers.length}):`)
    for (const b of snap.blockers) lines.push(`  - ${b}`)
  }

  return lines.join("\n")
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const snap = await buildSnapshot(opts)
  if (opts.json) {
    console.log(JSON.stringify(snap, null, 2))
  } else {
    console.log(renderText(snap, opts))
  }
}

function isEntryPoint(): boolean {
  // Only run main() when this file is the script being executed,
  // not when it's imported (e.g. by operator-cycle.ts).
  const argv1 = process.argv[1] ?? ""
  return argv1.endsWith("operator-state.ts") || argv1.endsWith("operator-state.js")
}

if (isEntryPoint()) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.stack ?? err.message : err)
      process.exitCode = 1
    })
    .finally(async () => {
      await getPgPool().end().catch(() => undefined)
    })
}

export { buildSnapshot, type OperatorStateSnapshot }
