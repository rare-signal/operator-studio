import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  approveOutbound,
  consumeOutboundApproval,
  disarmAllOutboundApprovals,
  disarmOutboundApproval,
  getOutboundStatus,
  _internalListApprovals,
} from "./outbound-mode"

const PIN = "1010"

const baseIntent = {
  outboxRowId: "outbox-row-1",
  payloadHash: "hash-A",
  surface: "ado" as const,
  action: "ado.addComment",
  targetId: "39",
}

beforeEach(() => {
  disarmAllOutboundApprovals()
  delete process.env.OPERATOR_STUDIO_OUTBOUND_PIN
  delete process.env.OPERATOR_STUDIO_HOT_MODE_PIN
})

afterEach(() => {
  disarmAllOutboundApprovals()
})

describe("outbound-mode — gate primitive", () => {
  it("rejects send when no approval has been arm-ed", () => {
    const r = consumeOutboundApproval(baseIntent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("not-approved")
  })

  it("rejects approval with a wrong PIN", () => {
    const r = approveOutbound({ pin: "9999", ...baseIntent })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("bad-pin")
  })

  it("approves and then consumes a matching intent exactly once", () => {
    const a = approveOutbound({ pin: PIN, ...baseIntent })
    expect(a.ok).toBe(true)

    const c1 = consumeOutboundApproval(baseIntent)
    expect(c1.ok).toBe(true)

    // Single-use: a second consume for the same row fails as not-approved.
    const c2 = consumeOutboundApproval(baseIntent)
    expect(c2.ok).toBe(false)
    if (!c2.ok) expect(c2.reason).toBe("not-approved")
  })

  it("rejects a consume whose payloadHash differs from the approved hash", () => {
    approveOutbound({ pin: PIN, ...baseIntent })
    const r = consumeOutboundApproval({ ...baseIntent, payloadHash: "hash-B" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("payload-mismatch")
  })

  it("rejects a consume whose targetId differs from the approved target", () => {
    approveOutbound({ pin: PIN, ...baseIntent })
    const r = consumeOutboundApproval({ ...baseIntent, targetId: "40" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("target-mismatch")
  })

  it("rejects a consume whose surface or action differ", () => {
    approveOutbound({ pin: PIN, ...baseIntent })
    const r1 = consumeOutboundApproval({ ...baseIntent, surface: "teams" })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.reason).toBe("target-mismatch")

    // Re-approve since the prior consume did not consume.
    approveOutbound({ pin: PIN, ...baseIntent })
    const r2 = consumeOutboundApproval({
      ...baseIntent,
      action: "ado.updateState",
    })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.reason).toBe("target-mismatch")
  })

  it("re-approving the same row replaces the prior approval (after edit)", () => {
    approveOutbound({ pin: PIN, ...baseIntent })
    expect(_internalListApprovals().length).toBe(1)

    // Operator edits the rendered text → outbox row computes a new
    // payloadHash → re-approve.
    approveOutbound({ pin: PIN, ...baseIntent, payloadHash: "hash-EDITED" })
    expect(_internalListApprovals().length).toBe(1)
    expect(_internalListApprovals()[0]!.payloadHash).toBe("hash-EDITED")

    // The OLD hash can no longer consume.
    const r = consumeOutboundApproval(baseIntent)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("payload-mismatch")
  })

  it("expires after the duration cap and reports expired", () => {
    // 1ms duration → already expired by the time we consume.
    approveOutbound({ pin: PIN, durationMs: 1, ...baseIntent })
    // Wait one tick to ensure now > expiresAtMs.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const r = consumeOutboundApproval(baseIntent)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toBe("expired")
        resolve()
      }, 5)
    })
  })

  it("disarmOutboundApproval(rowId) drops only that row's approval", () => {
    approveOutbound({ pin: PIN, ...baseIntent })
    approveOutbound({
      pin: PIN,
      ...baseIntent,
      outboxRowId: "outbox-row-2",
      targetId: "40",
    })
    expect(_internalListApprovals().length).toBe(2)

    disarmOutboundApproval("outbox-row-1")
    const remaining = _internalListApprovals()
    expect(remaining.length).toBe(1)
    expect(remaining[0]!.outboxRowId).toBe("outbox-row-2")
  })

  it("rejects an arming duration above the max", () => {
    const r = approveOutbound({
      pin: PIN,
      ...baseIntent,
      durationMs: 60 * 60 * 1000, // 1 hour > 15 min cap
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("duration-too-large")
  })

  it("status omits payloadHash from the wire shape", () => {
    approveOutbound({ pin: PIN, ...baseIntent })
    const status = getOutboundStatus()
    expect(status.approvals.length).toBe(1)
    const a = status.approvals[0]! as Record<string, unknown>
    expect(a.payloadHash).toBeUndefined()
    expect(a.outboxRowId).toBe(baseIntent.outboxRowId)
  })
})
