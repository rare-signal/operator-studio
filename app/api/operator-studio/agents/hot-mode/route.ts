/**
 * GET  /api/operator-studio/agents/hot-mode  → current arming status
 * POST /api/operator-studio/agents/hot-mode  → arm or disarm
 *
 * Body (POST):
 *   { action: "arm",    pin: string, durationMs?: number }
 *   { action: "disarm" }
 *
 * Disarm is always allowed (failing safe is free). Arming requires the
 * PIN configured by `OPERATOR_STUDIO_HOT_MODE_PIN` (default "1010").
 * The arming window is capped server-side — no client can request a
 * 24-hour arm.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  armHotMode,
  disarmHotMode,
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
    | { action?: unknown; pin?: unknown; durationMs?: unknown }
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
  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
