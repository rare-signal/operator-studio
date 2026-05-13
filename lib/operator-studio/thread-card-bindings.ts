/**
 * Durable worker-thread → plan-card bindings.
 *
 * The Operations desk previously relied on two ephemeral signals:
 *   1. tail-sniff over recent JSONL turns (`detectedPlanCardId`),
 *   2. a localStorage map maintained by the Bento UI.
 *
 * This module is the durable third source: when Operator Studio
 * launches (or the operator manually attaches) a Claude/Codex worker
 * against a plan card, the binding is persisted in
 * `operator_thread_card_bindings` so it survives reloads, browsers,
 * and machines, and is readable by server-side derivation.
 *
 * Read precedence on Operations is: durable > manual (localStorage) >
 * tail-sniff. The localStorage path is intentionally preserved as a
 * fallback during the rollout.
 */

import "server-only"

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm"

import { computeReviewStatus } from "@/lib/operator-studio/review-status"
import type { HumanReviewEquipment } from "@/lib/operator-studio/human-review-equipment"
import { parseHumanReviewEquipment } from "@/lib/operator-studio/human-review-equipment"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import {
  getAppSessionEntry,
  getAppSessionTail,
  type AppSlug,
} from "@/lib/server/agent-bridge/app-sessions"
import { getDb } from "@/lib/server/db/client"
import {
  operatorCockpitExecs,
  operatorThreadCardBindings,
} from "@/lib/server/db/schema"
import { parseAgentId } from "@/lib/server/agent-bridge/types"

export type ThreadBindingSource =
  | "launch"
  | "manual"
  | "tail-sniff"
  | "scheduled"

export type SpawnOrigin =
  | "cockpit"
  | "cockpit-bypass"
  | "recommendation"
  | "manual"
  | "cli-server"

export interface ThreadCardBinding {
  id: string
  workspaceId: string
  agentId: string
  agentKind: string
  planStepId: string
  planId: string | null
  source: ThreadBindingSource
  confidence: number | null
  rationale: string | null
  sourceRecommendationId: string | null
  spawnedByAgentId: string | null
  spawnOrigin: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  /** When this binding was retired (worker marked complete or
   *  reattached to a different card). Null for active bindings. */
  detachedAt: string | null
  /** Free-form rationale captured at detach time. Null if the binding
   *  is still active or was detached without a reason. */
  detachReason: string | null
  /** ISO timestamp; non-null = Berthier explicitly acknowledged. */
  berthierReviewedAt: string | null
  /** ISO timestamp; non-null = David explicitly signed off. */
  humanApprovedAt: string | null
  /** Per-feature human-review equipment spec the worker scoped on
   *  task_done. Null until set. Drives which client component the
   *  Subtelegento dev-instance mounts for the reviewer. */
  humanReviewEquipment: HumanReviewEquipment | null
  /** Where the session physically lives. Drives chat-send dispatch:
   *  'claude-cli' / 'codex-cli' → CLI resume; 'desktop' is legacy AX
   *  (no new rows should land with this value post 2026-05-12). */
  surface: "claude-cli" | "codex-cli" | "desktop"
}

export interface UpsertThreadCardBindingInput {
  workspaceId: string
  agentId: string
  agentKind: string
  planStepId: string
  planId?: string | null
  source: ThreadBindingSource
  confidence?: number | null
  rationale?: string | null
  sourceRecommendationId?: string | null
  /** Composite agent id of the executive that originated this spawn
   *  (e.g. cockpit's pinned exec). Persists the parent → child linkage
   *  so the cockpit can show authoritative spawned-by lists. */
  spawnedByAgentId?: string | null
  spawnOrigin?: SpawnOrigin | null
  createdBy?: string | null
  /** Where the session physically lives — drives the chat-send dispatch.
   *  'claude-cli' / 'codex-cli' route through `claude --resume --print`
   *  (or the Codex CLI equivalent). 'desktop' is the legacy AX clipboard
   *  path, kept only as a column default for back-compat with pre-CLI
   *  rows. New spawn paths MUST set this explicitly. */
  surface?: "claude-cli" | "codex-cli" | "desktop"
  /** Tier marker. 'worker' (default) | 'exec' | 'marshal'. The
   *  role-conflict guard in `setLaneExec` rejects any agentId whose
   *  active binding row has role='worker' — spawn-an-exec paths MUST
   *  set role='exec' before (or instead of) calling setLaneExec, else
   *  the lane promotion will throw LaneExecConflictError. */
  role?: "worker" | "exec" | "marshal"
}

