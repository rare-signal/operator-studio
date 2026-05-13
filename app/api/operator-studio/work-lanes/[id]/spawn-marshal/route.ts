/**
 * POST /api/operator-studio/work-lanes/[id]/spawn-marshal
 *   body: { profile: 'manual' | 'auto-ai',
 *           rubric?: string,
 *           intervalMinutes?: number,
 *           surface?: SurfaceKind }
 *   → 200 { ok: true, marshal }
 *   → 409 if a Marshal already exists for this lane
 *
 * Spawns the lane's Marshal — the field-commander tier between Berthier
 * and the workers. See `lib/operator-studio/marshal.ts` for behavior.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  spawnMarshalForLane,
  MarshalAlreadyExistsError,
  type MarshalProfile,
} from "@/lib/operator-studio/marshal"
import type { SurfaceKind } from "@/lib/server/agent-bridge/surfaces"

export const dynamic = "force-dynamic"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id: laneId } = await params
  const body = (await req.json().catch(() => null)) as {
    profile?: string
    rubric?: string
    intervalMinutes?: number
    surface?: string
  } | null

  const profile = body?.profile === "auto-ai" ? "auto-ai" : "manual"
  const intervalMinutes =
    typeof body?.intervalMinutes === "number" && body.intervalMinutes > 0
      ? Math.floor(body.intervalMinutes)
      : null
  if (profile === "auto-ai" && intervalMinutes === null) {
    return NextResponse.json(
      { error: "intervalMinutes required for profile=auto-ai" },
      { status: 400 }
    )
  }
  const surface: SurfaceKind | undefined =
    body?.surface === "claude-cli" || body?.surface === "codex-cli"
      ? (body.surface as SurfaceKind)
      : undefined

  try {
    const marshal = await spawnMarshalForLane(laneId, {
      profile: profile as MarshalProfile,
      rubric: body?.rubric ?? null,
      intervalMinutes,
      surface,
      createdBy: auth.identity ?? null,
    })
    return NextResponse.json({ ok: true, marshal })
  } catch (e) {
    if (e instanceof MarshalAlreadyExistsError) {
      return NextResponse.json(
        { error: e.message, existingAgentId: e.existingAgentId },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
