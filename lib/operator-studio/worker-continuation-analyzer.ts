import "server-only"

/**
 * Worker continuation detector — first heuristic pass.
 *
 * Walks live agent sessions (Claude/Codex JSONL + tmux panes), reads
 * a short tail, and emits *proposed* executive recommendations. No
 * sends, no launches — every output is advisory and lands in the
 * David-only inbox via `createExecutiveRecommendation`.
 *
 * Heuristics are deliberately conservative and transparent. Each
 * draft includes the matched signal name in `evidence` so David can
 * quickly assess whether the analyzer was right.
 */

import {
  getAppSessionTail,
  listAppSessions,
  type AppSlug,
  type AppStatus,
  type Turn,
} from "@/lib/server/agent-bridge/app-sessions"
import { captureTmuxPane, listTmuxSessions } from "@/lib/server/agent-bridge/tmux"
import type { AgentCompositeId } from "@/lib/server/agent-bridge/types"

import { getActivePlan } from "./plans"
import type { OperatorPlanStep, OperatorSessionPlan } from "./types"
import {
  createExecutiveRecommendation,
  type CreateExecutiveRecommendationInput,
  type ExecutiveRecommendation,
} from "./executive-recommendations"

const STALE_IDLE_MS = 5 * 60_000 // 5min idle → consider stale

/** Patterns that suggest the worker is asking for a generic continue. */
const NEEDS_INSTRUCTION_RE =
  /\b(?:waiting (?:for|on) (?:your |the )?(?:next )?(?:instruction|input|direction)|let me know (?:how|what|when)|what (?:would you like|do you want) (?:me )?to do|should i (?:continue|proceed|stop)|ready (?:for|to receive) (?:the )?next|standing by)\b/i

/** Patterns that suggest a blocker / error / ambiguity. */
const BLOCKER_RE =
  /\b(?:i (?:can(?:'|)t|cannot|am unable to|don'?t (?:have|know))|blocked|blocker|need(?:s)? clarification|ambiguous|not sure|unclear how|permission denied|access denied|missing (?:credentials?|env|config))\b/i

/** Patterns that suggest the worker reported a verification result. */
const VERIFY_RESULT_RE =
  /\b(?:typecheck (?:passes?|passed|clean|failed|errors?)|tests? (?:pass(?:ed)?|fail(?:ed)?|green|red)|build (?:succeeded|failed)|lint (?:clean|errors?)|all tests (?:pass|fail)|pnpm (?:typecheck|test|build))\b/i

/** Phrases the assistant uses when it thinks it's done. */
const COMPLETION_RE =
  /\b(?:all done|task complete(?:d)?|finished|ready for review|implementation (?:is )?complete|i'?ve (?:implemented|completed|finished|landed)|that should do it|wrapping up)\b/i

export interface ContinuationDraft {
  /** Maps 1:1 onto CreateExecutiveRecommendationInput. */
  input: CreateExecutiveRecommendationInput
  /** Stable per-agent dedupe key so re-running scan within the same
   *  bucket window updates instead of duplicating. Hour-bucketed. */
  scanKey: string
}

interface AgentTail {
  id: AgentCompositeId
  kind: "tmux" | "claude" | "codex"
  label: string
  project: string | null
  /** Most recent text we have from the agent — last few assistant
   *  turns concatenated for JSONL, last N pane lines for tmux. */
  text: string
  status: AppStatus
  ageMs: number
  pendingBytes: number
  /** Available for JSONL only. */
  turns?: Turn[]
}

function lastAssistantText(turns: Turn[]): string {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]
    if (t.role !== "assistant") continue
    const parts = t.parts
      .filter((p) => p.kind === "text" || p.kind === "thinking")
      .map((p) => ("text" in p ? p.text : ""))
      .filter(Boolean)
    if (parts.length > 0) return parts.join("\n").trim()
  }
  return ""
}

function lastTurnRole(turns: Turn[]): Turn["role"] | null {
  return turns[turns.length - 1]?.role ?? null
}

