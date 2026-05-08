import "server-only"

import { and, desc, eq } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import { operatorContinuums } from "@/lib/server/db/schema"

import {
  ensureSessionsForWorkspace,
  getFulfillmentsForSession,
  getSessionsForWorkspace,
  getThreadById,
  getThreadMessages,
  getThreadsInSession,
} from "@/lib/operator-studio/queries"
import { getActivePlan } from "@/lib/operator-studio/plans"
import { findSessionForTimestamp } from "@/lib/operator-studio/sessions"
import { extractGoldCandidates } from "@/lib/operator-studio/gold-extractor"
import { extractDecisions } from "@/lib/operator-studio/decision-extractor"
import { getLatestEnrichmentForThreadByContractPrefix } from "@/lib/operator-studio/wayseer/queries"
import type { ThreadRollup } from "@/lib/operator-studio/wayseer/contracts/thread-rollup"
import type {
  OperatorThread,
  OperatorThreadMessage,
  OperatorSessionPlan,
  OperatorPlanStep,
  OperatorStepFulfillment,
} from "@/lib/operator-studio/types"

/**
 * Continuum — fresh-agent handoff for stalled threads.
 *
 * v2 digest is a strict superset of v1: every v1 field is still
 * present, but the prompt-builder reads from the richer v2 fields
 * (active plan snapshot, multi-pick operator framings, decision
 * moments, sibling threads, agent spin-up hints) when they're
 * populated. Older v1 rows in the DB still render — the UI checks
 * `digest.kind` and falls back to the v1 layout.
 *
 * No LLM. Step 6 of the Continuum plan layers an LLM-drafted resume
 * prompt on top.
 */

// ─── Digest shape ──────────────────────────────────────────────────────────

interface ContinuumDigestSource {
  threadId: string
  title: string
  sourceApp: string
  turnCount: number
  lastTurnAt: string | null
  minutesSinceLastTurn: number | null
}

interface OperatorFraming {
  excerpt: string
  turnIndex: number
  /** Why this turn was picked: earliest coherent framing, highest-
   *  scored direction overall, or the most recent. */
  label: "earliest framing" | "best-scored direction" | "most recent"
  score: number
}

interface ContinuumDecision {
  excerpt: string
  turnIndex: number
  trigger: string
  role: "user" | "assistant"
}

interface ActivePlanLane {
  /** Single uppercase letter — "A", "B", "C". null = unrouted steps. */
  letter: string | null
  openSteps: Array<{
    id: string
    n: number
    title: string
    description: string
  }>
  inMotionStep: { id: string; n: number; title: string } | null
  /** Coverage progress within the lane — covered count vs total. */
  coveredCount: number
  totalCount: number
}

interface ActivePlanSnapshot {
  id: string
  title: string
  goal: string | null
  outcome: string | null
  /** Pre-computed lane the source thread belongs to (via fulfillment
   *  attribution) — null when no signal. The fresh agent uses this to
   *  understand "you're in lane X" without re-deriving it. */
  sourceThreadLane: string | null
  lanes: ActivePlanLane[]
}

interface SiblingThread {
  threadId: string
  title: string
  sourceApp: string
  turnCount: number
  minutesAgo: number
}

interface SpinUpHint {
  lane: string
  stepId: string
  stepN: number
  stepTitle: string
  /** Heuristic prompt the operator can paste into a fresh CLI agent
   *  to start that lane's work. */
  suggestedPrompt: string
}

export interface ContinuumDigestV2 {
  kind: "heuristic-v2"
  version: 2
  source: ContinuumDigestSource

  // v1-compatible single picks (populated for back-compat with any UI
  // path that hasn't moved to the v2 arrays).
  lastUserDirection: { excerpt: string; turnIndex: number } | null
  lastAssistantMove: { excerpt: string; turnIndex: number } | null

