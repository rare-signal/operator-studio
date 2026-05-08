import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import { isKbEnabled, setKbEnabled } from "@/lib/operator-studio/knowledge"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/knowledge/module — is KB enabled here? */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const workspaceId = await getActiveWorkspaceId()
  return NextResponse.json({
    workspaceId,
    enabled: await isKbEnabled(workspaceId),
  })
}

/** POST /api/operator-studio/knowledge/module — enable/disable. */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const body = (await req.json().catch(() => null)) as
    | { enabled?: boolean }
    | null
  const workspaceId = await getActiveWorkspaceId()
  const display = (await getDisplayName().catch(() => null)) ?? "operator"
  await setKbEnabled(workspaceId, Boolean(body?.enabled), display)
  return NextResponse.json({
    workspaceId,
    enabled: Boolean(body?.enabled),
  })
}
