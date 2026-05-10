import type { AgentKind } from "@/lib/server/agent-bridge/types"

export type LaunchWaveAgentSource =
  | "claude"
  | "codex"
  | "tmux"
  | "hermes"
  | "local"
  | "unknown"

export type LaunchWaveBindingSource =
  | "launch"
  | "manual"
  | "tail-sniff"
  | "scheduled"
  | "durable"
  | "attempt"

export type LaunchWaveStatus =
  | "active"
  | "pending"
  | "resolved"
  | "dismissed"
  | "seen"

export interface LaunchWavePlanStepInput {
  id: string
  n?: number | null
  title?: string | null
  status?: string | null
}

export interface LaunchWaveAgentInput {
  id: string
  kind?: AgentKind | LaunchWaveAgentSource | string | null
  source?: LaunchWaveAgentSource | string | null
  lastActivityAt?: string | null
  isLive?: boolean | null
}

export interface LaunchWaveRecentInput {
  agentId: string
  source?: LaunchWaveAgentSource | string | null
  kind?: AgentKind | LaunchWaveAgentSource | string | null
  lastActivityAt?: string | null
  isLive?: boolean | null
  detectedPlanCardId?: string | null
}

export interface LaunchWaveBindingInput {
  id: string
  agentId: string
  agentKind?: AgentKind | LaunchWaveAgentSource | string | null
  planStepId: string
  planId?: string | null
  source?: LaunchWaveBindingSource | string | null
  sourceRecommendationId?: string | null
  createdBy?: string | null
  createdAt: string
  updatedAt?: string | null
}

export interface LaunchWaveAttemptInput {
  id: string
  createdAt: string
  appKind?: "claude" | "codex" | string | null
  planStepId?: string | null
  sourceRecommendationId?: string | null
  resolvedAt?: string | null
  resolvedAgentId?: string | null
  status: "pending" | "resolved" | "dismissed" | string
}

export interface LaunchWaveBoundCard {
  planStepId: string
  planStepTitle: string | null
  planStepNumber: number | null
  planStepStatus: string | null
  bindingIds: string[]
  agentIds: string[]
  launchedAt: string | null
  lastSeenAt: string | null
  statuses: Record<LaunchWaveStatus, number>
}

export interface LaunchWaveSourceCount {
  source: LaunchWaveAgentSource
  count: number
  active: number
  pending: number
  lastSeenAt: string | null
}

export interface LaunchWaveKindCount {
  kind: LaunchWaveBindingSource
  count: number
}

export interface LaunchWaveSourceKindCount {
  source: LaunchWaveAgentSource
  kind: LaunchWaveBindingSource
  count: number
}

export interface LaunchWaveRecord {
  id: string
  fallbackGroupingKey: string
  sourceRecommendationId: string | null
  planId: string | null
  initiators: string[]
  launchedAt: string | null
  lastSeenAt: string | null
  sourceCounts: LaunchWaveSourceCount[]
  kindCounts: LaunchWaveKindCount[]
  sourceKindCounts: LaunchWaveSourceKindCount[]
  boundCards: LaunchWaveBoundCard[]
  statuses: Record<LaunchWaveStatus, number>
}

export interface LaunchWaveLedgerEmptyState {
  kind: "no-launches" | "no-recent-launches"
  title: string
  body: string
}

export interface LaunchWaveLedger {
  generatedAt: string
  windowStartsAt: string | null
  windowEndsAt: string
  waves: LaunchWaveRecord[]
  totals: {
    waves: number
    launches: number
    boundCards: number
    sourceCounts: LaunchWaveSourceCount[]
    kindCounts: LaunchWaveKindCount[]
  }
  emptyState: LaunchWaveLedgerEmptyState | null
}

export interface SummarizeLaunchWavesInput {
  bindings?: readonly LaunchWaveBindingInput[]
  agents?: readonly LaunchWaveAgentInput[]
  recent?: readonly LaunchWaveRecentInput[]
  launchAttempts?: readonly LaunchWaveAttemptInput[]
  planSteps?: readonly LaunchWavePlanStepInput[]
  now?: Date
  recentWindowMs?: number | null
}

