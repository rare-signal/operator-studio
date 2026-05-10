/**
 * DELETE /api/operator-studio/work-lanes/[id]/members/[kind]/[memberId]
 *   → 200 { ok: true }
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  removeLaneMember,
  type LaneMemberKind,
} from "@/lib/operator-studio/work-lanes"

export const dynamic = "force-dynamic"

const VALID_KINDS: ReadonlyArray<LaneMemberKind> = ["plan_step", "kb_entry"]

export async function DELETE(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; kind: string; memberId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id, kind, memberId } = await params
  if (!VALID_KINDS.includes(kind as LaneMemberKind)) {
    return NextResponse.json(
      { error: `kind must be one of ${VALID_KINDS.join(", ")}` },
      { status: 400 }
    )
  }
  await removeLaneMember(id, kind as LaneMemberKind, memberId)
  return NextResponse.json({ ok: true })
}