function rowToBinding(row: typeof operatorThreadCardBindings.$inferSelect): ThreadCardBinding {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    agentKind: row.agentKind,
    planStepId: row.planStepId,
    planId: row.planId ?? null,
    source: row.source as ThreadBindingSource,
    confidence: row.confidence ?? null,
    rationale: row.rationale ?? null,
    sourceRecommendationId: row.sourceRecommendationId ?? null,
    spawnedByAgentId: row.spawnedByAgentId ?? null,
    spawnOrigin: row.spawnOrigin ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    detachedAt: row.detachedAt ? row.detachedAt.toISOString() : null,
    detachReason: row.detachReason ?? null,
    berthierReviewedAt: row.berthierReviewedAt
      ? row.berthierReviewedAt.toISOString()
      : null,
    humanApprovedAt: row.humanApprovedAt
      ? row.humanApprovedAt.toISOString()
      : null,
    humanReviewEquipment: parseHumanReviewEquipment(row.humanReviewEquipment),
    surface:
      row.surface === "claude-cli" ||
      row.surface === "codex-cli" ||
      row.surface === "desktop"
        ? row.surface
        : "desktop",
  }
}

/**
 * Persist a human-review-equipment spec on the active binding for
 * (workspace, agent). Called by the task_done dispatcher when the
 * worker's payload includes an equipment block. Idempotent — repeat
 * calls overwrite. Returns true if a row was updated.
 *
 * The spec is parsed/validated before write — callers can pass raw
 * unknown shapes from agent output without pre-validation.
 */
export async function setHumanReviewEquipment(
  workspaceId: string,
  agentId: string,
  spec: HumanReviewEquipment
): Promise<boolean> {
  const validated = parseHumanReviewEquipment(spec)
  if (!validated) return false
  const db = getDb()
  const now = new Date()
  const updated = await db
    .update(operatorThreadCardBindings)
    .set({
      humanReviewEquipment: validated,
      updatedAt: now,
    })
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.agentId, agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .returning({ id: operatorThreadCardBindings.id })
  return updated.length > 0
}

/**
 * Idempotent upsert of the active binding for a (workspace, agent).
 *
 * If an active row exists with the same planStepId, only updatedAt and
 * the optional metadata are refreshed (source is preserved unless the
 * incoming source ranks higher — see SOURCE_RANK).
 *
 * If an active row exists pointing at a different step, it is detached
 * (detached_at = now) and a new active row is inserted. This preserves
 * binding history without requiring a separate audit table.
 */
const SOURCE_RANK: Record<ThreadBindingSource, number> = {
  launch: 0,
  manual: 1,
  scheduled: 2,
  "tail-sniff": 3,
}

