/**
 * GET /api/operator-studio/cockpit/spawned-by?exec=<agentId>
 *
 * Returns the composite agent ids of active bindings whose
 * `spawned_by_agent_id` matches the provided executive agent id.
 * The cockpit-client uses this to filter the global agents list down
 * to "workers spawned by this exec lane" — authoritative, no heuristic.
 *
 * Returns { agentIds: string[] }. Empty array if no spawn-linkage
 * records exist for this exec yet (expected before the first spawn).
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveBindingsSpawnedBy } from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const exec = req.nextUrl.searchParams.get("exec")?.trim()
  if (!exec) {
    return NextResponse.json({ error: "exec required" }, { status: 400 })
  }
  const workspaceId = await getActiveWorkspaceId()
  const bindings = await getActiveBindingsSpawnedBy(workspaceId, exec)
  const agentIds = Array.from(new Set(bindings.map((b) => b.agentId)))
  return NextResponse.json({ agentIds })
}
