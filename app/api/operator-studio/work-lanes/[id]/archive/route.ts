/**
 * POST /api/operator-studio/work-lanes/[id]/archive
 *   → 200 { ok: true, lane }
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { archiveWorkLane } from "@/lib/operator-studio/work-lanes"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id } = await params
  const lane = await archiveWorkLane(id)
  if (!lane) {
    return NextResponse.json({ error: "lane not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, lane })
}