  // v2 additions.
  operatorFramings: OperatorFraming[]
  decisions: ContinuumDecision[]
  activePlan: ActivePlanSnapshot | null
  siblingThreads: SiblingThread[]
  spinUpHints: SpinUpHint[]

  rollup: {
    headline: string
    needToKnow: string[]
    carryForward: string | null
  } | null
  breakGlassUrl: string
}

/** Legacy v1 — still in the DB for handoffs minted before v2 landed.
 *  Kept exported so the UI's discriminated union picks it up. */
export interface ContinuumDigestV1 {
  kind: "heuristic"
  version: 1
  source: ContinuumDigestSource
  lastUserDirection: { excerpt: string; turnIndex: number } | null
  lastAssistantMove: { excerpt: string; turnIndex: number } | null
  rollup: ContinuumDigestV2["rollup"]
  breakGlassUrl: string
}

export type ContinuumDigest = ContinuumDigestV1 | ContinuumDigestV2

// ─── Build entrypoint ──────────────────────────────────────────────────────

export interface BuildContinuumDigestInput {
  workspaceId: string
  threadId: string
  baseUrl?: string | null
}

export interface BuildContinuumDigestResult {
  digest: ContinuumDigestV2
  resumePrompt: string
}

const EXCERPT_CHARS = 320

export async function buildContinuumDigest(
  input: BuildContinuumDigestInput
): Promise<BuildContinuumDigestResult | null> {
  const thread = await getThreadById(input.workspaceId, input.threadId)
  if (!thread) return null

  const messages = await getThreadMessages(input.workspaceId, input.threadId)

  // Wayseer rollup if cached — surfaces headline + need-to-know + the
  // close-out beat as carry-forward. Optional.
  const rollupRow = await getLatestEnrichmentForThreadByContractPrefix<ThreadRollup>(
    input.workspaceId,
    input.threadId,
    "thread-rollup@"
  )
  const rollup =
    rollupRow && rollupRow.status === "completed" && rollupRow.resultPayload
      ? rollupRow.resultPayload
      : null

  // Active plan snapshot + the source-thread's lane (via fulfillment
  // attribution if any). Both are best-effort — failures fall through
  // to a null plan, and the digest still carries the rest.
  const planSnapshot = await buildActivePlanSnapshot(
    input.workspaceId,
    thread,
    messages
  ).catch(() => null)

  // Sibling threads + the bracketing session.
  const siblingThreads = await buildSiblingThreads(
    input.workspaceId,
    thread
  ).catch(() => [] as SiblingThread[])

  // Coherence-ranked framings + decisions.
  const operatorFramings = pickOperatorFramings(thread, messages)
  const decisions = pickDecisions(thread, messages)

  // Spin-up hints — for every lane in the plan that has open work AND
  // isn't the source thread's lane, suggest a fresh-agent prompt.
  const spinUpHints = planSnapshot ? buildSpinUpHints(planSnapshot) : []

  const digest = assembleDigest({
    thread,
    messages,
    rollup,
    activePlan: planSnapshot,
    siblingThreads,
    operatorFramings,
    decisions,
    spinUpHints,
    baseUrl: input.baseUrl ?? null,
  })
  const resumePrompt = renderResumePrompt(digest)
  return { digest, resumePrompt }
}

