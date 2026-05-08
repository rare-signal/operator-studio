import "server-only"

import { createHash } from "node:crypto"

import {
  consumeOutboundApproval,
  type OutboundSurface,
} from "@/lib/server/agent-bridge/outbound-mode"

/**
 * Server-side gate that every outbound writer (ADO comment, Teams post,
 * stakeholder reply, preview-deploy URL handoff, …) MUST call as its
 * first line.
 *
 * The gate itself does not consult the request, the route, or any UI
 * state. It consults the in-memory armed-approvals state only — the
 * one source of truth set by `approveOutbound()` when David clicks
 * Approve on the per-outbox-row preview page (see
 * `pattern-outbox-staging` + `pattern-outbound-pin-gate`).
 *
 * There is no env-var bypass. There is no test-mode skip. Tests that
 * need to exercise outbound writers without arming must call the
 * arming primitive directly (`approveOutbound(...)`).
 */

export type { OutboundSurface }

export interface OutboundIntent {
  surface: OutboundSurface
  /** e.g. "ado.addComment", "teams.postMessage". */
  action: string
  /** ADO work-item id, Teams channel id, etc. */
  targetId: string
  /** The exact bytes about to be sent. The gate hashes this and
   *  compares to the hash bound at approval time. */
  payload: unknown
  /** FK into operator_outbox_messages. */
  outboxRowId: string
  /** LLM-supplied reason this needs to go out — recorded in audit. */
  rationale: string
}

export class OutboundNotArmedError extends Error {
  constructor(public readonly intent: OutboundIntent) {
    super(
      `Outbound not armed for outbox row ${intent.outboxRowId} — David must approve this specific row before send.`
    )
    this.name = "OutboundNotArmedError"
  }
}

export class OutboundIntentMismatchError extends Error {
  constructor(
    public readonly intent: OutboundIntent,
    public readonly reason: "expired" | "payload-mismatch" | "target-mismatch"
  ) {
    super(
      `Outbound approval for outbox row ${intent.outboxRowId} does not match this send: ${reason}.`
    )
    this.name = "OutboundIntentMismatchError"
  }
}

/**
 * Canonical hash of an outbound payload. Stable JSON serialization so
 * approval at time T and consume at time T+ε produce the same digest.
 */
export function hashOutboundPayload(payload: unknown): string {
  const canonical = canonicalJson(payload)
  return createHash("sha256").update(canonical).digest("hex")
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const parts = keys.map(
    (k) =>
      `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`
  )
  return `{${parts.join(",")}}`
}

/**
 * Throws if the current process does not hold an armed approval that
 * matches this exact intent. Single-use — a successful call consumes
 * the approval.
 *
 * Every outbound writer's first line:
 *
 *   await assertOutboundArmed({surface, action, targetId, payload,
 *                              outboxRowId, rationale})
 */
export async function assertOutboundArmed(intent: OutboundIntent): Promise<void> {
  const payloadHash = hashOutboundPayload(intent.payload)
  const result = consumeOutboundApproval({
    outboxRowId: intent.outboxRowId,
    payloadHash,
    surface: intent.surface,
    action: intent.action,
    targetId: intent.targetId,
  })
  if (result.ok) return
  if (result.reason === "not-approved") {
    throw new OutboundNotArmedError(intent)
  }
  throw new OutboundIntentMismatchError(intent, result.reason)
}
