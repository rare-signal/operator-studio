/**
 * Marshal — per-lane field-commander agent tier between Berthier and
 * the spawned workers. See plan card `step-cockpit-marshal-tier`.
 *
 * Doctrine:
 *  - At most one active Marshal per lane.
 *  - Marshal cannot spawn workers, cannot approve outbound, cannot
 *    mutate plan_steps directly. Suggests via SITREP; David approves.
 *  - Every pass writes a `marshal_pass` event to the lane's artifact log.
 *  - Cost ceiling enforced in `tapMarshal` (default $5/day per Marshal).
 */

import "server-only"

import { and, eq, isNull, lte } from "drizzle-orm"

import { getDb } from "@/lib/server/db/client"
import {
  operatorMarshalConfig,
  operatorThreadCardBindings,
  operatorWorkLanes,
} from "@/lib/server/db/schema"
import { spawnAgent } from "@/lib/server/agent-bridge/surfaces"
import type { SurfaceKind } from "@/lib/server/agent-bridge/surfaces"
import { parseAgentId } from "@/lib/server/agent-bridge/types"
import { getAppSessionTail, type AppSlug } from "@/lib/server/agent-bridge/app-sessions"
import { resolveLaneCard } from "./work-lane-tasks"
import { writeLaneCardEvent } from "./work-lane-events"

export type MarshalProfile = "manual" | "auto-ai"

export interface MarshalConfig {
  agentId: string
  laneId: string
  profile: MarshalProfile
  rubric: string | null
  intervalMinutes: number | null
  lastPassAt: string | null
  nextPassAt: string | null
  costCeilingUsdPerDay: number
  costSpentUsdToday: number
  costWindowStartedAt: string | null
  createdAt: string
}

export interface MarshalBindingWithConfig {
  agentId: string
  agentKind: string
  laneId: string
  workspaceId: string
  spawnedAt: string
  config: MarshalConfig
}