export async function upsertThreadCardBinding(
  input: UpsertThreadCardBindingInput
): Promise<ThreadCardBinding> {
  const db = getDb()
  const now = new Date()

  // Role-conflict guard: a thread that's currently a cockpit exec
  // cannot be bound as a worker. Roles are mutually exclusive.
  const execRow = await db
    .select({ workspaceId: operatorCockpitExecs.workspaceId })
    .from(operatorCockpitExecs)
    .where(
      and(
        eq(operatorCockpitExecs.workspaceId, input.workspaceId),
        eq(operatorCockpitExecs.agentId, input.agentId)
      )
    )
    .limit(1)
  if (execRow.length > 0) {
    throw new Error(
      `Thread ${input.agentId} is currently the cockpit exec for workspace ${input.workspaceId}; clear the exec before binding it as a worker.`
    )
  }

  const existing = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, input.workspaceId),
        eq(operatorThreadCardBindings.agentId, input.agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (row.planStepId === input.planStepId) {
      const incomingRank = SOURCE_RANK[input.source] ?? 99
      const currentRank = SOURCE_RANK[row.source as ThreadBindingSource] ?? 99
      const nextSource = incomingRank <= currentRank ? input.source : (row.source as ThreadBindingSource)
      const updated = await db
        .update(operatorThreadCardBindings)
        .set({
          source: nextSource,
          confidence: input.confidence ?? row.confidence ?? null,
          rationale: input.rationale ?? row.rationale ?? null,
          sourceRecommendationId:
            input.sourceRecommendationId ?? row.sourceRecommendationId ?? null,
          spawnedByAgentId:
            input.spawnedByAgentId ?? row.spawnedByAgentId ?? null,
          spawnOrigin: input.spawnOrigin ?? row.spawnOrigin ?? null,
          planId: input.planId ?? row.planId ?? null,
          surface: input.surface ?? row.surface ?? "claude-cli",
          role: input.role ?? row.role ?? "worker",
          updatedAt: now,
        })
        .where(eq(operatorThreadCardBindings.id, row.id))
        .returning()
      return rowToBinding(updated[0])
    }
    // Different card — detach the old row, then insert a fresh one.
    await db
      .update(operatorThreadCardBindings)
      .set({ detachedAt: now, updatedAt: now })
      .where(eq(operatorThreadCardBindings.id, row.id))
  }

  const id = `tcb-${input.workspaceId}-${input.agentId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${now.getTime()}`
  const inserted = await db
    .insert(operatorThreadCardBindings)
    .values({
      id,
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      agentKind: input.agentKind,
      planStepId: input.planStepId,
      planId: input.planId ?? null,
      source: input.source,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      sourceRecommendationId: input.sourceRecommendationId ?? null,
      spawnedByAgentId: input.spawnedByAgentId ?? null,
      spawnOrigin: input.spawnOrigin ?? null,
      surface: input.surface ?? "claude-cli",
      role: input.role ?? "worker",
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return rowToBinding(inserted[0])
}

/**
 * Server-side dispatcher for an assistant turn that may contain a
 * `task_done` sentinel + an optional `human-review-equipment` block.
 * Persists the equipment on the active binding if a block was
 * present and parsed. Returns whether the sentinel matched and
 * whether equipment was persisted, so callers (e.g. a future
 * task_done watcher) can fire additional side-effects (thread-done
 * stamping, notifier, etc.).
 *
 * Pure-parser + persistence split: parsing lives in
 * `power-strings.ts#parseTaskDonePayload`; this function is the
 * thin DB wrapper that closes the loop.
 */
/** Test seam for the ephemeral-deployment provisioner trigger (W4).
 *  Defaults to lazily importing the real `provisionEphemeralDeployment`
 *  from `app-runner-provisioner.ts`. Acceptance scripts inject a mock
 *  so we never touch AWS. The function is invoked only when:
 *    - task_done sentinel matched
 *    - equipment was persisted on the binding
 *    - reverse lookup agentId→adoWorkItemId succeeded
 *  The kill-switch lives inside the real provisioner; tests bypass it
 *  by injecting a mock that always succeeds. */
export type EphemeralDeploymentTrigger = (input: {
  workspaceId: string
  agentId: string
  adoWorkItemId: number
  equipment: HumanReviewEquipment
}) => Promise<{ ok: boolean; deeplinkUrl?: string; error?: string }>

let ephemeralDeploymentTrigger: EphemeralDeploymentTrigger | null = null

export function __setEphemeralDeploymentTriggerForTest(
  fn: EphemeralDeploymentTrigger | null
): void {
  ephemeralDeploymentTrigger = fn
}

async function defaultEphemeralDeploymentTrigger(input: {
  workspaceId: string
  agentId: string
  adoWorkItemId: number
  equipment: HumanReviewEquipment
}): Promise<{ ok: boolean; deeplinkUrl?: string; error?: string }> {
  // Lazy import — the AWS SDK clients pull in heavy code we don't want
  // resident in modules that import thread-card-bindings.
  try {
    const { provisionEphemeralDeployment } = await import(
      "./app-runner-provisioner"
    )
    const requestId = `req-${input.adoWorkItemId}-${Date.now()}`
    // Caller-supplied image tag is not known here; in production a
    // sibling card resolves this from the worker's task_done payload.
    // For now we fall through to whatever the worker emits in the
    // env-var equipment block.
    const res = await provisionEphemeralDeployment({
      requestId,
      imageTag: input.equipment.envVars?.TELEGENTO_PREVIEW_IMAGE_TAG ?? "latest",
      // Real prod ECR repo is `telegento` (single segment). The
      // `telegento/v4` assumption came from `step-C-pipeline-E-deploy-target`
      // doc-side aspiration that never actually landed. AWS audit
      // 2026-05-11 confirmed the live repo name. Override via env
      // if a future sibling eval repo is created.
      ecrRepositoryName:
        process.env.TELEGENTO_EVAL_ECR_REPO ?? "telegento",
      ephemeralShardName: `eph_${requestId}`,
      workerTaskDoneSummary: `task_done from ${input.agentId}`,
      humanReviewEquipment: input.equipment,
    })
    return { ok: true, deeplinkUrl: res.deeplinkUrl }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function applyTaskDonePayload(
  workspaceId: string,
  agentId: string,
  role: string,
  content: string
): Promise<{
  matched: boolean
  equipmentPersisted: boolean
  ticketId: number | null
  artifactsRecorded: number
  provisionerFired: boolean
  provisionerOk: boolean | null
}> {
  const { parseTaskDonePayload } = await import("./power-strings")
  const { recordArtifactSafe } = await import("./factory-loop-artifacts")
  const { getTicketIdForAgent } = await import(
    "./ado-ticket-worker-bindings"
  )
  const { matched, equipment } = parseTaskDonePayload(role, content)
  let equipmentPersisted = false
  if (equipment) {
    equipmentPersisted = await setHumanReviewEquipment(
      workspaceId,
      agentId,
      equipment
    )
  }
  const ticketId = matched
    ? getTicketIdForAgent(workspaceId, agentId)
    : null
  let artifactsRecorded = 0
  let provisionerFired = false
  let provisionerOk: boolean | null = null

  if (matched && ticketId !== null) {
    const r = await recordArtifactSafe({
      workspaceId,
      adoWorkItemId: ticketId,
      eventKind: "worker-task-done",
      eventPayload: {
        agentId,
        contentPreview: content.slice(0, 4000),
        equipment: equipment ?? null,
        matchedSpecId: matched.id,
      },
    })
    if (r) artifactsRecorded += 1

    if (equipment) {
      const trigger =
        ephemeralDeploymentTrigger ?? defaultEphemeralDeploymentTrigger
      provisionerFired = true
      const provisionRes = await trigger({
        workspaceId,
        agentId,
        adoWorkItemId: ticketId,
        equipment,
      })
      provisionerOk = provisionRes.ok
      const r2 = await recordArtifactSafe({
        workspaceId,
        adoWorkItemId: ticketId,
        eventKind: "deployment-provisioned",
        eventPayload: {
          agentId,
          ok: provisionRes.ok,
          deeplinkUrl: provisionRes.deeplinkUrl ?? null,
          error: provisionRes.error ?? null,
          equipmentKind: equipment.kind,
        },
      })
      if (r2) artifactsRecorded += 1
    }
  }
  return {
    matched: matched !== null,
    equipmentPersisted,
    ticketId,
    artifactsRecorded,
    provisionerFired,
    provisionerOk,
  }
}

/**
 * Active bindings spawned by a specific executive agent. Drives the
 * cockpit's "workers spawned by exec" rail. Excludes detached rows.
 */
export async function getActiveBindingsSpawnedBy(
  workspaceId: string,
  spawnedByAgentId: string
): Promise<ThreadCardBinding[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.spawnedByAgentId, spawnedByAgentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .orderBy(desc(operatorThreadCardBindings.createdAt))
  return rows.map(rowToBinding)
}

/**
 * Recently detached (= "completed", from the cockpit's POV) bindings
 * spawned by a specific executive agent. Drives the cockpit's
 * "recently completed workers" collapsible section under the active
 * rail. Detached rows preserve full binding history; ordering is by
 * detach time, most recent first.
 *
 * The plan-card status the worker was operating on is independent of
 * this binding's detach state — a card can stay in-motion while the
 * binding is detached because Phase 2 hasn't started yet.
 */
export async function getRecentlyDetachedBindingsSpawnedBy(
  workspaceId: string,
  spawnedByAgentId: string,
  limit = 10
): Promise<ThreadCardBinding[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.spawnedByAgentId, spawnedByAgentId),
        isNotNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .orderBy(desc(operatorThreadCardBindings.detachedAt))
    .limit(limit)
  return rows.map(rowToBinding)
}

/** All active (non-detached) bindings for a workspace. */
export async function listActiveThreadCardBindings(
  workspaceId: string
): Promise<ThreadCardBinding[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .orderBy(desc(operatorThreadCardBindings.updatedAt))
  return rows.map(rowToBinding)
}

/** Active bindings for a specific set of agent ids. */
export async function getActiveBindingsForAgents(
  workspaceId: string,
  agentIds: string[]
): Promise<ThreadCardBinding[]> {
  if (agentIds.length === 0) return []
  const db = getDb()
  const rows = await db
    .select()
    .from(operatorThreadCardBindings)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        isNull(operatorThreadCardBindings.detachedAt),
        inArray(operatorThreadCardBindings.agentId, agentIds)
      )
    )
  return rows.map(rowToBinding)
}