function assembleDigest(args: {
  thread: OperatorThread
  messages: OperatorThreadMessage[]
  rollup: ThreadRollup | null
  activePlan: ActivePlanSnapshot | null
  siblingThreads: SiblingThread[]
  operatorFramings: OperatorFraming[]
  decisions: ContinuumDecision[]
  spinUpHints: SpinUpHint[]
  baseUrl: string | null
}): ContinuumDigestV2 {
  const {
    thread,
    messages,
    rollup,
    activePlan,
    siblingThreads,
    operatorFramings,
    decisions,
    spinUpHints,
    baseUrl,
  } = args

  const title =
    thread.promotedTitle?.trim() ||
    thread.rawTitle?.trim() ||
    "untitled thread"

  const lastMessage = messages[messages.length - 1]
  const lastUser = [...messages].reverse().find((m) => m.role === "user")
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant")

  const minutesSinceLastTurn = lastMessage
    ? Math.max(
        0,
        Math.round(
          (Date.now() - new Date(lastMessage.createdAt).getTime()) / 60000
        )
      )
    : null

  const breakGlassPath = `/operator-studio/threads/${thread.id}`
  const breakGlassUrl = baseUrl
    ? `${baseUrl.replace(/\/+$/, "")}${breakGlassPath}`
    : breakGlassPath

  return {
    kind: "heuristic-v2",
    version: 2,
    source: {
      threadId: thread.id,
      title,
      sourceApp: thread.sourceApp,
      turnCount: thread.messageCount,
      lastTurnAt: lastMessage?.createdAt ?? null,
      minutesSinceLastTurn,
    },
    lastUserDirection: lastUser
      ? { excerpt: excerpt(lastUser.content), turnIndex: lastUser.turnIndex }
      : null,
    lastAssistantMove: lastAssistant
      ? {
          excerpt: excerpt(lastAssistant.content),
          turnIndex: lastAssistant.turnIndex,
        }
      : null,
    operatorFramings,
    decisions,
    activePlan,
    siblingThreads,
    spinUpHints,
    rollup: rollup
      ? {
          headline: rollup.headline,
          needToKnow: rollup.needToKnow.slice(0, 6),
          carryForward:
            rollup.beats.length > 0
              ? rollup.beats[rollup.beats.length - 1].summary
              : null,
        }
      : null,
    breakGlassUrl,
  }
}

// ─── Active plan snapshot + lane attribution ───────────────────────────────

/** Pull the workspace's pinned active plan and split steps into lanes
 *  by id-letter prefix (`step-B…` → "B"). Computes which lane the
 *  source thread belongs to via fulfillment attribution. */
async function buildActivePlanSnapshot(
  workspaceId: string,
  thread: OperatorThread,
  messages: OperatorThreadMessage[]
): Promise<ActivePlanSnapshot | null> {
  // Resolve the plan the same way the in-app sidebar does — pinned
  // wins, falling back to whatever's bound to the active session.
  const plan = await getActivePlan(workspaceId, null, "system").catch(
    () => null
  )
  if (!plan) return null

  // Source-thread lane via fulfillment: scan the active sessions and
  // their fulfillments for any row whose target points at this thread
  // or one of its messages. The lane of the matched step wins.
  const sourceThreadLane = await deriveSourceThreadLane(
    workspaceId,
    thread,
    messages,
    plan
  )

  return planToSnapshot(plan, sourceThreadLane)
}

function planToSnapshot(
  plan: OperatorSessionPlan,
  sourceThreadLane: string | null
): ActivePlanSnapshot {
  // Group steps by lane letter. Steps without a routable letter go
  // into the `null` bucket and aren't surfaced as spin-up targets.
  const byLane = new Map<string | null, OperatorPlanStep[]>()
  for (const step of plan.steps) {
    const letter = laneLetter(step.id)
    const arr = byLane.get(letter) ?? []
    arr.push(step)
    byLane.set(letter, arr)
  }
  // Stable lane ordering: A, B, C…, then null at the end.
  const sortedLetters = [...byLane.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a.localeCompare(b)
  })

  const lanes: ActivePlanLane[] = sortedLetters.map((letter) => {
    const steps = (byLane.get(letter) ?? []).slice().sort(
      (a, b) => a.order - b.order
    )
    const open = steps.filter(
      (s) => s.status === "open" || s.status === "in-motion"
    )
    const inMotion =
      steps.find((s) => s.status === "in-motion") ?? open[0] ?? null
    return {
      letter,
      openSteps: open.slice(0, 6).map((s) => ({
        id: s.id,
        n: s.order + 1,
        title: s.title,
        description: truncate(s.description ?? "", 280),
      })),
      inMotionStep: inMotion
        ? { id: inMotion.id, n: inMotion.order + 1, title: inMotion.title }
        : null,
      coveredCount: steps.filter((s) => s.status === "covered").length,
      totalCount: steps.length,
    }
  })

  return {
    id: plan.id,
    title: plan.title,
    goal: plan.goal,
    outcome: plan.outcome,
    sourceThreadLane,
    lanes,
  }
}

