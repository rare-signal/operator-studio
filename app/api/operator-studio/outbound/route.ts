/**
 * GET  /api/operator-studio/outbound          → list current per-row approvals
 * POST /api/operator-studio/outbound          → approve / disarm
 *
 * Body (POST) for approval:
 *   {
 *     action: "approve",
 *     pin: string,
 *     outboxRowId: string,
 *     payloadHash: string,       // hex sha256 of canonical-JSON payload
 *     surface: "ado" | "teams" | ...,
 *     action_kind: string,       // e.g. "ado.addComment"
 *     targetId: string,
 *     durationMs?: number
 *   }
 *
 * Body (POST) for disarm:
 *   { action: "disarm", outboxRowId: string }   // disarm one row
 *   { action: "disarm-all" }                    // disarm everything
 *
 * Why the dance:
 * - Approval requires the PIN AND the exact (outboxRowId, payloadHash,
 *   surface, action, targetId). Editing the row clears the approval.
 * - The same payloadHash will be recomputed at send time from the
 *   actual bytes about to leave the machine — a different payload
 *   cannot consume a stale approval.
 * - Disarming any approval requires no PIN (failing safe is free).
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  approveOutbound,
  disarmAllOutboundApprovals,
  disarmOutboundApproval,
  getOutboundStatus,
  type OutboundSurface,
} from "@/lib/server/agent-bridge/outbound-mode"

export const dynamic = "force-dynamic"

const KNOWN_SURFACES: OutboundSurface[] = [
  "ado",
  "teams",
  "preview_deploy",
  "email",
  "stakeholder_reply",
]

function isOutboundSurface(v: unknown): v is OutboundSurface {
  return typeof v === "string" && (KNOWN_SURFACES as string[]).includes(v)
}

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  return NextResponse.json(getOutboundStatus())
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as
    | {
        action?: unknown
        pin?: unknown
        outboxRowId?: unknown
        payloadHash?: unknown
        surface?: unknown
        action_kind?: unknown
        targetId?: unknown
        durationMs?: unknown
      }
    | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  if (body.action === "disarm-all") {
    disarmAllOutboundApprovals()
    return NextResponse.json(getOutboundStatus())
  }
  if (body.action === "disarm") {
    if (typeof body.outboxRowId !== "string" || !body.outboxRowId) {
      return NextResponse.json(
        { error: "disarm requires outboxRowId" },
        { status: 400 }
      )
    }
    disarmOutboundApproval(body.outboxRowId)
    return NextResponse.json(getOutboundStatus())
  }
  if (body.action === "approve") {
    const pin = typeof body.pin === "string" ? body.pin : ""
    const outboxRowId =
      typeof body.outboxRowId === "string" ? body.outboxRowId : ""
    const payloadHash =
      typeof body.payloadHash === "string" ? body.payloadHash : ""
    const targetId = typeof body.targetId === "string" ? body.targetId : ""
    const action_kind =
      typeof body.action_kind === "string" ? body.action_kind : ""
    const surface = body.surface
    if (
      !outboxRowId ||
      !payloadHash ||
      !targetId ||
      !action_kind ||
      !isOutboundSurface(surface)
    ) {
      return NextResponse.json(
        {
          error:
            "approve requires outboxRowId, payloadHash, surface, action_kind, targetId",
        },
        { status: 400 }
      )
    }
    const durationMs =
      typeof body.durationMs === "number" ? body.durationMs : undefined
    const r = approveOutbound({
      pin,
      outboxRowId,
      payloadHash,
      surface,
      action: action_kind,
      targetId,
      durationMs,
    })
    if (!r.ok) {
      const status = r.reason === "bad-pin" ? 401 : 400
      const message =
        r.reason === "bad-pin"
          ? "Incorrect PIN."
          : "Requested duration exceeds the server cap."
      return NextResponse.json(
        { error: message, reason: r.reason, ...getOutboundStatus() },
        { status }
      )
    }
    return NextResponse.json(getOutboundStatus())
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
