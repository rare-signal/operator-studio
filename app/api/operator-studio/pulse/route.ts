import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import {
  loadPulseGraph,
  getPulseFreshness,
  selectorFromQuery,
} from "@/app/2/v2/data/load-pulse"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/pulse
 *
 * Returns the Pulse graph for the active workspace as JSON. Hot path for
 * the client's live poll — way cheaper than `router.refresh()`, which
 * re-executes every RSC on the route and re-loads the sidebar's
 * thread list.
 *
 * Freshness fast-path:
 *   The client can pass `?sinceVer=<version>` (we set a cache-control
 *   freshness version string on each build). When the current freshness
 *   matches, we return 304 Not Modified — the poll is a single cheap
 *   MAX(created_at) roundtrip to Postgres and no payload over the wire.
 *
 * On a cold/mutated request, the loader builds fresh and the response
 * includes the new freshness token for the next poll.
 */
export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const sinceVer = req.nextUrl.searchParams.get("sinceVer")
  const selector = selectorFromQuery({
    sessionId: req.nextUrl.searchParams.get("sessionId"),
    fromSessionId: req.nextUrl.searchParams.get("fromSessionId"),
    toSessionId: req.nextUrl.searchParams.get("toSessionId"),
  })

  // Fast-path: cheap freshness probe (MAX(created_at) on messages +
  // session bounds). If the client already has this version, 304.
  const freshness = await getPulseFreshness(workspaceId, selector).catch(
    () => null
  )

  if (sinceVer && freshness && sinceVer === freshness.version) {
    // 304-style "nothing new" — return an empty body the client knows
    // to treat as "keep current graph." We avoid 304 itself because
    // fetch() auto-follows cached responses unpredictably.
    return NextResponse.json(
      {
        unchanged: true,
        version: freshness.version,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Pulse-Version": freshness.version,
        },
      }
    )
  }

  // Rebuild the graph. The loader itself memoizes within a process
  // window, so rapid consecutive builds hit the cache. The selector
  // (single id, range, or default) tracks whichever scope the
  // client is viewing.
  const graph = await loadPulseGraph(workspaceId, selector).catch(() => null)

  return NextResponse.json(
    {
      unchanged: false,
      version: freshness?.version ?? "unknown",
      graph,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        ...(freshness?.version
          ? { "X-Pulse-Version": freshness.version }
          : {}),
      },
    }
  )
}