async function deriveSourceThreadLane(
  workspaceId: string,
  thread: OperatorThread,
  messages: OperatorThreadMessage[],
  plan: OperatorSessionPlan
): Promise<string | null> {
  // Strongest signal: a fulfillment in the bracketing session that
  // points at this thread or one of its messages. The lane of the
  // matched step wins.
  const lastMessage = messages[messages.length - 1]
  if (lastMessage) {
    await ensureSessionsForWorkspace(workspaceId).catch(() => undefined)
    const sessions = await getSessionsForWorkspace(workspaceId).catch(
      () => [] as Awaited<ReturnType<typeof getSessionsForWorkspace>>
    )
    const session = findSessionForTimestamp(sessions, lastMessage.createdAt)
    if (session) {
      const fulfillments = await getFulfillmentsForSession(
        workspaceId,
        session.id
      ).catch(() => [] as OperatorStepFulfillment[])
      if (fulfillments.length > 0) {
        const messageIds = new Set(messages.map((m) => m.id))
        const sorted = [...fulfillments].sort((a, b) =>
          b.promotedAt.localeCompare(a.promotedAt)
        )
        for (const f of sorted) {
          if (
            (f.targetType === "thread" && f.targetId === thread.id) ||
            (f.targetType === "message" && messageIds.has(f.targetId))
          ) {
            const step = plan.steps.find((s) => s.id === f.stepId)
            if (step) {
              const letter = laneLetter(step.id)
              if (letter) return letter
            }
          }
        }
      }
    }
  }

  // Fallback: title-based detection. The operator's lane convention
  // routinely shows up in promoted/raw thread titles ("lane F build
  // night", "Lane C — Justin Searcy"). Catches fresh threads that
  // haven't been fulfillment-attached yet, which is most of them.
  const titles = [thread.promotedTitle, thread.rawTitle].filter(
    (s): s is string => !!s && s.trim().length > 0
  )
  for (const title of titles) {
    const m = title.match(/\blane\s+([A-Za-z])\b/i)
    if (m) return m[1].toUpperCase()
  }
  return null
}

/** Pull the lane letter from a step id ("step-B-cont-3" → "B").
 *  Mirrors the regex in `app/2/v2/components/plan-view.tsx`. */
function laneLetter(stepId: string): string | null {
  const m = stepId.match(/^step-([A-Za-z])/)
  return m ? m[1].toUpperCase() : null
}

// ─── Operator framings + decisions ─────────────────────────────────────────

