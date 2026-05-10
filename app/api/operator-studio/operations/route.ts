/**
 * GET /api/operator-studio/operations
 *
 * The single source of truth for the Operations control-loop view.
 * Loads everything Operations needs (active plan + agents + recent
 * activity + durable bindings + executive recommendations + open
 * review items), passes them through `deriveOperationsControlLoop`,
 * and returns the compact view the UI / Codex / future CLI all
 * consume.
 *
 * Optional query params:
 *   planId   override the resolved active plan
 *   limit    cap on returned recent activity items (default 24)
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { buildOperationsPayload } from "@/lib/operator-studio/operations-payload"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  const url = new URL(req.url)
  const planIdOverride = url.searchParams.get("planId")
  const limitRaw = Number(url.searchParams.get("limit") ?? 24)
  const limit = Math.max(
    4,
    Math.min(64, Number.isFinite(limitRaw) ? limitRaw : 24)
  )

  const workspaceId = await getActiveWorkspaceId().catch(() => "global")
  const manualLinksParam = url.searchParams.get("manualLinks")
  let manualLinks: Record<string, string> = {}
  if (manualLinksParam) {
    try {
      const parsed = JSON.parse(manualLinksParam)
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") manualLinks[k] = v
        }
      }
    } catch {
      manualLinks = {}
    }
  }

  const payload = await buildOperationsPayload({
    workspaceId,
    planId: planIdOverride,
    recentLimit: limit,
    manualLinks,
  })

  return NextResponse.json(payload)
}
