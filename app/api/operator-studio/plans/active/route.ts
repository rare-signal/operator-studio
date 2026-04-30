import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { getActivePlan } from "@/lib/operator-studio/plans"
import {
  ensureSessionsForWorkspace,
  getSessionsForWorkspace,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/plans/active — resolve (and, if needed,
 * auto-create) the active plan for the workspace. See the three-rule
 * resolver in lib/operator-studio/plans.ts.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  try {
    const workspaceId = await getActiveWorkspaceId()
    // Make sure sessions are up to date so the "current session" lookup
    // inside getActivePlan reflects recent activity.
    await ensureSessionsForWorkspace(workspaceId)
    const sessions = await getSessionsForWorkspace(workspaceId)
    const currentSessionId = sessions[0]?.id ?? null
    const reviewer = auth.identity ?? (await getDisplayName()) ?? "unknown"
    const plan = await getActivePlan(workspaceId, currentSessionId, reviewer)
    return NextResponse.json({ plan })
  } catch (e) {
    console.error("[plans/active] failed:", e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 }
    )
  }
}