async function gatherAgents(limit = 6): Promise<AgentTail[]> {
  const out: AgentTail[] = []
  const now = Date.now()

  const [tmux, claude, codex] = await Promise.all([
    listTmuxSessions().catch(() => []),
    listAppSessions("claude", limit).catch(() => []),
    listAppSessions("codex", limit).catch(() => []),
  ])

  for (const t of tmux.slice(0, limit)) {
    const cap = await captureTmuxPane(t.name, 60).catch(() => null)
    if (!cap || "error" in cap) continue
    const trimmed = cap.content.split("\n").slice(-60).join("\n")
    const ageMs = Math.max(0, now - new Date(t.lastActivityAt).getTime())
    out.push({
      id: `tmux:${t.name}` as AgentCompositeId,
      kind: "tmux",
      label: t.name,
      project: t.command || null,
      text: trimmed,
      status: ageMs < 5000 ? "streaming" : "idle",
      ageMs,
      pendingBytes: 0,
    })
  }

  for (const app of ["claude", "codex"] as AppSlug[]) {
    const list = app === "claude" ? claude : codex
    for (const s of list.slice(0, limit)) {
      const tail = await getAppSessionTail(app, s.id, 30).catch(() => null)
      if (!tail || "error" in tail) continue
      const lastText = lastAssistantText(tail.turns)
      out.push({
        id: `${app}:${s.id}` as AgentCompositeId,
        kind: app,
        label: s.title?.slice(0, 80) ?? s.id.slice(0, 8),
        project: s.project,
        text: lastText,
        status: tail.status,
        ageMs: tail.mtimeAgeMs,
        pendingBytes: tail.pendingBytes,
        turns: tail.turns,
      })
    }
  }

  return out
}

function inMotionCards(plan: OperatorSessionPlan): OperatorPlanStep[] {
  return plan.steps.filter((s) => s.status === "in-motion")
}

/** Cheap text-overlap heuristic. Returns the best in-motion card for
 *  this agent, or null if nothing matches. We keep this conservative —
 *  if multiple cards match the same agent, the unmatched card is left
 *  for a future scan rather than over-attributing. */
function pickCardForAgent(
  agent: AgentTail,
  cards: OperatorPlanStep[]
): OperatorPlanStep | null {
  if (cards.length === 0) return null
  const haystack = `${agent.label ?? ""} ${agent.project ?? ""} ${agent.text.slice(0, 800)}`.toLowerCase()
  let best: { card: OperatorPlanStep; score: number } | null = null
  for (const c of cards) {
    const needle = c.title.toLowerCase()
    let score = 0
    if (haystack.includes(needle)) score += 5
    // Step-id mention is a strong signal — agents often paste card ids.
    if (haystack.includes(c.id.toLowerCase())) score += 8
    // Token overlap on words >= 5 chars.
    const tokens = needle.split(/\s+/).filter((t) => t.length >= 5)
    for (const tok of tokens) if (haystack.includes(tok)) score += 1
    if (score > 0 && (!best || score > best.score)) best = { card: c, score }
  }
  return best && best.score >= 3 ? best.card : null
}

function hourBucket(d = new Date()): string {
  const iso = d.toISOString()
  // YYYY-MM-DDTHH
  return iso.slice(0, 13)
}

function nudgeFromCard(card: OperatorPlanStep): string {
  const lines: string[] = []
  lines.push(
    `You're working on plan card ${card.id}: "${card.title}". The card is still in-motion in Operator Studio.`
  )
  if (card.description) {
    const body = card.description.trim().slice(0, 800)
    lines.push("")
    lines.push("Card body:")
    lines.push(body)
  }
  lines.push("")
  lines.push(
    "Resume from where you stopped. If acceptance is met, update the card status to covered via pnpm plan:card. If you hit a blocker, write a one-paragraph blocker note and stop."
  )
  return lines.join("\n")
}

function reviewSummary(card: OperatorPlanStep | null, agent: AgentTail): string {
  const head = card
    ? `Worker ${agent.id} appears to have produced a verification result on card ${card.id} ("${card.title}").`
    : `Worker ${agent.id} appears to have produced a verification result; no card matched.`
  const tail = agent.text.slice(-600).trim()
  return `${head}\n\nLast assistant excerpt:\n${tail || "(no text)"}`
}

