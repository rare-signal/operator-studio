/**
 * Outbound mode = "this server may send a specific staged outbox row to
 * an external surface (Azure DevOps, Microsoft Teams, etc.)". A separate
 * armed-window primitive from hot mode (which gates prompt-send to
 * local agents) — different surfaces, different stakes.
 *
 * The threat we're defending against is *us*: an LLM (or a careless
 * developer) deciding mid-flight that something needs to leave the
 * machine and go reach a human via Teams or post a comment on a public
 * tracker. That class of action must be approved by David in the
 * moment of approval, with the *exact bytes* he is approving bound to
 * the armed window.
 *
 * Design = nuclear launch cover with a per-row binding:
 *
 *   - State lives in process memory only. Server restart → all
 *     approvals cleared. A hung loop dies the moment the dev server
 *     restarts.
 *   - Approving an outbound action requires:
 *       (a) the correct PIN (default "1010", overridable via
 *           `OPERATOR_STUDIO_OUTBOUND_PIN`. May share the hot-mode PIN
 *           or be split — env decides), AND
 *       (b) an explicit (outboxRowId, payloadHash, surface, action,
 *           targetId) tuple. The approval is bound to that exact
 *           outbox row and that exact payload. Editing the row clears
 *           the approval.
 *   - Approvals are single-use. After a successful send, the approval
 *     is consumed. A second send for the same row in the same armed
 *     window requires re-approval.
 *   - Approvals expire after a duration cap (default 5 min, max 15
 *     min). The armed window for outbound is shorter than hot-mode by
 *     design — outbound is rarer and higher-stakes than agent prompt
 *     send.
 *   - Disarming any approval requires no PIN.
 */

const DEFAULT_PIN = "1010"
const DEFAULT_DURATION_MS = 5 * 60_000
const MAX_DURATION_MS = 15 * 60_000

export type OutboundSurface =
  | "ado"
  | "teams"
  | "preview_deploy"
  | "email"
  | "stakeholder_reply"

export interface OutboundApproval {
  outboxRowId: string
  payloadHash: string
  surface: OutboundSurface
  action: string
  targetId: string
  approvedAtMs: number
  expiresAtMs: number
}

interface OutboundRuntime {
  approvals: OutboundApproval[]
}

const GLOBAL_KEY = "__operatorStudioOutboundMode_v1__" as const
type GlobalWithOutbound = typeof globalThis & {
  [GLOBAL_KEY]?: OutboundRuntime
}
function runtime(): OutboundRuntime {
  const g = globalThis as GlobalWithOutbound
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = { approvals: [] }
  }
  return g[GLOBAL_KEY]!
}

function getPin(): string {
  return (
    process.env.OPERATOR_STUDIO_OUTBOUND_PIN?.trim() ||
    process.env.OPERATOR_STUDIO_HOT_MODE_PIN?.trim() ||
    DEFAULT_PIN
  )
}

function pruneExpired(now: number): void {
  const r = runtime()
  r.approvals = r.approvals.filter((a) => a.expiresAtMs > now)
}

export interface OutboundStatus {
  approvals: Array<Omit<OutboundApproval, "payloadHash"> & { remainingMs: number }>
  defaultDurationMs: number
  maxDurationMs: number
  pinIsCustom: boolean
}

export function getOutboundStatus(): OutboundStatus {
  const now = Date.now()
  pruneExpired(now)
  return {
    approvals: runtime().approvals.map((a) => ({
      outboxRowId: a.outboxRowId,
      surface: a.surface,
      action: a.action,
      targetId: a.targetId,
      approvedAtMs: a.approvedAtMs,
      expiresAtMs: a.expiresAtMs,
      remainingMs: Math.max(0, a.expiresAtMs - now),
    })),
    defaultDurationMs: DEFAULT_DURATION_MS,
    maxDurationMs: MAX_DURATION_MS,
    pinIsCustom: Boolean(
      process.env.OPERATOR_STUDIO_OUTBOUND_PIN?.trim() ||
        process.env.OPERATOR_STUDIO_HOT_MODE_PIN?.trim()
    ),
  }
}