/** Detach an agent from whatever card it currently maps to. The
 *  optional `detachReason` is persisted on the row for the
 *  recently-completed drawer (and for follow-on tooling).
 *
 *  When `humanApproved=true` (passed via the options form), also
 *  stamps `human_approved_at` and `berthier_reviewed_at` (if not
 *  already set) — semantics: David's explicit sign-off implies
 *  Berthier scrutiny is no longer load-bearing. */
export async function detachThreadCardBinding(
  workspaceId: string,
  agentId: string,
  reasonOrOpts?:
    | string
    | null
    | { reason?: string | null; humanApproved?: boolean }
): Promise<boolean> {
  const opts =
    typeof reasonOrOpts === "string" || reasonOrOpts == null
      ? { reason: (reasonOrOpts as string | null) ?? null, humanApproved: false }
      : {
          reason: reasonOrOpts.reason ?? null,
          humanApproved: !!reasonOrOpts.humanApproved,
        }
  const db = getDb()
  const now = new Date()
  const setFields: Record<string, unknown> = {
    detachedAt: now,
    updatedAt: now,
    detachReason: opts.reason,
  }
  if (opts.humanApproved) {
    setFields.humanApprovedAt = now
    // Mark Berthier-reviewed too if not already; human approval
    // logically subsumes Berthier scrutiny.
    setFields.berthierReviewedAt = now
  }
  const updated = await db
    .update(operatorThreadCardBindings)
    .set(setFields)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.agentId, agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .returning({ id: operatorThreadCardBindings.id })
  return updated.length > 0
}

