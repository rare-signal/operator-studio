import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  ensureSessionsForWorkspace,
  getSessionsForWorkspace,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/sessions
 *
 * Returns all sessions for the active workspace. Before returning,
 * runs `ensureSessionsForWorkspace` to materialize any new session
 * boundaries from recent activity — idempotent, so calling this on
 * every page load is safe.
 *
 * The polling dashboard in Phase 3 will hit this on an interval; for
 * now Phase 1 just (re)materializes on demand.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  await ensureSessionsForWorkspace(workspaceId)
  const sessions = await getSessionsForWorkspace(workspaceId)

  return NextResponse.json({
    sessions,
    count: sessions.length,
  })
}