function classifyAgent(
  agent: AgentTail,
  cards: OperatorPlanStep[]
): ContinuationDraft | null {
  const text = agent.text || ""
  if (!text) return null
  const card = pickCardForAgent(agent, cards)
  const lastRole = agent.turns ? lastTurnRole(agent.turns) : null

  // Active right now — don't propose anything.
  if (
    agent.status === "streaming" ||
    agent.status === "thinking" ||
    agent.status === "tool-running"
  )
    return null
  if (agent.pendingBytes > 0) return null
  // Recently active (under 30s) likely still in flight even if status
  // resolved to idle between turns. Wait it out.
  if (agent.ageMs < 30_000) return null
  // Skip if the last turn is a user/tool message — worker is mid-flow.
  if (agent.turns && (lastRole === "user" || lastRole === "tool")) return null

  const scanKey = `auto-scan/${agent.id}/${hourBucket()}`
  const baseTags = ["auto-scan", agent.kind]
  // Compact label for use in titles. JSONL session titles are pulled
  // from the first user turn and can run hundreds of chars.
  const shortLabel =
    agent.label && agent.label.length > 40
      ? agent.label.slice(0, 40) + "…"
      : (agent.label ?? agent.id)

  // Signal: blocker / error / ambiguity.
  if (BLOCKER_RE.test(text)) {
    return {
      scanKey,
      input: {
        title: `Review blocker on ${shortLabel}`,
        rationale: `Worker text matches blocker/ambiguity pattern. David should read the excerpt and decide whether to clarify, repoint, or update the card.`,
        kind: "request_review",
        workerKind: agent.kind,
        target: { agentId: agent.id, planStepId: card?.id ?? null },
        risk: "medium",
        riskNote:
          "Generic continue is unsafe — worker has flagged ambiguity or a blocker.",
        evidence: `signal=blocker; status=${agent.status}; ageMs=${agent.ageMs}; project=${agent.project ?? "?"}\nexcerpt:\n${text.slice(-500)}`,
        expectedOutput:
          "David response that resolves the blocker (clarification, scope cut, or repoint).",
        sourceId: scanKey,
        tags: [...baseTags, "blocker"],
      },
    }
  }

  // Signal: verification result reported (typecheck/test/build).
  if (VERIFY_RESULT_RE.test(text)) {
    return {
      scanKey,
      input: {
        title: card
          ? `Review verification result on "${card.title}"`
          : `Review verification result from ${shortLabel}`,
        rationale: `Worker reported a typecheck/test/build outcome. Likely a checkpoint where David should confirm whether the card is covered or needs another pass.`,
        kind: "request_review",
        workerKind: agent.kind,
        target: { agentId: agent.id, planStepId: card?.id ?? null },
        risk: "low",
        evidence: `signal=verify_result; status=${agent.status}; ageMs=${agent.ageMs}\n${reviewSummary(card, agent)}`,
        acceptanceCriteria: card
          ? `Card ${card.id} acceptance is met or a follow-up is queued.`
          : null,
        sourceId: scanKey,
        tags: [...baseTags, "verify"],
      },
    }
  }

  // Signal: completion claim with associated in-motion card → propose
  // mark_covered / update_plan, conservatively as request_review.
  if (COMPLETION_RE.test(text) && card) {
    return {
      scanKey,
      input: {
        title: `Mark covered? "${card.title}"`,
        rationale: `Worker on ${agent.id} appears to claim completion while card ${card.id} is still in-motion. Confirm acceptance, then mark covered with pnpm plan:card status.`,
        kind: "update_plan",
        workerKind: agent.kind,
        target: { agentId: agent.id, planStepId: card.id },
        prompt: `pnpm plan:card status --id=${card.id} --status=covered`,
        risk: "medium",
        riskNote:
          "Marking covered is reversible but visible. Verify the worker's claim against acceptance before approving.",
        evidence: `signal=completion_claim; ageMs=${agent.ageMs}\nexcerpt:\n${text.slice(-500)}`,
        expectedOutput: `${card.id} status=covered; or a request_review if acceptance is incomplete.`,
        sourceId: scanKey,
        tags: [...baseTags, "completion"],
      },
    }
  }

  // Signal: worker asked for next instruction.
  if (NEEDS_INSTRUCTION_RE.test(text)) {
    if (card) {
      return {
        scanKey,
        input: {
          title: `Continue ${shortLabel} on "${card.title}"`,
          rationale: `Worker asked for next instruction. Card ${card.id} is still in-motion and has enough context to resume without a generic continue.`,
          kind: "continue_worker",
          workerKind: agent.kind,
          target: { agentId: agent.id, planStepId: card.id },
          prompt: nudgeFromCard(card),
          risk: "high",
          riskNote:
            "Sending text to a live agent. Hot mode + David approval required.",
          evidence: `signal=needs_instruction; status=${agent.status}; ageMs=${agent.ageMs}\nexcerpt:\n${text.slice(-400)}`,
          expectedOutput: `Worker resumes ${card.id} or surfaces a specific blocker.`,
          acceptanceCriteria: card.description?.slice(0, 400) ?? null,
          sourceId: scanKey,
          tags: [...baseTags, "needs_instruction"],
        },
      }
    }
    // No matched card — generic continue is exactly what we want to
    // avoid. Tap David in instead.
    return {
      scanKey,
      input: {
        title: `Worker ${shortLabel} asked for next instruction (no card matched)`,
        rationale: `Worker stopped asking for direction. Analyzer could not match it to an in-motion card; David should decide whether to repoint or close out.`,
        kind: "request_review",
        workerKind: agent.kind,
        target: { agentId: agent.id, planStepId: null },
        risk: "medium",
        evidence: `signal=needs_instruction_no_card; ageMs=${agent.ageMs}\nexcerpt:\n${text.slice(-400)}`,
        sourceId: scanKey,
        tags: [...baseTags, "needs_instruction", "unmatched"],
      },
    }
  }

  // Signal: stale idle while a card is in-motion + assistant turn was
  // the last thing on the wire. Conservative — only fires when we
  // have a confident card match, so we can produce a real nudge.
  if (
    agent.status === "idle" &&
    agent.ageMs >= STALE_IDLE_MS &&
    card &&
    (lastRole === "assistant" || agent.kind === "tmux")
  ) {
    return {
      scanKey,
      input: {
        title: `Stale worker on "${card.title}"`,
        rationale: `Worker has been idle for ${Math.round(agent.ageMs / 60000)} min while card ${card.id} remains in-motion. Resume with the card-specific nudge or tap David in if scope shifted.`,
        kind: "continue_worker",
        workerKind: agent.kind,
        target: { agentId: agent.id, planStepId: card.id },
        prompt: nudgeFromCard(card),
        risk: "high",
        riskNote:
          "Sending text to a live agent. Hot mode + David approval required.",
        evidence: `signal=stale_idle; ageMs=${agent.ageMs}; status=${agent.status}`,
        expectedOutput: `Worker resumes ${card.id} or surfaces a specific blocker.`,
        sourceId: scanKey,
        tags: [...baseTags, "stale"],
      },
    }
  }

  return null
}

export interface ScanResult {
  scannedAgents: number
  inMotionCards: number
  drafts: ContinuationDraft[]
}

export async function analyzeWorkers(
  workspaceId: string,
  reviewer: string
): Promise<ScanResult> {
  const [plan, agents] = await Promise.all([
    getActivePlan(workspaceId, null, reviewer).catch(
      () => null as OperatorSessionPlan | null
    ),
    gatherAgents(),
  ])
  const cards = plan ? inMotionCards(plan) : []
  const drafts: ContinuationDraft[] = []
  for (const agent of agents) {
    const draft = classifyAgent(agent, cards)
    if (draft) drafts.push(draft)
  }
  return {
    scannedAgents: agents.length,
    inMotionCards: cards.length,
    drafts,
  }
}

export async function persistScanDrafts(
  workspaceId: string,
  drafts: ContinuationDraft[]
): Promise<ExecutiveRecommendation[]> {
  const out: ExecutiveRecommendation[] = []
  for (const d of drafts) {
    const rec = await createExecutiveRecommendation(workspaceId, d.input)
    out.push(rec)
  }
  return out
}