function pickOperatorFramings(
  thread: OperatorThread,
  messages: OperatorThreadMessage[]
): OperatorFraming[] {
  const userTurns = messages.filter((m) => m.role === "user")
  if (userTurns.length === 0) return []

  const candidates = extractGoldCandidates(
    userTurns.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      threadTitle:
        thread.promotedTitle ?? thread.rawTitle ?? null,
      role: "user" as const,
      content: m.content,
      turnIndex: m.turnIndex,
      createdAt: m.createdAt,
      threadTurnCount: thread.messageCount,
    })),
    { topN: 12, maxPerThread: 12, minScore: 2, excerptLength: 320 }
  )

  // Earliest framing — first candidate by turnIndex (the operator's
  // opening framing when the head was clear). Falls back to the first
  // user turn if the gold extractor returned nothing.
  const byTurn = [...candidates].sort((a, b) => a.turnIndex - b.turnIndex)
  const earliestCandidate = byTurn[0]
  const earliest: OperatorFraming | null = earliestCandidate
    ? {
        excerpt: earliestCandidate.excerpt,
        turnIndex: earliestCandidate.turnIndex,
        label: "earliest framing",
        score: earliestCandidate.score,
      }
    : userTurns[0]
      ? {
          excerpt: excerpt(userTurns[0].content),
          turnIndex: userTurns[0].turnIndex,
          label: "earliest framing",
          score: 0,
        }
      : null

  // Highest-scored direction — best by score, anywhere in the thread.
  const byScore = [...candidates].sort((a, b) => b.score - a.score)
  const bestCandidate = byScore[0]
  const best: OperatorFraming | null =
    bestCandidate && bestCandidate.turnIndex !== earliest?.turnIndex
      ? {
          excerpt: bestCandidate.excerpt,
          turnIndex: bestCandidate.turnIndex,
          label: "best-scored direction",
          score: bestCandidate.score,
        }
      : null

  // Most recent — last user turn, regardless of score. Always emit so
  // the fresh agent sees the tail too (even if it's the tired one).
  const lastUser = userTurns[userTurns.length - 1]
  const recent: OperatorFraming | null =
    lastUser &&
    lastUser.turnIndex !== earliest?.turnIndex &&
    lastUser.turnIndex !== best?.turnIndex
      ? {
          excerpt: excerpt(lastUser.content),
          turnIndex: lastUser.turnIndex,
          // Score this turn the same way the gold extractor does, if it
          // happens to be one of its picks; otherwise score=0.
          score:
            candidates.find((c) => c.turnIndex === lastUser.turnIndex)?.score ??
            0,
          label: "most recent",
        }
      : null

  return [earliest, best, recent].filter(
    (x): x is OperatorFraming => x !== null
  )
}

function pickDecisions(
  thread: OperatorThread,
  messages: OperatorThreadMessage[]
): ContinuumDecision[] {
  if (messages.length === 0) return []
  const decisions = extractDecisions(
    messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        threadId: m.threadId,
        threadTitle: thread.promotedTitle ?? thread.rawTitle ?? null,
        role: m.role as "user" | "assistant",
        content: m.content,
        turnIndex: m.turnIndex,
        createdAt: m.createdAt,
      })),
    { topN: 4 }
  )
  // Bias toward the most recent decisions — those are the live ones a
  // fresh agent should respect when picking up.
  return decisions
    .slice()
    .sort((a, b) => b.turnIndex - a.turnIndex)
    .slice(0, 3)
    .map((d) => ({
      excerpt: d.excerpt,
      turnIndex: d.turnIndex,
      trigger: d.trigger,
      role: d.role,
    }))
}

// ─── Sibling threads ───────────────────────────────────────────────────────

async function buildSiblingThreads(
  workspaceId: string,
  thread: OperatorThread
): Promise<SiblingThread[]> {
  // Bracketing session for the source thread — siblings are other
  // threads whose activity lives inside the same window.
  await ensureSessionsForWorkspace(workspaceId).catch(() => undefined)
  const sessions = await getSessionsForWorkspace(workspaceId).catch(
    () => [] as Awaited<ReturnType<typeof getSessionsForWorkspace>>
  )
  // Anchor on `updatedAt` so the most-recent activity drives the
  // session selection — works whether the thread is live or stale.
  const session = findSessionForTimestamp(sessions, thread.updatedAt)
  if (!session) return []

  const peers = await getThreadsInSession(workspaceId, session.id)
  const now = Date.now()
  return peers
    .filter((t) => t.id !== thread.id)
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 3)
    .map((t) => ({
      threadId: t.id,
      title:
        t.promotedTitle?.trim() ||
        t.rawTitle?.trim() ||
        "untitled thread",
      sourceApp: t.sourceApp,
      turnCount: t.messageCount,
      minutesAgo: Math.max(
        0,
        Math.round((now - new Date(t.updatedAt).getTime()) / 60000)
      ),
    }))
}

