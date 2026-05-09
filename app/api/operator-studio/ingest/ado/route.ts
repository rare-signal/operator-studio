/**
 * POST /api/operator-studio/ingest/ado
 *
 * Body: { factoryId: string }
 *
 * One-tick ADO poll for the named factory. Returns counts of items
 * seen / rows ingested / duplicates skipped / errors. Read-only:
 * touches `operator_inbox_events` (write side) but never makes
 * outbound calls to ADO beyond the read-only `az boards query`.
 *
 * Not gated by hot-mode or the outbound PIN gate — read-only ingest
 * is always allowed (per pattern-inbox-ingest tier 1).
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { pollAdoForFactory } from "@/lib/operator-studio/ingest/ado-poller"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  const body = (await req.json().catch(() => null)) as null | {
    factoryId?: unknown
  }
  const factoryId =
    body && typeof body.factoryId === "string" ? body.factoryId : ""
  if (!factoryId) {
    return NextResponse.json({ error: "factoryId required" }, { status: 400 })
  }
  const result = await pollAdoForFactory(workspaceId, factoryId)
  return NextResponse.json(result)
}
