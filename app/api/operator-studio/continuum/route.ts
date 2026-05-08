import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest, getDisplayName } from "@/lib/operator-studio/auth"
import {
  createContinuum,
  getLatestContinuumForThread,
} from "@/lib/operator-studio/continuum"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/** POST /api/operator-studio/continuum — mint a fresh-agent handoff
 *  for a thread. Body: { threadId: string, reuseLatest?: boolean }.
 *  When `reuseLatest` is true, returns the most recent existing
 *  Continuum for that thread instead of minting a duplicate. */
export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok)
    return NextResponse.json({ error: auth.reason }, { status: 401 })

  const body = (await req.json().catch(() => null)) as
    | Record<string, unknown>
    | null
  if (!body || typeof body !== "object" || typeof body.threadId !== "string") {
    return NextResponse.json(
      { error: "Body required with `threadId` string" },
      { status: 400 }
    )
  }
  const reuseLatest = body.reuseLatest === true
  const workspaceId = await getActiveWorkspaceId()

  if (reuseLatest) {
    const existing = await getLatestContinuumForThread(workspaceId, body.threadId)
    if (existing) return NextResponse.json({ continuum: existing, reused: true })
  }

  const createdBy =
    (await getDisplayName().catch(() => null)) ??
    auth.identity ??
    "operator-studio"

  // Resolve a baseUrl for the break-glass link. The request's origin is
  // the right one for in-app paste-into-fresh-agent flows; we don't try
  // to be clever about external hosts.
  const origin = new URL(req.url).origin

  const continuum = await createContinuum({
    workspaceId,
    threadId: body.threadId,
    createdBy,
    baseUrl: origin,
  })
  if (!continuum)
    return NextResponse.json({ error: "Thread not found" }, { status: 404 })
  return NextResponse.json({ continuum, reused: false })
}
