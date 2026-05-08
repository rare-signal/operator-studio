/**
 * pnpm os:cycle — bounded executive cycle.
 *
 * Stages:
 *   1. Sense    — read fast operator state (same helper as os:state).
 *   2. Decide   — derive proposed actions from state + heuristics.
 *   3. Recommend — write/update executive recommendations (default).
 *   4. Gate     — consequential actions remain proposed → David approves.
 *   5. Act      — only safe, already-approved actions; not implemented
 *                 in this CLI pass (executions go through the existing
 *                 API/UI which enforces hot mode).
 *
 *   pnpm os:cycle --dry-run        # print proposed actions, no writes
 *   pnpm os:cycle                  # write/update recommendations
 *   pnpm os:cycle --json           # machine-readable
 *   pnpm os:cycle --workspace=ID   # default: global
 *   pnpm os:cycle --policy         # print autonomy policy ladder
 *
 * Race handling: writes are dedupe-keyed via `sourceId =
 * "os:cycle:<deterministic-key>"` so re-running the cycle updates the
 * same row instead of flooding the inbox.
 */

import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import {
  AUTONOMY_ACTIONS,
  describeAutonomyPolicy,
  gateRecommendation,
  actionIdForRecommendationKind,
} from "../lib/operator-studio/autonomy-policy"
import {
  createExecutiveRecommendation,
  listExecutiveRecommendations,
  type ExecutiveRecommendation,
  type ExecutiveRecommendationKind,
  type ExecutiveRecommendationRisk,
} from "../lib/operator-studio/executive-recommendations"
import { buildSnapshot, type OperatorStateSnapshot } from "./operator-state"
import { getPgPool } from "../lib/server/db/client"

interface Options {
  workspaceId: string
  dryRun: boolean
  json: boolean
  policy: boolean
  /** Default false. When true, parent/orchestration cards (kids>0)
   *  are eligible for "no active agent" / "stale" heuristics. */
  includeParents: boolean
  /** Cards updated more recently than this are skipped from
   *  "no agent" nags. Default 15 minutes. */
  freshnessSkipMs: number
}

interface ProposedAction {
  /** Stable dedupe key. Reused as `sourceId` so re-runs update in place. */
  sourceId: string
  kind: ExecutiveRecommendationKind
  title: string
  rationale: string
  risk: ExecutiveRecommendationRisk
  planStepId: string | null
  agentId: string | null
  prompt: string | null
  acceptanceCriteria: string | null
  riskNote: string | null
  /** Tier from the autonomy policy ladder. */
  autonomyTier: string
  autonomyAction: string
  /** True if an open recommendation already covers this action. */
  alreadyOpen: boolean
  /** Existing recommendation id if `alreadyOpen`. */
  existingId: string | null
  /** Existing recommendation status if `alreadyOpen`. */
  existingStatus: string | null
  /** Result of the policy gate against the existing recommendation
   *  (only meaningful if alreadyOpen). */
  gateNote: string | null
  evidence: string
}

interface SkippedCard {
  cardId: string
  reason: string
  detail: string
}

interface CycleReport {
  fetchedAt: string
  workspaceId: string
  dryRun: boolean
  tookMs: number
  snapshotMs: number
  proposed: ProposedAction[]
  /** Cards we considered but deliberately did not propose actions for
   *  (parent cards, recently-updated cards, etc.). */
  skippedCards: SkippedCard[]
  skippedCardsByReason: Record<string, number>
  written: Array<{
    sourceId: string
    id: string
    kind: ExecutiveRecommendationKind
    title: string
  }>
  skipped: Array<{ sourceId: string; reason: string }>
}

const STALE_INMOTION_MS = 1000 * 60 * 60 * 2 // 2h with no agent → propose nudge
const STALE_AGENT_MS = 1000 * 60 * 30 // 30m without activity → propose nudge
const DEFAULT_FRESHNESS_SKIP_MS = 1000 * 60 * 15 // 15m: skip nag for fresh cards