interface LaunchFact {
  id: string
  agentId: string | null
  source: LaunchWaveAgentSource
  kind: LaunchWaveBindingSource
  planStepId: string | null
  planId: string | null
  sourceRecommendationId: string | null
  initiator: string | null
  launchedAt: string
  lastSeenAt: string | null
  status: LaunchWaveStatus
  bindingId: string | null
}

const DEFAULT_RECENT_WINDOW_MS = 48 * 60 * 60_000

const EMPTY_STATUSES: Record<LaunchWaveStatus, number> = {
  active: 0,
  pending: 0,
  resolved: 0,
  dismissed: 0,
  seen: 0,
}

export function summarizeLaunchWaves(
  input: SummarizeLaunchWavesInput
): LaunchWaveLedger {
  const now = input.now ?? new Date()
  const recentWindowMs = input.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS
  const windowStartsAt =
    recentWindowMs === null
      ? null
      : new Date(now.getTime() - recentWindowMs).toISOString()

  const agentById = new Map((input.agents ?? []).map((agent) => [agent.id, agent]))
  const recentByAgentId = new Map((input.recent ?? []).map((recent) => [recent.agentId, recent]))
  const stepById = new Map((input.planSteps ?? []).map((step) => [step.id, step]))

  const boundAgentIds = new Set((input.bindings ?? []).map((binding) => binding.agentId))
  const tailSniffFacts = (input.recent ?? [])
    .filter((recent) => recent.detectedPlanCardId && !boundAgentIds.has(recent.agentId))
    .map((recent) => recentToFact(recent, agentById))

  const allFacts: LaunchFact[] = [
    ...(input.bindings ?? []).map((binding) =>
      bindingToFact(binding, agentById, recentByAgentId)
    ),
    ...(input.launchAttempts ?? []).map((attempt) =>
      attemptToFact(attempt, agentById, recentByAgentId)
    ),
    ...tailSniffFacts,
  ]

  const facts = allFacts.filter((fact) => {
    if (recentWindowMs === null) return true
    return Date.parse(fact.launchedAt) >= now.getTime() - recentWindowMs
  })

  if (allFacts.length === 0 || facts.length === 0) {
    return {
      generatedAt: now.toISOString(),
      windowStartsAt,
      windowEndsAt: now.toISOString(),
      waves: [],
      totals: {
        waves: 0,
        launches: 0,
        boundCards: 0,
        sourceCounts: [],
        kindCounts: [],
      },
      emptyState:
        allFacts.length === 0
          ? {
              kind: "no-launches",
              title: "No launches recorded yet",
              body: "Launch a Claude, Codex, or tmux worker against a plan card to start the launch-wave ledger.",
            }
          : {
              kind: "no-recent-launches",
              title: "No launches in this window",
              body: "Widen the time window or launch a worker against a plan card to see landed lanes here.",
            },
    }
  }

  const waves = Array.from(groupFacts(facts).entries())
    .map(([fallbackGroupingKey, waveFacts]) =>
      factsToWave(fallbackGroupingKey, waveFacts, stepById)
    )
    .sort((a, b) => compareNullableIsoDesc(a.lastSeenAt, b.lastSeenAt))

  return {
    generatedAt: now.toISOString(),
    windowStartsAt,
    windowEndsAt: now.toISOString(),
    waves,
    totals: {
      waves: waves.length,
      launches: facts.length,
      boundCards: new Set(facts.map((fact) => fact.planStepId).filter(Boolean)).size,
      sourceCounts: countBySource(facts),
      kindCounts: countByKind(facts),
    },
    emptyState: null,
  }
}

function bindingToFact(
  binding: LaunchWaveBindingInput,
  agentById: Map<string, LaunchWaveAgentInput>,
  recentByAgentId: Map<string, LaunchWaveRecentInput>
): LaunchFact {
  const agent = agentById.get(binding.agentId)
  const recent = recentByAgentId.get(binding.agentId)
  const source = normalizeSource(recent?.source ?? agent?.source ?? binding.agentKind)
  const lastSeenAt =
    maxIso([recent?.lastActivityAt, agent?.lastActivityAt, binding.updatedAt]) ??
    binding.createdAt
  return {
    id: `binding:${binding.id}`,
    agentId: binding.agentId,
    source,
    kind: normalizeBindingSource(binding.source),
    planStepId: binding.planStepId,
    planId: binding.planId ?? null,
    sourceRecommendationId: binding.sourceRecommendationId ?? null,
    initiator: binding.createdBy ?? null,
    launchedAt: binding.createdAt,
    lastSeenAt,
    status: recent?.isLive || agent?.isLive ? "active" : "seen",
    bindingId: binding.id,
  }
}