export type ApproveResult =
  | { ok: true; expiresAtMs: number; remainingMs: number }
  | { ok: false; reason: "bad-pin" | "duration-too-large" }

export interface ApproveOutboundInput {
  pin: string
  outboxRowId: string
  payloadHash: string
  surface: OutboundSurface
  action: string
  targetId: string
  durationMs?: number
}

/**
 * Approve a single outbox row for sending. The approval binds to the
 * exact (outboxRowId, payloadHash, surface, action, targetId) tuple —
 * a different payload or different target cannot consume it.
 *
 * Approving the same row twice replaces the previous approval (so an
 * editor can re-arm after editing the rendered text and re-hashing the
 * payload).
 */
export function approveOutbound(input: ApproveOutboundInput): ApproveResult {
  if (typeof input.pin !== "string" || input.pin.trim() !== getPin()) {
    return { ok: false, reason: "bad-pin" }
  }
  const requested =
    typeof input.durationMs === "number" &&
    Number.isFinite(input.durationMs) &&
    input.durationMs > 0
      ? input.durationMs
      : DEFAULT_DURATION_MS
  if (requested > MAX_DURATION_MS) {
    return { ok: false, reason: "duration-too-large" }
  }
  const now = Date.now()
  pruneExpired(now)
  const r = runtime()
  const next: OutboundApproval = {
    outboxRowId: input.outboxRowId,
    payloadHash: input.payloadHash,
    surface: input.surface,
    action: input.action,
    targetId: input.targetId,
    approvedAtMs: now,
    expiresAtMs: now + requested,
  }
  r.approvals = r.approvals.filter((a) => a.outboxRowId !== input.outboxRowId)
  r.approvals.push(next)
  return {
    ok: true,
    expiresAtMs: next.expiresAtMs,
    remainingMs: requested,
  }
}

export type ConsumeResult =
  | { ok: true }
  | {
      ok: false
      reason: "not-approved" | "expired" | "payload-mismatch" | "target-mismatch"
    }

export interface ConsumeOutboundInput {
  outboxRowId: string
  payloadHash: string
  surface: OutboundSurface
  action: string
  targetId: string
}

/**
 * Consume a per-row approval. Single-use: on success the approval is
 * removed so a second send must be re-approved.
 *
 * Mismatch reasons are deliberately separate so the writer can return
 * a precise diagnostic to the operator (and so audit logs distinguish
 * "they tried to send a different thing" from "the window expired").
 */
export function consumeOutboundApproval(
  input: ConsumeOutboundInput
): ConsumeResult {
  // Do NOT prune-then-look-up — that loses the chance to report
  // "expired" vs. "not-approved". We check expiry on the matched row.
  const now = Date.now()
  const r = runtime()
  const idx = r.approvals.findIndex(
    (a) => a.outboxRowId === input.outboxRowId
  )
  if (idx < 0) return { ok: false, reason: "not-approved" }
  const approval = r.approvals[idx]!
  if (approval.expiresAtMs <= now) {
    r.approvals.splice(idx, 1)
    return { ok: false, reason: "expired" }
  }
  if (approval.surface !== input.surface || approval.action !== input.action) {
    return { ok: false, reason: "target-mismatch" }
  }
  if (approval.targetId !== input.targetId) {
    return { ok: false, reason: "target-mismatch" }
  }
  if (approval.payloadHash !== input.payloadHash) {
    return { ok: false, reason: "payload-mismatch" }
  }
  // Consume.
  r.approvals.splice(idx, 1)
  return { ok: true }
}

export function disarmOutboundApproval(outboxRowId: string): void {
  const r = runtime()
  r.approvals = r.approvals.filter((a) => a.outboxRowId !== outboxRowId)
}

export function disarmAllOutboundApprovals(): void {
  runtime().approvals = []
}

/** For diagnostics. Returns full approvals including payload hash —
 *  do NOT expose this over the wire to clients. */
export function _internalListApprovals(): OutboundApproval[] {
  return runtime().approvals.slice()
}