/** Phrases in agent tail text that suggest the work on a card is
 *  done — used by the done-signal heuristic to upgrade a generic
 *  "in-motion without active agent" suggestion into a concrete
 *  mark_covered proposal. Matched case-insensitively. Keep this list
 *  conservative; false positives push David toward closing cards
 *  prematurely. */
const DONE_SIGNAL_PHRASES = [
  "typecheck passes",
  "typecheck passed",
  "tests pass",
  "tests passed",
  "all tests green",
  "shipped",
  "card landed",
  "card updated",
  "marked covered",
  "ready for review",
  "ready to mark covered",
  "done.",
  "done!",
  "done :)",
  "implementation complete",
  "feature complete",
]

/** Phrases that strongly suggest active implementation work on a leaf
 *  card. Used to bias "is this card actionable?" when a description
 *  doesn't otherwise look concrete. */
const ACTIONABLE_DESCRIPTION_PHRASES = [
  "acceptance:",
  "acceptance criteria",
  "implementation:",
  "implementation notes",
  "stage 1",
  "stage 2",
  "todo",
  "todos:",
  "command:",
  "build ",
  "add a",
  "add the",
  "wire up",
  "verify",
  "test plan",
]

function lc(s: string | null | undefined): string {
  return (s ?? "").toLowerCase()
}

function matchesAny(text: string, phrases: string[]): string | null {
  for (const p of phrases) {
    if (text.includes(p)) return p
  }
  return null
}

interface CardActionableHints {
  isParent: boolean
  hasOpenChildren: boolean
  isLeafByLackOfChildren: boolean
  hasActionableLanguage: boolean
  hasOpenRecommendation: boolean
  /** Final verdict — true if heuristics agree the card is actionable
   *  (a worker could pick it up). */
  isActionable: boolean
  /** Short reason for telemetry/logging. */
  reason: string
}

function classifyCard(
  card: { isParent: boolean; openChildCount: number; descriptionPreview: string | null; title: string },
  hasOpenRec: boolean
): CardActionableHints {
  const text = `${lc(card.title)} ${lc(card.descriptionPreview)}`
  const hasActionableLanguage = matchesAny(text, ACTIONABLE_DESCRIPTION_PHRASES) !== null
  const isLeafByLackOfChildren = !card.isParent
  const hasOpenChildren = card.openChildCount > 0
  let isActionable = false
  let reason = ""
  if (isLeafByLackOfChildren) {
    isActionable = true
    reason = "leaf (no children)"
  } else if (hasOpenRec) {
    isActionable = true
    reason = "parent with existing executive recommendation"
  } else if (!hasOpenChildren && hasActionableLanguage) {
    // All children done but parent still in-motion + actionable
    // language → treat as actionable (likely "wrap up" work).
    isActionable = true
    reason = "parent with no open children and actionable language"
  } else {
    isActionable = false
    reason = card.isParent
      ? `parent/orchestration card (${card.openChildCount} open children)`
      : "no actionable signals"
  }
  return {
    isParent: card.isParent,
    hasOpenChildren,
    isLeafByLackOfChildren,
    hasActionableLanguage,
    hasOpenRecommendation: hasOpenRec,
    isActionable,
    reason,
  }
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    workspaceId: GLOBAL_WORKSPACE_ID,
    dryRun: false,
    json: false,
    policy: false,
    includeParents: false,
    freshnessSkipMs: DEFAULT_FRESHNESS_SKIP_MS,
  }
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true
    else if (arg === "--json") opts.json = true
    else if (arg === "--policy") opts.policy = true
    else if (arg === "--include-parents") opts.includeParents = true
    else if (arg.startsWith("--freshness-skip-ms=")) {
      const n = Number(arg.slice("--freshness-skip-ms=".length))
      if (Number.isFinite(n) && n >= 0) opts.freshnessSkipMs = n
    } else if (arg.startsWith("--workspace=")) opts.workspaceId = arg.slice("--workspace=".length)
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
      "usage: pnpm os:cycle [flags]",
      "",
      "flags:",
      "  --dry-run                 print proposed actions; no writes",
      "  --json                    machine-readable output",
      "  --policy                  print the autonomy policy ladder and exit",
      "  --include-parents         include parent/orchestration cards in heuristics",
      "  --freshness-skip-ms=MS    skip nag for cards updated within MS (default 900000 = 15m)",
      "  --workspace=ID            default: global",
    ].join("\n")
  )
}