function attemptToFact(
  attempt: LaunchWaveAttemptInput,
  agentById: Map<string, LaunchWaveAgentInput>,
  recentByAgentId: Map<string, LaunchWaveRecentInput>
): LaunchFact {
  const resolvedAgentId = attempt.resolvedAgentId ?? null
  const agent = resolvedAgentId ? agentById.get(resolvedAgentId) : null
  const recent = resolvedAgentId ? recentByAgentId.get(resolvedAgentId) : null
  const status = normalizeAttemptStatus(attempt.status)
  return {
    id: `attempt:${attempt.id}`,
    agentId: resolvedAgentId,
    source: normalizeSource(recent?.source ?? agent?.source ?? attempt.appKind),
    kind: "attempt",
    planStepId: attempt.planStepId ?? null,
    planId: null,
    sourceRecommendationId: attempt.sourceRecommendationId ?? null,
    initiator: null,
    launchedAt: attempt.createdAt,
    lastSeenAt: maxIso([attempt.resolvedAt, recent?.lastActivityAt, agent?.lastActivityAt]),
    status,
    bindingId: null,
  }
}

function recentToFact(
  recent: LaunchWaveRecentInput,
  agentById: Map<string, LaunchWaveAgentInput>
): LaunchFact {
  const agent = agentById.get(recent.agentId)
  const lastSeenAt = maxIso([recent.lastActivityAt, agent?.lastActivityAt])
  const launchedAt = lastSeenAt ?? new Date(0).toISOString()
  return {
    id: `tail-sniff:${recent.agentId}:${recent.detectedPlanCardId ?? "unbound"}`,
    agentId: recent.agentId,
    source: normalizeSource(recent.source ?? agent?.source ?? recent.kind ?? agent?.kind),
    kind: "tail-sniff",
    planStepId: recent.detectedPlanCardId ?? null,
    planId: null,
    sourceRecommendationId: null,
    initiator: null,
    launchedAt,
    lastSeenAt,
    status: recent.isLive || agent?.isLive ? "active" : "seen",
    bindingId: null,
  }
}

function groupFacts(facts: LaunchFact[]): Map<string, LaunchFact[]> {
  const groups = new Map<string, LaunchFact[]>()
  for (const fact of facts) {
    const key = groupingKey(fact)
    groups.set(key, [...(groups.get(key) ?? []), fact])
  }
  return groups
}

function factsToWave(
  fallbackGroupingKey: string,
  facts: LaunchFact[],
  stepById: Map<string, LaunchWavePlanStepInput>
): LaunchWaveRecord {
  const sourceRecommendationId =
    facts.find((fact) => fact.sourceRecommendationId)?.sourceRecommendationId ?? null
  const cards = factsToCards(facts, stepById)
  return {
    id: sourceRecommendationId ? `recommendation:${sourceRecommendationId}` : fallbackGroupingKey,
    fallbackGroupingKey,
    sourceRecommendationId,
    planId: facts.find((fact) => fact.planId)?.planId ?? null,
    initiators: uniqueSorted(facts.map((fact) => fact.initiator).filter(isString)),
    launchedAt: minIso(facts.map((fact) => fact.launchedAt)),
    lastSeenAt: maxIso(facts.map((fact) => fact.lastSeenAt ?? fact.launchedAt)),
    sourceCounts: countBySource(facts),
    kindCounts: countByKind(facts),
    sourceKindCounts: countBySourceKind(facts),
    boundCards: cards,
    statuses: countStatuses(facts),
  }
}

