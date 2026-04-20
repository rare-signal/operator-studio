import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { findRelatedThreads } from "@/lib/operator-studio/queries/related"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const { threadId } = await params

  const url = new URL(req.url)
  const rawLimit = url.searchParams.get("limit")
  const parsedLimit = rawLimit ? parseInt(rawLimit, 10) : 5
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, 20)
      : 5

  const related = await findRelatedThreads(workspaceId, threadId, limit)
  return NextResponse.json({ related })
}
