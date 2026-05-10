/**
 * GET  /api/operator-studio/agents/hot-mode  → current arming status
 * POST /api/operator-studio/agents/hot-mode  → arm, disarm, or extend
 *
 * Body (POST):
 *   { action: "arm",    pin: string, durationMs?: number }
 *   { action: "disarm" }
 *   { action: "extend", extraMs: number }
 *
 * Disarm is always allowed (failing safe is free). Arming requires the
 * PIN configured by `OPERATOR_STUDIO_HOT_MODE_PIN` (default "1010").
 * Extend is PIN-free (operator is already at the cockpit, plastic
 * cover already up) but requires the system to currently be armed —
 * extend isn't a back-door arm path.
 *
 * The arming window is capped server-side — no client can request or
 * extend past the server cap.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  armHotMode,
  disarmHotMode,
  extendHotMode,
  getHotModeStatus,
} from "@/lib/server/agent-bridge/hot-mode"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  return NextResponse.json(getHotModeStatus())
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; pin?: unknown; durationMs?: unknown; extraMs?: unknown }
    | null
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body required" }, { status: 400 })
  }
  if (body.action === "disarm") {
    disarmHotMode()
    return NextResponse.json(getHotModeStatus())
  }
  if (body.action === "arm") {
    const pin = typeof body.pin === "string" ? body.pin : ""
    const durationMs =
      typeof body.durationMs === "number" ? body.durationMs : undefined
    const r = armHotMode(pin, durationMs)
    if (!r.ok) {
      const status = r.reason === "bad-pin" ? 401 : 400
      const message =
        r.reason === "bad-pin"
          ? "Incorrect PIN."
          : "Requested duration exceeds the server cap."
      return NextResponse.json(
        { error: message, reason: r.reason, ...getHotModeStatus() },
        { status }
      )
    }
    return NextResponse.json(getHotModeStatus())
  }
  if (body.action === "extend") {
    const extraMs = typeof body.extraMs === "number" ? body.extraMs : NaN
    const r = extendHotMode(extraMs)
    if (!r.ok) {
      const status = r.reason === "not-armed" ? 409 : 400
      const message =
        r.reason === "not-armed"
          ? "Not currently armed — arm with PIN first."
          : "Invalid extend duration."
      return NextResponse.json(
        { error: message, reason: r.reason, ...getHotModeStatus() },
        { status }
      )
    }
    return NextResponse.json({ ...getHotModeStatus(), clamped: r.clamped })
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