function rowToConfig(row: typeof operatorMarshalConfig.$inferSelect): MarshalConfig {
  return {
    agentId: row.agentId,
    laneId: row.laneId,
    profile: row.profile as MarshalProfile,
    rubric: row.rubric,
    intervalMinutes: row.intervalMinutes,
    lastPassAt: row.lastPassAt?.toISOString() ?? null,
    nextPassAt: row.nextPassAt?.toISOString() ?? null,
    costCeilingUsdPerDay: Number(row.costCeilingUsdPerDay),
    costSpentUsdToday: Number(row.costSpentUsdToday),
    costWindowStartedAt: row.costWindowStartedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export class MarshalAlreadyExistsError extends Error {
  constructor(public existingAgentId: string) {
    super(`lane already has an active Marshal: ${existingAgentId}`)
  }
}

export class MarshalCostCeilingError extends Error {
  constructor(
    public ceilingUsd: number,
    public spentUsd: number
  ) {
    super(`marshal cost ceiling crossed: spent $${spentUsd.toFixed(2)} / $${ceilingUsd.toFixed(2)}/day`)
  }
}

// ── Spawn-side test seam ─────────────────────────────────────────────────
// Acceptance scripts inject a mock so we never touch Claude Desktop or AX.
export type MarshalSpawner = (args: {
  surface: SurfaceKind
  prompt: string
}) => Promise<{ ok: true; agentId: string } | { ok: false; error: string }>

let spawnerOverride: MarshalSpawner | null = null
export function __setMarshalSpawnerForTest(fn: MarshalSpawner | null): void {
  spawnerOverride = fn
}

// ── Send-side test seam — appending the SITREP prompt to the session ────
export type MarshalSender = (args: {
  surface: SurfaceKind
  agentId: string
  prompt: string
}) => Promise<{ ok: true } | { ok: false; error: string }>

let senderOverride: MarshalSender | null = null
export function __setMarshalSenderForTest(fn: MarshalSender | null): void {
  senderOverride = fn
}

// ── Clock test seam (cost-window roll, next_pass scheduling) ────────────
let clockOverride: (() => Date) | null = null
export function __setMarshalClockForTest(fn: (() => Date) | null): void {
  clockOverride = fn
}
function now(): Date {
  return clockOverride ? clockOverride() : new Date()
}

// ── Active marshal lookup ────────────────────────────────────────────────

export async function getMarshalForLane(
  laneId: string
): Promise<MarshalBindingWithConfig | null> {
  const db = getDb()
  const cfgRows = await db
    .select()
    .from(operatorMarshalConfig)
    .where(eq(operatorMarshalConfig.laneId, laneId))
    .limit(1)
  if (cfgRows.length === 0) return null
  const cfg = cfgRows[0]
  const bindingRows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.agentId, cfg.agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .limit(1)
  if (bindingRows.length === 0) return null
  const b = bindingRows[0]
  return {
    agentId: b.agentId,
    agentKind: b.agentKind,
    laneId: cfg.laneId,
    workspaceId: b.workspaceId,
    spawnedAt: b.createdAt.toISOString(),
    config: rowToConfig(cfg),
  }
}

export interface SpawnMarshalInput {
  profile: MarshalProfile
  rubric?: string | null
  intervalMinutes?: number | null
  surface?: SurfaceKind
  createdBy?: string | null
}

const DEFAULT_RUBRIC =
  "You are the lane's Marshal. On each SITREP request, scan the supplied worker context pack and report: who needs a 'continue' nudge, who is truly stuck (and why), what to bubble up to David, and whether any decision needs David now. Doctrine: keep agents running unless you'd be making a decision David should make. Never approve outbound. Never spawn workers. Never mutate plan_steps directly — suggest, David approves."

function buildSpawnPrompt(input: {
  laneId: string
  rubric: string
  profile: MarshalProfile
}): string {
  return [
    `# Marshal — lane ${input.laneId}`,
    ``,
    `You are the **Marshal** for this Operator Studio work lane. You sit between the lane's executive (Berthier) and the spawned workers. David taps you forward; you produce a SITREP.`,
    ``,
    `## Profile`,
    `- Mode: ${input.profile}`,
    ``,
    `## Rubric`,
    input.rubric,
    ``,
    `## Hard guardrails`,
    `- You may NOT approve outbound messages. The outbound gate is inviolable.`,
    `- You may NOT spawn additional workers.`,
    `- You may NOT mutate plan_steps directly — suggest via SITREP only.`,
    ``,
    `Acknowledge with a one-line "Marshal ready." Wait for the first SITREP request.`,
  ].join("\n")
}

function computeNextPassAt(profile: MarshalProfile, intervalMinutes: number | null, from: Date): Date | null {
  if (profile !== "auto-ai") return null
  if (!intervalMinutes || intervalMinutes <= 0) return null
  return new Date(from.getTime() + intervalMinutes * 60_000)
}

export async function spawnMarshalForLane(
  laneId: string,
  input: SpawnMarshalInput
): Promise<MarshalBindingWithConfig> {
  const db = getDb()
  const existing = await getMarshalForLane(laneId)
  if (existing) throw new MarshalAlreadyExistsError(existing.agentId)

  const laneRows = await db
    .select()
    .from(operatorWorkLanes)
    .where(eq(operatorWorkLanes.id, laneId))
    .limit(1)
  if (laneRows.length === 0) throw new Error(`lane ${laneId} not found`)
  const lane = laneRows[0]

  const surface: SurfaceKind = input.surface ?? "claude-cli"
  const rubric = (input.rubric?.trim() || DEFAULT_RUBRIC)
  const prompt = buildSpawnPrompt({ laneId, rubric, profile: input.profile })

  const spawner = spawnerOverride ?? defaultSpawner
  const result = await spawner({ surface, prompt })
  if (!result.ok) throw new Error(`marshal spawn failed: ${result.error}`)

  const nowAt = now()
  const agentKind: string = surface.startsWith("claude") ? "claude" : "codex"

  // Anchor plan step for the binding — reuse the lane's anchor (lane id
  // as soft FK when no anchor yet), matching the spawn-worker fallback.
  const anchor = await resolveLaneCard(laneId)
  const planStepId = anchor?.stepId ?? laneId
  const planId = anchor?.planId ?? null

  const bindingId = `tcb-${lane.workspaceId}-${result.agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${nowAt.getTime()}`
  await db.insert(operatorThreadCardBindings).values({
    id: bindingId,
    workspaceId: lane.workspaceId,
    agentId: result.agentId,
    agentKind,
    planStepId,
    planId,
    source: "launch",
    spawnedByAgentId: lane.execAgentId,
    spawnOrigin: "cockpit",
    surface,
    role: "marshal",
    createdBy: input.createdBy ?? null,
    rationale: `marshal spawn (profile=${input.profile})`,
    createdAt: nowAt,
    updatedAt: nowAt,
  })

  const nextPassAt = computeNextPassAt(
    input.profile,
    input.intervalMinutes ?? null,
    nowAt
  )
  await db.insert(operatorMarshalConfig).values({
    agentId: result.agentId,
    laneId,
    profile: input.profile,
    rubric: input.rubric?.trim() || null,
    intervalMinutes: input.intervalMinutes ?? null,
    nextPassAt: nextPassAt,
    costWindowStartedAt: nowAt,
    createdAt: nowAt,
  })

  if (anchor) {
    await writeLaneCardEvent({
      laneId,
      planStepId: anchor.stepId,
      eventKind: "marshal_spawned",
      actorAgentId: result.agentId,
      note: `profile=${input.profile}${input.intervalMinutes ? ` interval=${input.intervalMinutes}m` : ""}`,
    })
  }

  const cfg = await getMarshalForLane(laneId)
  if (!cfg) throw new Error("marshal config write race — config not readable post-insert")
  return cfg
}

async function defaultSpawner(args: {
  surface: SurfaceKind
  prompt: string
}): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
  const r = await spawnAgent({ surface: args.surface, prompt: args.prompt, submit: true })
  if (!r.ok) return { ok: false, error: r.error }
  if (!r.reconciled || !r.agentId) {
    return { ok: false, error: "spawn did not reconcile in time" }
  }
  return { ok: true, agentId: r.agentId }
}

// ── Context pack ─────────────────────────────────────────────────────────

export interface WorkerContextSlice {
  agentId: string
  agentKind: string
  planStepId: string
  lastTouchAt: string | null
  lastTouchAgeMs: number | null
  currentTool: string | null
  taskDone: boolean
  lastTurns: Array<{ role: string; preview: string }>
}

export interface MarshalContextPack {
  laneId: string
  builtAt: string
  workers: WorkerContextSlice[]
  externalSignals: {
    ado: { requested: boolean; included: boolean }
    teams: { requested: boolean; included: boolean }
  }
}

const EXTERNAL_SIGNAL_PATTERNS = {
  ado: /\b(azure\s*devops|\bado\b)/i,
  teams: /\b(microsoft\s*teams|\bteams\s*(channel|signals?)\b)/i,
}

export function detectExternalSignalsFromRubric(rubric: string | null): {
  ado: boolean
  teams: boolean
} {
  if (!rubric) return { ado: false, teams: false }
  return {
    ado: EXTERNAL_SIGNAL_PATTERNS.ado.test(rubric),
    teams: EXTERNAL_SIGNAL_PATTERNS.teams.test(rubric),
  }
}

export async function buildContextPack(
  laneId: string,
  opts?: { includeExternalSignals?: { ado?: boolean; teams?: boolean } }
): Promise<MarshalContextPack> {
  const db = getDb()
  const builtAt = now().toISOString()

  // Active workers for this lane: bindings whose spawnedByAgentId is the
  // lane's exec AND role='worker' (or null/legacy).
  const laneRows = await db
    .select()
    .from(operatorWorkLanes)
    .where(eq(operatorWorkLanes.id, laneId))
    .limit(1)
  if (laneRows.length === 0) {
    return {
      laneId,
      builtAt,
      workers: [],
      externalSignals: {
        ado: { requested: !!opts?.includeExternalSignals?.ado, included: false },
        teams: { requested: !!opts?.includeExternalSignals?.teams, included: false },
      },
    }
  }
  const lane = laneRows[0]

  const bindings = lane.execAgentId
    ? await db
        .select()
        .from(operatorThreadCardBindings)
        .where(
          and(
            eq(operatorThreadCardBindings.workspaceId, lane.workspaceId),
            eq(operatorThreadCardBindings.spawnedByAgentId, lane.execAgentId),
            isNull(operatorThreadCardBindings.detachedAt)
          )
        )
    : []

  const workers: WorkerContextSlice[] = []
  for (const b of bindings) {
    if (b.role === "marshal") continue
    const parsed = parseAgentId(b.agentId)
    if (parsed.kind !== "claude" && parsed.kind !== "codex") continue
    const app: AppSlug = parsed.kind
    let lastTurns: Array<{ role: string; preview: string }> = []
    let currentTool: string | null = null
    let taskDone = false
    let lastTouchAt: string | null = null
    let lastTouchAgeMs: number | null = null
    try {
      const tail = await getAppSessionTail(app, parsed.ref, 10)
      if (!("error" in tail)) {
        lastTouchAt = tail.fileMtime
        lastTouchAgeMs = tail.mtimeAgeMs
        if (tail.status === "tool-running") {
          const lastTool = [...tail.turns]
            .reverse()
            .flatMap((t) => t.parts)
            .find((p) => p.kind === "tool_use") as
            | { kind: "tool_use"; name: string }
            | undefined
          currentTool = lastTool?.name ?? null
        }
        for (const t of tail.turns.slice(-5)) {
          const text = t.parts
            .map((p) => {
              if (p.kind === "text") return p.text
              if (p.kind === "thinking") return ""
              if (p.kind === "tool_use") return `[tool:${p.name}]`
              if (p.kind === "tool_result") return `[result]`
              return ""
            })
            .join(" ")
            .trim()
          if (/\btask_done\b/i.test(text)) taskDone = true
          lastTurns.push({ role: t.role, preview: text.slice(0, 240) })
        }
      }
    } catch {
      /* swallow — context pack is best-effort */
    }
    workers.push({
      agentId: b.agentId,
      agentKind: b.agentKind,
      planStepId: b.planStepId,
      lastTouchAt,
      lastTouchAgeMs,
      currentTool,
      taskDone,
      lastTurns,
    })
  }

  const externalReq = opts?.includeExternalSignals ?? {}
  if (externalReq.ado) {
    console.log(`[marshal] would have pulled ADO context here (lane=${laneId})`)
  }
  if (externalReq.teams) {
    console.log(`[marshal] would have pulled Teams context here (lane=${laneId})`)
  }

  return {
    laneId,
    builtAt,
    workers,
    externalSignals: {
      ado: { requested: !!externalReq.ado, included: false },
      teams: { requested: !!externalReq.teams, included: false },
    },
  }
}

// ── Tap forward ──────────────────────────────────────────────────────────

const COST_PER_PASS_USD = 0.05

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export interface TapResult {
  agentId: string
  passedAt: string
  contextPack: MarshalContextPack
  nextPassAt: string | null
}

export async function tapMarshal(agentId: string): Promise<TapResult> {
  const db = getDb()
  const cfgRows = await db
    .select()
    .from(operatorMarshalConfig)
    .where(eq(operatorMarshalConfig.agentId, agentId))
    .limit(1)
  if (cfgRows.length === 0) throw new Error(`marshal ${agentId} not found`)
  const cfg = cfgRows[0]

  const nowAt = now()

  // Roll the cost window if we crossed midnight (local).
  let spentToday = Number(cfg.costSpentUsdToday)
  let windowStart = cfg.costWindowStartedAt
  if (!windowStart || !isSameLocalDay(windowStart, nowAt)) {
    spentToday = 0
    windowStart = nowAt
  }

  const ceiling = Number(cfg.costCeilingUsdPerDay)
  if (spentToday + COST_PER_PASS_USD > ceiling) {
    // Record the violation in the artifact log so David can see it.
    const anchor = await resolveLaneCard(cfg.laneId)
    if (anchor) {
      await writeLaneCardEvent({
        laneId: cfg.laneId,
        planStepId: anchor.stepId,
        eventKind: "marshal_alert",
        actorAgentId: agentId,
        note: `cost ceiling crossed: $${spentToday.toFixed(2)} / $${ceiling.toFixed(2)}/day`,
      })
    }
    throw new MarshalCostCeilingError(ceiling, spentToday)
  }

  const externalSignals = detectExternalSignalsFromRubric(cfg.rubric)
  const pack = await buildContextPack(cfg.laneId, {
    includeExternalSignals: externalSignals,
  })
  const sitrepPrompt = buildSitrepPrompt(pack, cfg.rubric)

  const surface: SurfaceKind = inferSurfaceFromAgentId(agentId)
  const sender = senderOverride ?? defaultSender
  const sendRes = await sender({ surface, agentId, prompt: sitrepPrompt })
  if (!sendRes.ok) throw new Error(`marshal send failed: ${sendRes.error}`)

  const nextPassAt = computeNextPassAt(
    cfg.profile as MarshalProfile,
    cfg.intervalMinutes,
    nowAt
  )

  await db
    .update(operatorMarshalConfig)
    .set({
      lastPassAt: nowAt,
      nextPassAt,
      costSpentUsdToday: String(spentToday + COST_PER_PASS_USD),
      costWindowStartedAt: windowStart,
    })
    .where(eq(operatorMarshalConfig.agentId, agentId))

  const anchor = await resolveLaneCard(cfg.laneId)
  if (anchor) {
    await writeLaneCardEvent({
      laneId: cfg.laneId,
      planStepId: anchor.stepId,
      eventKind: "marshal_pass",
      actorAgentId: agentId,
      note: `workers=${pack.workers.length}${externalSignals.ado ? " ado=requested" : ""}${externalSignals.teams ? " teams=requested" : ""}`,
    })
  }

  return {
    agentId,
    passedAt: nowAt.toISOString(),
    contextPack: pack,
    nextPassAt: nextPassAt?.toISOString() ?? null,
  }
}

function inferSurfaceFromAgentId(agentId: string): SurfaceKind {
  const parsed = parseAgentId(agentId)
  if (parsed.kind === "codex") return "codex-cli"
  return "claude-cli"
}

async function defaultSender(args: {
  surface: SurfaceKind
  agentId: string
  prompt: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // CLI-only as of 2026-05-12. The Marshal SITREP nudge resumes the
  // session via `claude --resume <id> --print <prompt>`, which writes
  // both the user turn and assistant response to the existing JSONL.
  // codex-cli equivalent path is not implemented in marshal yet;
  // acceptance scripts inject a mock for that branch.
  try {
    const parsed = parseAgentId(args.agentId)
    if (parsed.kind === "codex") {
      return {
        ok: false,
        error: "codex-cli marshal sender not implemented (V1 — claude-cli only)",
      }
    }
    if (parsed.kind === null) {
      return { ok: false, error: `unrecognized agentId ${args.agentId}` }
    }
    const { sendToClaudeCli } = await import(
      "@/lib/server/agent-bridge/claude-cli-send"
    )
    const r = await sendToClaudeCli({ sessionId: parsed.ref, text: args.prompt })
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function buildSitrepPrompt(pack: MarshalContextPack, rubric: string | null): string {
  return [
    `## SITREP request (${pack.builtAt})`,
    ``,
    `Per your rubric${rubric ? "" : " (default doctrine)"}, scan the worker context below and report:`,
    `- Who needs a 'continue' nudge`,
    `- Who is truly stuck (and why)`,
    `- What to bubble up to David`,
    `- Whether any decision needs David now (mark with *needs-david*)`,
    ``,
    `Worker context pack:`,
    "```json",
    JSON.stringify(pack, null, 2),
    "```",
    ``,
    `Reminder: do not approve outbound, do not spawn workers, do not mutate plan_steps directly.`,
  ].join("\n")
}

// ── Config updates ───────────────────────────────────────────────────────

export interface UpdateMarshalConfigInput {
  profile?: MarshalProfile
  rubric?: string | null
  intervalMinutes?: number | null
  costCeilingUsdPerDay?: number
}

export async function updateMarshalConfig(
  agentId: string,
  patch: UpdateMarshalConfigInput
): Promise<MarshalConfig> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorMarshalConfig)
    .where(eq(operatorMarshalConfig.agentId, agentId))
    .limit(1)
  if (rows.length === 0) throw new Error(`marshal ${agentId} not found`)
  const cur = rows[0]
  const setFields: Partial<typeof operatorMarshalConfig.$inferInsert> = {}
  const nowAt = now()
  if (patch.profile !== undefined) setFields.profile = patch.profile
  if (patch.rubric !== undefined) setFields.rubric = patch.rubric?.trim() || null
  if (patch.intervalMinutes !== undefined) {
    setFields.intervalMinutes = patch.intervalMinutes
  }
  if (patch.costCeilingUsdPerDay !== undefined) {
    setFields.costCeilingUsdPerDay = String(patch.costCeilingUsdPerDay)
  }
  // Recompute next_pass_at when profile / interval changed.
  const nextProfile = (patch.profile ?? (cur.profile as MarshalProfile)) as MarshalProfile
  const nextInterval =
    patch.intervalMinutes !== undefined ? patch.intervalMinutes : cur.intervalMinutes
  if (
    patch.profile !== undefined ||
    patch.intervalMinutes !== undefined
  ) {
    setFields.nextPassAt = computeNextPassAt(nextProfile, nextInterval, nowAt)
  }
  await db
    .update(operatorMarshalConfig)
    .set(setFields)
    .where(eq(operatorMarshalConfig.agentId, agentId))
  const after = await db
    .select()
    .from(operatorMarshalConfig)
    .where(eq(operatorMarshalConfig.agentId, agentId))
    .limit(1)
  return rowToConfig(after[0])
}

// ── Auto-AI tick ─────────────────────────────────────────────────────────
//
// Called by the (separately-implemented) scheduler. Idempotent within a
// single tick — a Marshal whose next_pass_at has not yet been advanced
// past `now` will run; advancing happens inside `tapMarshal`.
export interface AutoAiTickResult {
  attempted: string[]
  succeeded: string[]
  skippedCostCeiling: string[]
  failed: Array<{ agentId: string; error: string }>
}

export async function tickAutoAiMarshals(): Promise<AutoAiTickResult> {
  const db = getDb()
  const nowAt = now()
  const due = await db
    .select()
    .from(operatorMarshalConfig)
    .where(
      and(
        eq(operatorMarshalConfig.profile, "auto-ai"),
        lte(operatorMarshalConfig.nextPassAt, nowAt)
      )
    )
  const result: AutoAiTickResult = {
    attempted: [],
    succeeded: [],
    skippedCostCeiling: [],
    failed: [],
  }
  for (const cfg of due) {
    result.attempted.push(cfg.agentId)
    try {
      await tapMarshal(cfg.agentId)
      result.succeeded.push(cfg.agentId)
    } catch (e) {
      if (e instanceof MarshalCostCeilingError) {
        result.skippedCostCeiling.push(cfg.agentId)
      } else {
        result.failed.push({
          agentId: cfg.agentId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }
  return result
}
