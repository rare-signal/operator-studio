/**
 * GET /api/operator-studio/ado/[id]
 *
 * Keyed-intake bundle (L5) for a single ADO work-item id. Read-only.
 * Same shape as `pnpm os:ado <id>` and the `ado_lookup` MCP tool.
 *
 * Query params:
 *   ?format=text|json   default json
 *   ?comments=N         override comment limit
 *   ?gitLog=N           override git log limit
 */

import { NextResponse, type NextRequest } from "next/server"

import {
  buildAdoIntakeBundle,
  renderAdoIntakeBundle,
} from "@/lib/operator-studio/ado-keyed-intake"
import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

function parsePositiveInt(v: string | null): number | undefined {
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id } = await ctx.params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json(
      { error: "id must be a numeric ADO work-item id" },
      { status: 400 }
    )
  }
  const url = new URL(req.url)
  const format = url.searchParams.get("format") === "text" ? "text" : "json"
  const commentLimit = parsePositiveInt(url.searchParams.get("comments"))
  const gitLogLimit = parsePositiveInt(url.searchParams.get("gitLog"))
  const workspaceId = await getActiveWorkspaceId()

  try {
    const bundle = await buildAdoIntakeBundle(workspaceId, id, {
      commentLimit,
      gitLogLimit,
    })
    if (format === "text") {
      return new NextResponse(renderAdoIntakeBundle(bundle), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    }
    return NextResponse.json({ bundle })
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    )
  }
}
