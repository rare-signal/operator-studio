/**
 * GET /api/operator-studio/agents/desktop-lease
 *
 * Reads the current desktop-control micro-lease state. Polled by the
 * shell-level UI indicator so the operator sees "Operator controlling
 * Claude — 2.1s" while AppleScript keystrokes are firing.
 *
 * No write side: leases are acquired/released by the server-side GUI
 * automation paths (currently new-session). The read is auth-gated to
 * the same surface as the rest of the agents API; we don't expose
 * frontmost-process info or lease purpose to unauthenticated callers.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getDesktopLeaseSnapshot } from "@/lib/server/agent-bridge/desktop-lease"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  return NextResponse.json(getDesktopLeaseSnapshot())
}