function fmtAge(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h`
  return `${Math.round(h / 24)}d`
}

interface DecisionResult {
  proposed: ProposedAction[]
  skippedCards: SkippedCard[]
}

function decideActions(
  snap: OperatorStateSnapshot,
  existing: ExecutiveRecommendation[],
  opts: Pick<Options, "includeParents" | "freshnessSkipMs">
): DecisionResult {
  const proposed: ProposedAction[] = []
  const skippedCards: SkippedCard[] = []

  // Index existing open recommendations by sourceId for dedupe.
  // We can't read sourceId from the recommendation summary directly,
  // so we use title as a fallback dedupe in addition to the
  // sourceId-based upsert in createExecutiveRecommendation.
  const openRecs = existing.filter(
    (r) => r.payload.status === "proposed" || r.payload.status === "approved"
  )
  const recsByCard = new Map<string, ExecutiveRecommendation[]>()
  for (const r of openRecs) {
    const id = r.payload.target.planStepId
    if (!id) continue
    const list = recsByCard.get(id) ?? []
    list.push(r)
    recsByCard.set(id, list)
  }
  const recsByAgent = new Map<string, ExecutiveRecommendation[]>()
  for (const r of openRecs) {
    const id = r.payload.target.agentId
    if (!id) continue
    const list = recsByAgent.get(id) ?? []
    list.push(r)
    recsByAgent.set(id, list)
  }

  function annotate(
    base: Omit<
      ProposedAction,
      "alreadyOpen" | "existingId" | "existingStatus" | "gateNote" | "autonomyTier" | "autonomyAction"
    >,
    matchKey: { card?: string | null; agent?: string | null; kind: ExecutiveRecommendationKind }
  ): ProposedAction {
    const candidates: ExecutiveRecommendation[] = []
    if (matchKey.card) candidates.push(...(recsByCard.get(matchKey.card) ?? []))
    if (matchKey.agent) candidates.push(...(recsByAgent.get(matchKey.agent) ?? []))
    const match = candidates.find((r) => r.payload.kind === matchKey.kind) ?? null
    const actionId = actionIdForRecommendationKind(base.kind)
    const action = AUTONOMY_ACTIONS[actionId]
    let gateNote: string | null = null
    if (match) {
      const gate = gateRecommendation({ recommendation: match })
      gateNote = gate.ok
        ? `gate: ok (${gate.tier})`
        : `gate: ${gate.tier} → ${gate.reason}`
    }
    return {
      ...base,
      alreadyOpen: Boolean(match),
      existingId: match?.id ?? null,
      existingStatus: match?.payload.status ?? null,
      autonomyTier: action.tier,
      autonomyAction: action.id,
      gateNote,
    }
  }

  // 1) For each in-motion card, classify and (if actionable) decide.
  if (snap.plan) {
    const liveAgentByCard = new Map<string, (typeof snap.recentAgents)[number]>()
    for (const a of snap.recentAgents) {
      if (a.detectedPlanCardId && a.isLive) {
        liveAgentByCard.set(a.detectedPlanCardId, a)
      }
    }

    for (const card of snap.cards.inMotion) {
      const onCard = snap.recentAgents.find(
        (a) => a.detectedPlanCardId === card.id
      )
      const hasOpenRec = (recsByCard.get(card.id) ?? []).length > 0
      const klass = classifyCard(card, hasOpenRec)

      // Done-signal heuristic: if any agent that mentions this card is
      // emitting "done" / "shipped" language in their tail, prefer a
      // mark_covered proposal regardless of parent/leaf classification.
      // Done signals cut through "is this actionable?" — if work just
      // landed, the right next move is closeout, not a worker nudge.
      const doneAgent = onCard
        ? findDoneSignal(onCard, snap.recentAgents)
        : findDoneSignalForCard(card.id, snap.recentAgents)
      if (doneAgent) {
        proposed.push(
          annotate(
            {
              sourceId: `os:cycle:done-signal:${card.id}`,
              kind: "mark_covered",
              title: `Card likely done — propose closeout: ${card.title}`,
              rationale: `Agent ${doneAgent.agent.agentId} emitted a done signal ("${doneAgent.phrase}") referencing card ${card.id}. Closeout is approval-required; David ratifies the evidence.`,
              risk: "medium",
              planStepId: card.id,
              agentId: doneAgent.agent.agentId,
              prompt: null,
              acceptanceCriteria: [
                `Verify the done signal: read the latest tail of ${doneAgent.agent.agentId}.`,
                `Confirm artifacts for card ${card.id} land where expected (code/files/PR).`,
                `If verified, mark covered. Otherwise reject with a why-note.`,
              ].join(" "),
              riskNote:
                "Done-signal heuristic is best-effort. Always verify before flipping status.",
              evidence: `os:cycle scan @ ${snap.fetchedAt}: agent ${doneAgent.agent.agentId} tail matched "${doneAgent.phrase}" near card ${card.id}`,
            },
            { card: card.id, kind: "mark_covered" }
          )
        )
        continue
      }

      // Skip parents from "no active agent" / "stale" nags by default.
      if (!opts.includeParents && klass.isParent && !klass.isActionable) {
        skippedCards.push({
          cardId: card.id,
          reason: "parent-card",
          detail: klass.reason,
        })
        continue
      }

      // Freshness dampening: card was just touched → skip nag.
      if (
        card.updatedAtAgeMs !== null &&
        card.updatedAtAgeMs < opts.freshnessSkipMs
      ) {
        skippedCards.push({
          cardId: card.id,
          reason: "fresh-card",
          detail: `updated ${fmtAge(card.updatedAtAgeMs)} ago (< ${fmtAge(opts.freshnessSkipMs)} threshold)`,
        })
        continue
      }

      if (!klass.isActionable) {
        skippedCards.push({
          cardId: card.id,
          reason: "not-actionable",
          detail: klass.reason,
        })
        continue
      }

      // Agent associated but stale (no activity for >30m).
      if (onCard && onCard.ageMs > STALE_AGENT_MS) {
        proposed.push(
          annotate(
            {
              sourceId: `os:cycle:stale-agent:${card.id}:${onCard.agentId}`,
              kind: "continue_worker",
              title: `Nudge stale worker on ${card.title}`,
              rationale: `Worker ${onCard.agentId} on card ${card.id} has been idle for ${fmtAge(onCard.ageMs)}. Card was last updated ${card.updatedAtAgeMs !== null ? fmtAge(card.updatedAtAgeMs) + " ago" : "(no timestamp)"}. Propose a continuation nudge.`,
              risk: "high",
              planStepId: card.id,
              agentId: onCard.agentId,
              prompt:
                `You're on plan card ${card.id} (${card.title}). Last activity was ${fmtAge(onCard.ageMs)} ago. Summarize what's done, what remains, and what's blocking — then either continue or surface a concrete decision request to David.`,
              acceptanceCriteria:
                "Worker either makes visible progress, hits a clean stopping point, or surfaces a concrete blocker. Update the recommendation with executionNote when sent.",
              riskNote:
                "continue_worker is high-risk: it sends text into a live agent. Only execute when hot mode is armed.",
              evidence: `os:cycle scan @ ${snap.fetchedAt}: agent ${onCard.agentId} idle for ${fmtAge(onCard.ageMs)} on card ${card.id} (leaf=${klass.isLeafByLackOfChildren}, actionable-language=${klass.hasActionableLanguage})`,
            },
            { card: card.id, agent: onCard.agentId, kind: "continue_worker" }
          )
        )
        continue
      }

      // No live agent on a leaf actionable card → propose review with
      // explicit relaunch / rescope / close criteria.
      if (!onCard) {
        const ageHint =
          card.updatedAtAgeMs !== null
            ? `Card last updated ${fmtAge(card.updatedAtAgeMs)} ago.`
            : "Card has no recorded updatedAt."
        proposed.push(
          annotate(
            {
              sourceId: `os:cycle:in-motion-without-agent:${card.id}`,
              kind: "request_review",
              title: `Leaf card in-motion without an active agent: ${card.title}`,
              rationale: `Card ${card.id} is a ${klass.reason} marked in-motion, and no live agent is scoped to it. ${ageHint}`,
              risk: "low",
              planStepId: card.id,
              agentId: null,
              prompt: null,
              acceptanceCriteria: [
                `Pick one:`,
                `(a) Approve a launch_worker recommendation for ${card.id} with a concrete prompt + acceptance criteria.`,
                `(b) Demote to open and split into smaller scoped cards.`,
                `(c) Mark covered if artifacts already exist (note where).`,
                `(d) Skip with a why-note.`,
              ].join(" "),
              riskNote: null,
              evidence: `os:cycle scan @ ${snap.fetchedAt}: leaf in-motion ${card.id}, no agent match (classification: ${klass.reason})`,
            },
            { card: card.id, kind: "request_review" }
          )
        )
        continue
      }

      // Agent associated, idle (not live) but recent → wait it out.
      // Only escalate to long-stale review if the idle agent has been
      // quiet for >2h.
      if (!liveAgentByCard.has(card.id) && onCard.ageMs > STALE_INMOTION_MS) {
        proposed.push(
          annotate(
            {
              sourceId: `os:cycle:long-stale-inmotion:${card.id}`,
              kind: "request_review",
              title: `Long-stale in-motion leaf: ${card.title}`,
              rationale: `Card ${card.id} has been in-motion with no live agent for ${fmtAge(onCard.ageMs)}. Likely needs re-scoping or relaunch.`,
              risk: "low",
              planStepId: card.id,
              agentId: null,
              prompt: null,
              acceptanceCriteria:
                "Decide: relaunch a worker (launch_worker), re-scope into smaller cards, or mark covered/skipped.",
              riskNote: null,
              evidence: `os:cycle scan @ ${snap.fetchedAt}: in-motion ${card.id}, last activity ${fmtAge(onCard.ageMs)} ago`,
            },
            { card: card.id, kind: "request_review" }
          )
        )
      }
    }
  }

  // 2) Surface already-approved launch_worker recommendations as
  //    ready-to-execute (no new write, just a pointer).
  for (const r of openRecs) {
    if (r.payload.kind === "launch_worker" && r.payload.status === "approved") {
      const cardId = r.payload.target.planStepId
      proposed.push(
        annotate(
          {
            sourceId: `os:cycle:approved-launch-pointer:${r.id}`,
            kind: "launch_worker",
            title: `Approved launch ready: ${r.title}`,
            rationale: `launch_worker recommendation ${r.id} is approved and ready to execute. Use the Operator Studio launch route (hot mode required).`,
            risk: "high",
            planStepId: cardId ?? null,
            agentId: null,
            prompt: r.payload.prompt ?? null,
            acceptanceCriteria: r.payload.acceptanceCriteria ?? null,
            riskNote:
              "Execution is approval-required and hot-mode-gated. CLI does not auto-launch.",
            evidence: `referenced existing rec ${r.id} (status=approved)`,
          },
          { card: cardId, kind: "launch_worker" }
        )
      )
    }
  }

  // 3) Surface approved continue_worker recommendations waiting to send.
  for (const r of openRecs) {
    if (r.payload.kind === "continue_worker" && r.payload.status === "approved") {
      proposed.push(
        annotate(
          {
            sourceId: `os:cycle:approved-continue-pointer:${r.id}`,
            kind: "continue_worker",
            title: `Approved continuation ready: ${r.title}`,
            rationale: `continue_worker recommendation ${r.id} is approved. Send via the Operator Studio agent send route (hot mode required).`,
            risk: "high",
            planStepId: r.payload.target.planStepId ?? null,
            agentId: r.payload.target.agentId ?? null,
            prompt: r.payload.prompt ?? null,
            acceptanceCriteria: r.payload.acceptanceCriteria ?? null,
            riskNote:
              "routine-after-approved: only execute when hot mode is armed and an approved recommendation exists.",
            evidence: `referenced existing rec ${r.id} (status=approved)`,
          },
          {
            card: r.payload.target.planStepId,
            agent: r.payload.target.agentId,
            kind: "continue_worker",
          }
        )
      )
    }
  }

  return { proposed, skippedCards }
}

