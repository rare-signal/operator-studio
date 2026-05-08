import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  createLabel,
  listLabels,
} from "@/lib/operator-studio/promotion-labels"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** GET /api/operator-studio/promotion-labels — list active labels. */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const url = new URL(req.url)
  const includeArchived = url.searchParams.get("includeArchived") === "1"
  const workspaceId = await getActiveWorkspaceId()
  const labels = await listLabels(workspaceId, { includeArchived })
  return NextResponse.json({ labels })
}

/** POST /api/operator-studio/promotion-labels — create a label. */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null
  if (!body || typeof body !== "object" || typeof body.label !== "string") {
    return NextResponse.json(
      { error: "Body required with `label` string" },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()
  const label = await createLabel(workspaceId, {
    label: body.label,
    aiContext:
      typeof body.aiContext === "string" ? body.aiContext : undefined,
    icon: typeof body.icon === "string" ? body.icon : null,
    color: typeof body.color === "string" ? body.color : null,
    sortIndex:
      typeof body.sortIndex === "number" ? body.sortIndex : undefined,
  })
  return NextResponse.json({ label })
}
