/**
 * GET  /api/operator-studio/work-lanes/[id]/members
 *   → { members: WorkLaneMember[] }
 *
 * POST /api/operator-studio/work-lanes/[id]/members
 *   body: { memberKind: "plan_step" | "kb_entry", memberId: string }
 *   → 200 { ok: true, member }
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  addLaneMember,
  listLaneMembers,
  type LaneMemberKind,
} from "@/lib/operator-studio/work-lanes"

export const dynamic = "force-dynamic"

const VALID_KINDS: ReadonlyArray<LaneMemberKind> = ["plan_step", "kb_entry"]

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id } = await params
  const members = await listLaneMembers(id)
  return NextResponse.json({ members })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id } = await params
  const body = (await req.json().catch(() => null)) as {
    memberKind?: string
    memberId?: string
  } | null
  const kind = body?.memberKind as LaneMemberKind | undefined
  const memberId = body?.memberId?.trim()
  if (!kind || !VALID_KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `memberKind must be one of ${VALID_KINDS.join(", ")}` },
      { status: 400 }
    )
  }
  if (!memberId) {
    return NextResponse.json({ error: "memberId required" }, { status: 400 })
  }
  const member = await addLaneMember(id, kind, memberId)
  return NextResponse.json({ ok: true, member })
}