interface DoneSignalMatch {
  agent: OperatorStateSnapshot["recentAgents"][number]
  phrase: string
}

function doneSignalForAgent(
  a: OperatorStateSnapshot["recentAgents"][number]
): string | null {
  const haystack = lc(
    [
      a.latestAssistantStatus ?? "",
      a.latestUserInstruction ?? "",
      a.latestToolActivity ?? "",
      a.latestFileActivity ?? "",
    ].join(" \n ")
  )
  return matchesAny(haystack, DONE_SIGNAL_PHRASES)
}

function findDoneSignal(
  primary: OperatorStateSnapshot["recentAgents"][number],
  _all: OperatorStateSnapshot["recentAgents"]
): DoneSignalMatch | null {
  const phrase = doneSignalForAgent(primary)
  return phrase ? { agent: primary, phrase } : null
}

function findDoneSignalForCard(
  cardId: string,
  all: OperatorStateSnapshot["recentAgents"]
): DoneSignalMatch | null {
  for (const a of all) {
    if (a.detectedPlanCardId !== cardId) continue
    const phrase = doneSignalForAgent(a)
    if (phrase) return { agent: a, phrase }
  }
  return null
}

async function runCycle(opts: Options): Promise<CycleReport> {
  const startedAt = Date.now()
  const snapStart = Date.now()
  const snap = await buildSnapshot({
    workspaceId: opts.workspaceId,
    json: false,
    compact: false,
    waiting: false,
    agentTail: false,
    completed: false,
  })
  const snapshotMs = Date.now() - snapStart
  const existing = await listExecutiveRecommendations(opts.workspaceId, {
    includeClosed: false,
    limit: 200,
  }).catch(() => [] as ExecutiveRecommendation[])

  const decision = decideActions(snap, existing, {
    includeParents: opts.includeParents,
    freshnessSkipMs: opts.freshnessSkipMs,
  })
  const proposed = decision.proposed

  const written: CycleReport["written"] = []
  const skipped: CycleReport["skipped"] = []

  if (!opts.dryRun) {
    for (const a of proposed) {
      // Don't recreate "pointer" actions whose only job is to remind
      // about an already-approved upstream recommendation.
      if (
        a.sourceId.startsWith("os:cycle:approved-launch-pointer:") ||
        a.sourceId.startsWith("os:cycle:approved-continue-pointer:")
      ) {
        skipped.push({ sourceId: a.sourceId, reason: "pointer-only; not persisted" })
        continue
      }
      // The cycle never executes consequential actions on its own.
      // Writing a fresh recommendation is itself safe-read-only-ish
      // (advisory until approved).
      try {
        const rec = await createExecutiveRecommendation(opts.workspaceId, {
          title: a.title,
          rationale: a.rationale,
          kind: a.kind,
          target: { planStepId: a.planStepId, agentId: a.agentId },
          prompt: a.prompt,
          acceptanceCriteria: a.acceptanceCriteria,
          riskNote: a.riskNote,
          risk: a.risk,
          evidence: a.evidence,
          sourceId: a.sourceId,
          tags: ["os:cycle", a.autonomyTier, a.autonomyAction],
        })
        written.push({
          sourceId: a.sourceId,
          id: rec.id,
          kind: rec.payload.kind,
          title: rec.title,
        })
      } catch (err) {
        skipped.push({
          sourceId: a.sourceId,
          reason: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  const skippedCardsByReason: Record<string, number> = {}
  for (const s of decision.skippedCards) {
    skippedCardsByReason[s.reason] = (skippedCardsByReason[s.reason] ?? 0) + 1
  }

  return {
    fetchedAt: snap.fetchedAt,
    workspaceId: opts.workspaceId,
    dryRun: opts.dryRun,
    tookMs: Date.now() - startedAt,
    snapshotMs,
    proposed,
    skippedCards: decision.skippedCards,
    skippedCardsByReason,
    written,
    skipped,
  }
}

function renderPolicy(): string {
  const lines: string[] = ["autonomy policy ladder:", ""]
  for (const tier of describeAutonomyPolicy()) {
    lines.push(`[${tier.tier}]`)
    for (const a of tier.actions) {
      lines.push(`  ${a.id}  — ${a.label}`)
      lines.push(`    why: ${a.reason}`)
    }
    lines.push("")
  }
  return lines.join("\n")
}

function renderText(report: CycleReport): string {
  const lines: string[] = []
  lines.push(
    `os:cycle · ${report.fetchedAt} · workspace=${report.workspaceId} · ${report.dryRun ? "DRY-RUN" : "WRITES"} · took ${report.tookMs}ms (snapshot ${report.snapshotMs}ms)`
  )
  lines.push("")
  if (report.proposed.length === 0) {
    lines.push("no proposed actions.")
  } else {
    lines.push(`PROPOSED ACTIONS (${report.proposed.length}):`)
    for (const a of report.proposed) {
      const dedupe = a.alreadyOpen
        ? `· already-open=${a.existingId} status=${a.existingStatus}`
        : "· new"
      lines.push(
        `  [${a.autonomyTier}] ${a.kind} · risk=${a.risk}  ${dedupe}`
      )
      lines.push(`    ${a.title}`)
      if (a.planStepId) lines.push(`    card: ${a.planStepId}`)
      if (a.agentId) lines.push(`    agent: ${a.agentId}`)
      lines.push(`    why: ${a.rationale}`)
      if (a.prompt) lines.push(`    prompt: ${a.prompt.slice(0, 200)}`)
      if (a.acceptanceCriteria)
        lines.push(`    accept: ${a.acceptanceCriteria.slice(0, 200)}`)
      if (a.gateNote) lines.push(`    ${a.gateNote}`)
    }
  }
  lines.push("")
  if (report.skippedCards.length > 0) {
    const reasons = Object.entries(report.skippedCardsByReason)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")
    lines.push(`SKIPPED CARDS (${report.skippedCards.length}): ${reasons}`)
    for (const s of report.skippedCards) {
      lines.push(`  · ${s.cardId}  (${s.reason}: ${s.detail})`)
    }
    lines.push("")
  }
  if (!report.dryRun) {
    lines.push(
      `WRITTEN: ${report.written.length}  SKIPPED: ${report.skipped.length}`
    )
    for (const w of report.written) {
      lines.push(`  + ${w.kind} ${w.id}  (sourceId=${w.sourceId})`)
    }
    for (const s of report.skipped) {
      lines.push(`  · skip ${s.sourceId}: ${s.reason}`)
    }
  } else {
    lines.push("(dry-run: no writes)")
  }
  return lines.join("\n")
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.policy) {
    console.log(renderPolicy())
    return
  }
  const report = await runCycle(opts)
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderText(report))
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end().catch(() => undefined)
  })
