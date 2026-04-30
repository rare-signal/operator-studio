import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import type { ThreadRollup } from "@/lib/operator-studio/wayseer/contracts/thread-rollup"
import { getLatestEnrichmentForThreadByContractPrefix } from "@/lib/operator-studio/wayseer/queries"
import { startThreadRollup } from "@/lib/operator-studio/wayseer/rollup-runner"
import {
  EmptyThreadError,
  ThreadNotFoundError,
  WayseerNotConfiguredError,
} from "@/lib/operator-studio/wayseer/runner"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/wayseer/threads/[threadId]/rollup
 *
 * Returns the latest rollup-shaped enrichment row for the given
 * thread (any status — running / completed / failed). Filters by
 * `contract_version LIKE 'thread-rollup@%'` so a row produced by the
 * v1 thread-analysis contract on the same table is never returned.
 *
 * Returns `{ enrichment: null }` (200) when no rollup exists yet —
 * the UI uses that to render the "generate first rollup" affordance.
 */
export async function GET(
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
  const enrichment =
    await getLatestEnrichmentForThreadByContractPrefix<ThreadRollup>(
      workspaceId,
      threadId,
      "thread-rollup@"
    )
  return NextResponse.json({ enrichment })
}

/**
 * POST /api/operator-studio/wayseer/threads/[threadId]/rollup
 *
 * Kicks off a two-stage planner→writer rollup. Returns immediately
 * with a `running` enrichment row; the UI polls the GET endpoint
 * until the row flips to `completed` or `failed`.
 *
 * Honors a `force=true` query string to bypass the content-hash
 * short-circuit. Without `force`, the runner will return the
 * existing completed row (with a `reused: true` flag in the
 * response body) when the thread shape hasn't changed since the
 * last rollup — that's the cost gate that makes pulse-driven
 * enrichment viable.
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

  const url = new URL(req.url)
  const force = url.searchParams.get("force") === "1"
  const workspaceId = await getActiveWorkspaceId()

  try {
    const { enrichment, reused } = await startThreadRollup({
      workspaceId,
      threadId,
      force,
    })
    return NextResponse.json(
      { enrichment, reused },
      { status: reused ? 200 : 202 }
    )
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
      error instanceof Error ? error.message : "Failed to start rollup"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