// ─── Spin-up hints ─────────────────────────────────────────────────────────

function buildSpinUpHints(plan: ActivePlanSnapshot): SpinUpHint[] {
  const hints: SpinUpHint[] = []
  for (const lane of plan.lanes) {
    if (!lane.letter) continue
    if (lane.letter === plan.sourceThreadLane) continue
    const target = lane.inMotionStep ?? lane.openSteps[0]
    if (!target) continue
    hints.push({
      lane: lane.letter,
      stepId: target.id,
      stepN: target.n,
      stepTitle: target.title,
      suggestedPrompt: `Kick off in Lane ${lane.letter}, step ${target.n}: ${target.title}. ${lane.openSteps[0]?.description ? `Context: ${lane.openSteps[0].description}` : ""}`.trim(),
    })
  }
  return hints
}

// ─── Resume prompt ─────────────────────────────────────────────────────────

function renderResumePrompt(digest: ContinuumDigestV2): string {
  const lines: string[] = []
  const {
    source,
    operatorFramings,
    decisions,
    activePlan,
    siblingThreads,
    spinUpHints,
    rollup,
    breakGlassUrl,
    lastAssistantMove,
  } = digest

  const ageHint =
    source.minutesSinceLastTurn === null
      ? ""
      : source.minutesSinceLastTurn < 1
        ? ", just touched"
        : source.minutesSinceLastTurn < 60
          ? `, last touched ${source.minutesSinceLastTurn}m ago`
          : `, last touched ${Math.round(source.minutesSinceLastTurn / 60)}h ago`

  lines.push(
    `I'm picking up work from a ${source.sourceApp} thread titled "${source.title}" (${source.turnCount} turn${source.turnCount === 1 ? "" : "s"}${ageHint}). I'm starting fresh with you instead of continuing in that thread.`
  )

  if (rollup?.headline) {
    lines.push("")
    lines.push(`The thread, in one line: ${rollup.headline}`)
  }

  // Active plan — what I need to get done.
  if (activePlan) {
    lines.push("")
    lines.push(`# Plan: ${activePlan.title}`)
    if (activePlan.goal) lines.push(`Goal: ${activePlan.goal}`)
    if (activePlan.outcome) lines.push(`Outcome: ${activePlan.outcome}`)
    if (activePlan.sourceThreadLane) {
      lines.push(`I was working in Lane ${activePlan.sourceThreadLane}.`)
    }
    for (const lane of activePlan.lanes) {
      if (!lane.letter) continue
      if (lane.openSteps.length === 0) continue
      lines.push("")
      const youHere = lane.letter === activePlan.sourceThreadLane ? " ← me" : ""
      lines.push(
        `Lane ${lane.letter} (${lane.coveredCount}/${lane.totalCount} covered)${youHere}:`
      )
      for (const s of lane.openSteps.slice(0, 5)) {
        const motion = lane.inMotionStep?.id === s.id ? " (in motion)" : ""
        lines.push(`- ${s.n}. ${s.title}${motion}`)
      }
    }
  }

  // Operator framings — when the head was clear vs when it wasn't.
  if (operatorFramings.length > 0) {
    lines.push("")
    lines.push("# What I said")
    for (const f of operatorFramings) {
      lines.push(`(${f.label}, turn ${f.turnIndex + 1}): "${f.excerpt}"`)
    }
  }

  // Decisions — the binding ones a fresh agent should respect.
  if (decisions.length > 0) {
    lines.push("")
    lines.push("# Decisions made in-thread")
    for (const d of decisions) {
      lines.push(
        `(turn ${d.turnIndex + 1}, ${d.role}, "${d.trigger}"): ${d.excerpt}`
      )
    }
  }

  if (lastAssistantMove) {
    lines.push("")
    lines.push(`The agent's last move was: "${lastAssistantMove.excerpt}"`)
  }

  // Sibling threads — what else is in flight.
  if (siblingThreads.length > 0) {
    lines.push("")
    lines.push("# Other threads in flight")
    for (const t of siblingThreads) {
      lines.push(
        `- "${t.title}" (${t.sourceApp}, ${t.turnCount} turns, ${t.minutesAgo}m ago)`
      )
    }
  }

  // Spin-up hints — agents to fan out to.
  if (spinUpHints.length > 0) {
    lines.push("")
    lines.push("# Other agents I might spin up next")
    for (const h of spinUpHints) {
      lines.push(`- Lane ${h.lane}, step ${h.stepN}: ${h.stepTitle}`)
    }
  }

  // Carry-forward (rollup-derived) bullets.
  if (rollup?.needToKnow && rollup.needToKnow.length > 0) {
    lines.push("")
    lines.push("# What carries forward")
    for (const item of rollup.needToKnow) lines.push(`- ${item}`)
  }
  if (rollup?.carryForward) {
    lines.push("")
    lines.push(`Where it left off: ${rollup.carryForward}`)
  }

  lines.push("")
  lines.push(
    `Source thread (break-glass when this digest isn't enough): ${breakGlassUrl}`
  )
  lines.push("")
  lines.push("Continue from here.")

  return lines.join("\n")
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function excerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim()
  if (flat.length <= EXCERPT_CHARS) return flat
  return flat.slice(0, EXCERPT_CHARS - 1).trimEnd() + "…"
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim()
  if (flat.length <= n) return flat
  return flat.slice(0, n - 1).trimEnd() + "…"
}