/** Stamp `berthier_reviewed_at = now` on the active binding for
 *  (workspace, agent). Does not detach. Returns true if a row was
 *  updated. Optionally records `reason` on the row's
 *  `detach_reason` column (sentinel — we reuse the column for the
 *  Berthier ack rationale until a dedicated column lands). */
export async function setBerthierReviewedAt(
  workspaceId: string,
  agentId: string,
  reason?: string | null
): Promise<boolean> {
  const db = getDb()
  const now = new Date()
  const setFields: Record<string, unknown> = {
    berthierReviewedAt: now,
    updatedAt: now,
  }
  if (reason) setFields.detachReason = reason
  const updated = await db
    .update(operatorThreadCardBindings)
    .set(setFields)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.agentId, agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .returning({ id: operatorThreadCardBindings.id })
  return updated.length > 0
}

/** Stamp `human_approved_at = now` (and `berthier_reviewed_at` if
 *  not set) on the active binding for (workspace, agent). Does not
 *  detach — use `detachThreadCardBinding({ humanApproved: true })`
 *  for the combined sign-off-and-retire path. */
export async function setHumanApprovedAt(
  workspaceId: string,
  agentId: string,
  reason?: string | null
): Promise<boolean> {
  const db = getDb()
  const now = new Date()
  const setFields: Record<string, unknown> = {
    humanApprovedAt: now,
    berthierReviewedAt: now,
    updatedAt: now,
  }
  if (reason) setFields.detachReason = reason
  const updated = await db
    .update(operatorThreadCardBindings)
    .set(setFields)
    .where(
      and(
        eq(operatorThreadCardBindings.workspaceId, workspaceId),
        eq(operatorThreadCardBindings.agentId, agentId),
        isNull(operatorThreadCardBindings.detachedAt)
      )
    )
    .returning({ id: operatorThreadCardBindings.id })
  return updated.length > 0
}

/**
 * Safety-net auto-detach for the multi-tier review state machine
 * (0034). Walks active bindings; detaches **only** those in the
 * `berthier-reviewed` tier whose last touch is older than the
 * (much-longer) threshold. Never auto-detaches:
 *
 *   - "candidate-self-believed" / "awaiting-berthier-check" — Berthier
 *     hasn't even glanced; auto-detach would silently miscarriage the
 *     work David most needs to be reminded of.
 *   - "live" / "idle" — nothing actionable.
 *   - "human-approved" — already terminal; detach-or-not is up to the
 *     mark-done CLI / cockpit affordance.
 *
 * Default threshold: 24 hours. The legacy `thresholdMs` numeric arg
 * is preserved for callers that pass milliseconds, but is now
 * interpreted as the `berthier-reviewed` threshold (per the plan
 * card's "much longer threshold (24h default)" rule).
 *
 * Returns the count of bindings that were detached this call.
 */