function factsToCards(
  facts: LaunchFact[],
  stepById: Map<string, LaunchWavePlanStepInput>
): LaunchWaveBoundCard[] {
  const byStep = new Map<string, LaunchFact[]>()
  for (const fact of facts) {
    if (!fact.planStepId) continue
    byStep.set(fact.planStepId, [...(byStep.get(fact.planStepId) ?? []), fact])
  }
  return Array.from(byStep.entries())
    .map(([planStepId, stepFacts]) => {
      const step = stepById.get(planStepId)
      return {
        planStepId,
        planStepTitle: step?.title ?? null,
        planStepNumber: step?.n ?? null,
        planStepStatus: step?.status ?? null,
        bindingIds: uniqueSorted(stepFacts.map((fact) => fact.bindingId).filter(isString)),
        agentIds: uniqueSorted(stepFacts.map((fact) => fact.agentId).filter(isString)),
        launchedAt: minIso(stepFacts.map((fact) => fact.launchedAt)),
        lastSeenAt: maxIso(stepFacts.map((fact) => fact.lastSeenAt ?? fact.launchedAt)),
        statuses: countStatuses(stepFacts),
      }
    })
    .sort((a, b) => (a.planStepNumber ?? Number.MAX_SAFE_INTEGER) - (b.planStepNumber ?? Number.MAX_SAFE_INTEGER))
}

function groupingKey(fact: LaunchFact): string {
  if (fact.sourceRecommendationId) return `recommendation:${fact.sourceRecommendationId}`
  const scope = fact.planId ?? fact.planStepId ?? "unscoped"
  return `fallback:${scope}:${fiveMinuteBucket(fact.launchedAt)}`
}

function fiveMinuteBucket(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return "unknown-time"
  return new Date(Math.floor(ms / 300_000) * 300_000).toISOString()
}

function normalizeSource(value: unknown): LaunchWaveAgentSource {
  if (
    value === "claude" ||
    value === "codex" ||
    value === "tmux" ||
    value === "hermes" ||
    value === "local"
  ) {
    return value
  }
  return "unknown"
}

function normalizeBindingSource(value: unknown): LaunchWaveBindingSource {
  if (
    value === "launch" ||
    value === "manual" ||
    value === "tail-sniff" ||
    value === "scheduled" ||
    value === "durable" ||
    value === "attempt"
  ) {
    return value
  }
  return "durable"
}

function normalizeAttemptStatus(value: unknown): LaunchWaveStatus {
  if (value === "pending" || value === "resolved" || value === "dismissed") {
    return value
  }
  return "pending"
}

function countBySource(facts: LaunchFact[]): LaunchWaveSourceCount[] {
  const counts = new Map<LaunchWaveAgentSource, LaunchWaveSourceCount>()
  for (const fact of facts) {
    const current =
      counts.get(fact.source) ?? {
        source: fact.source,
        count: 0,
        active: 0,
        pending: 0,
        lastSeenAt: null,
      }
    counts.set(fact.source, {
      ...current,
      count: current.count + 1,
      active: current.active + (fact.status === "active" ? 1 : 0),
      pending: current.pending + (fact.status === "pending" ? 1 : 0),
      lastSeenAt: maxIso([current.lastSeenAt, fact.lastSeenAt ?? fact.launchedAt]),
    })
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
}

function countByKind(facts: LaunchFact[]): LaunchWaveKindCount[] {
  const counts = new Map<LaunchWaveBindingSource, number>()
  for (const fact of facts) counts.set(fact.kind, (counts.get(fact.kind) ?? 0) + 1)
  return Array.from(counts.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

function countBySourceKind(facts: LaunchFact[]): LaunchWaveSourceKindCount[] {
  const counts = new Map<string, LaunchWaveSourceKindCount>()
  for (const fact of facts) {
    const key = `${fact.source}:${fact.kind}`
    const current = counts.get(key) ?? { source: fact.source, kind: fact.kind, count: 0 }
    counts.set(key, { ...current, count: current.count + 1 })
  }
  return Array.from(counts.values()).sort(
    (a, b) =>
      b.count - a.count ||
      a.source.localeCompare(b.source) ||
      a.kind.localeCompare(b.kind)
  )
}

function countStatuses(facts: LaunchFact[]): Record<LaunchWaveStatus, number> {
  const counts = { ...EMPTY_STATUSES }
  for (const fact of facts) counts[fact.status]++
  return counts
}

function minIso(values: Array<string | null | undefined>): string | null {
  const valid = values.filter(isString).sort()
  return valid[0] ?? null
}

function maxIso(values: Array<string | null | undefined>): string | null {
  const valid = values.filter(isString).sort()
  return valid.at(-1) ?? null
}

function compareNullableIsoDesc(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a)
  if (a) return -1
  if (b) return 1
  return 0
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort()
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}