// ─── Persistence ───────────────────────────────────────────────────────────

export interface PersistedContinuum {
  id: string
  workspaceId: string
  sourceThreadId: string
  digest: ContinuumDigest
  resumePrompt: string
  status: "draft" | "published" | "consumed"
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface CreateContinuumInput extends BuildContinuumDigestInput {
  createdBy: string
  status?: "draft" | "published"
}

export async function createContinuum(
  input: CreateContinuumInput
): Promise<PersistedContinuum | null> {
  const built = await buildContinuumDigest(input)
  if (!built) return null

  const db = getDb()
  const now = new Date()
  const id = `cont-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`
  await db.insert(operatorContinuums).values({
    id,
    workspaceId: input.workspaceId,
    sourceThreadId: input.threadId,
    digestJson: built.digest as unknown as Record<string, unknown>,
    resumePrompt: built.resumePrompt,
    status: input.status ?? "published",
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  })

  return {
    id,
    workspaceId: input.workspaceId,
    sourceThreadId: input.threadId,
    digest: built.digest,
    resumePrompt: built.resumePrompt,
    status: input.status ?? "published",
    createdBy: input.createdBy,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export async function getContinuumById(
  workspaceId: string,
  id: string
): Promise<PersistedContinuum | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorContinuums)
    .where(
      and(
        eq(operatorContinuums.workspaceId, workspaceId),
        eq(operatorContinuums.id, id)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return rowToPersisted(row)
}

export async function getLatestContinuumForThread(
  workspaceId: string,
  threadId: string
): Promise<PersistedContinuum | null> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorContinuums)
    .where(
      and(
        eq(operatorContinuums.workspaceId, workspaceId),
        eq(operatorContinuums.sourceThreadId, threadId)
      )
    )
    .orderBy(desc(operatorContinuums.createdAt))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return rowToPersisted(row)
}

function rowToPersisted(
  row: typeof operatorContinuums.$inferSelect
): PersistedContinuum {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    sourceThreadId: row.sourceThreadId,
    digest: row.digestJson as unknown as ContinuumDigest,
    resumePrompt: row.resumePrompt,
    status: row.status as "draft" | "published" | "consumed",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