export interface AutoDetachOptions {
  /**
   * Escape hatch for legitimate prod ops + opted-in test scripts.
   * Bypasses the min-threshold and global-workspace-from-script guards.
   * Tests on synthetic workspaces still must pass this if their
   * threshold is below 5min, since the threshold check is unconditional.
   */
  unsafeAllowProduction?: boolean
}

const AUTO_DETACH_MIN_THRESHOLD_MS = 5 * 60_000

function isCalledFromAcceptanceScript(): boolean {
  const argv1 = typeof process !== "undefined" ? process.argv?.[1] ?? "" : ""
  return argv1.includes("/scripts/") || argv1.includes("acceptance")
}

export async function autoDetachStaleReadyWorkers(
  workspaceId: string,
  thresholdMs: number = 24 * 60 * 60_000,
  opts: AutoDetachOptions = {}
): Promise<number> {
  const override = opts.unsafeAllowProduction === true

  // Guard 1: minimum threshold. The 2026-05-10 incident was a test
  // script invoking with threshold=0 against the production workspace,
  // sweeping every in-flight worker. A sub-5min threshold has no
  // legitimate production use.
  if (
    !override &&
    (!Number.isFinite(thresholdMs) || thresholdMs < AUTO_DETACH_MIN_THRESHOLD_MS)
  ) {
    throw new Error(
      "auto-detach threshold below 5min is unsafe; would detach in-flight workers. Pass { unsafeAllowProduction: true } from a test on a synthetic workspace to override."
    )
  }

  // Guard 2: belt-and-suspenders — refuse to operate on the production
  // GLOBAL workspace from any process whose argv looks like a script
  // or acceptance harness.
  if (
    !override &&
    workspaceId === GLOBAL_WORKSPACE_ID &&
    isCalledFromAcceptanceScript()
  ) {
    throw new Error(
      "auto-detach refuses to run against the GLOBAL production workspace from a script/acceptance path. Use a synthetic workspace, or pass { unsafeAllowProduction: true } if this is a sanctioned prod op."
    )
  }

  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return 0
  const active = await listActiveThreadCardBindings(workspaceId)
  if (active.length === 0) return 0
  const now = Date.now()
  let detached = 0
  for (const b of active) {
    const ageMs = now - Date.parse(b.updatedAt)
    if (!Number.isFinite(ageMs) || ageMs <= thresholdMs) continue
    const parsed = parseAgentId(b.agentId)
    if (parsed.kind !== "claude" && parsed.kind !== "codex") continue
    const app: AppSlug = parsed.kind
    const entry = await getAppSessionEntry(app, parsed.ref).catch(() => null)
    const lastActivityAt = entry ? new Date(entry.mtimeMs).toISOString() : null
    let reviewStatus: ReturnType<typeof computeReviewStatus>
    try {
      const tail = await getAppSessionTail(app, parsed.ref, 50)
      if ("error" in tail) {
        reviewStatus = computeReviewStatus([], lastActivityAt, {
          berthierReviewedAt: b.berthierReviewedAt,
          humanApprovedAt: b.humanApprovedAt,
        })
      } else {
        reviewStatus = computeReviewStatus(tail.turns, lastActivityAt, {
          berthierReviewedAt: b.berthierReviewedAt,
          humanApprovedAt: b.humanApprovedAt,
        })
      }
    } catch {
      reviewStatus = computeReviewStatus([], lastActivityAt, {
        berthierReviewedAt: b.berthierReviewedAt,
        humanApprovedAt: b.humanApprovedAt,
      })
    }
    // Only "berthier-reviewed" is eligible. The other interstitial
    // tier ("candidate-self-believed") is explicitly off-limits to
    // auto-detach regardless of age.
    if (reviewStatus !== "berthier-reviewed") continue
    const hours = Math.round(thresholdMs / 3_600_000)
    const ok = await detachThreadCardBinding(
      workspaceId,
      b.agentId,
      `auto-detached after ${hours}h berthier-reviewed without human approval — re-spawn if wrongly accepted`
    )
    if (ok) detached += 1
  }
  return detached
}
