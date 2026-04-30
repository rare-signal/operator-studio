import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  EmptyThreadError,
  ThreadNotFoundError,
  WayseerNotConfiguredError,
  startThreadAnalysis,
} from "@/lib/operator-studio/wayseer/runner"

export const dynamic = "force-dynamic"

/**
 * POST /api/operator-studio/wayseer/threads/[threadId]/analyze
 *
 * Kicks off a thread-analysis run. Returns 202 with a `running`
 * enrichment row immediately; the frontend polls the GET endpoint
 * (`…/analysis`) to learn when the row flips to completed/failed.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const { threadId } = await params
  if (!threadId.trim()) {
    return NextResponse.json({ error: "threadId required" }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()

  try {
    const enrichment = await startThreadAnalysis({ workspaceId, threadId })
    return NextResponse.json({ enrichment }, { status: 202 })
  } catch (error) {
    if (error instanceof WayseerNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 412 })
    }
    if (error instanceof ThreadNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    if (error instanceof EmptyThreadError) {
      return NextResponse.json({ error: error.message }, { status: 422 })
    }
    const message =
      error instanceof Error ? error.message : "Failed to start analysis"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
