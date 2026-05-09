/**
 * GET /api/operator-studio/ingest/ado/scheduler
 *   Reports the in-process ADO background scheduler status.
 *   Read-only; no auth gate beyond authorizeRequest.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getAdoSchedulerStatus } from "@/lib/operator-studio/ingest/ado-scheduler"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  return NextResponse.json(getAdoSchedulerStatus())
}
