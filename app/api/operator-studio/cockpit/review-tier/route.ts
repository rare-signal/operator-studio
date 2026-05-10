/**
 * POST /api/operator-studio/cockpit/review-tier
 *
 * Body: { agentId: string, action: "human-approve" | "berthier-ack" | "send-back",
 *         reason?: string, detach?: boolean }
 *
 * Drives the multi-tier review state machine (see
 * kb-2026-05-10-multi-tier-review-state-machine) from the cockpit
 * UI. Mirrors the CLI verbs:
 *   - human-approve   → setHumanApprovedAt; if detach=true, also retires
 *   - berthier-ack    → setBerthierReviewedAt (no detach)
 *   - send-back       → clears berthier_reviewed_at on the active
 *                        binding so the worker drops back to
 *                        candidate-self-believed (the "send back for
 *                        revision" affordance — Berthier needs to
 *                        re-look). Does NOT mutate the worker thread.
 */

import { NextResponse, type NextRequest } from "next/server"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  detachThreadCardBinding,
  setBerthierReviewedAt,
  setHumanApprovedAt,
} from "@/lib/operator-studio/thread-card-bindings"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"
import { and, eq, isNull } from "drizzle-orm"
import { getDb } from "@/lib/server/db/client"
import { operatorThreadCardBindings } from "@/lib/server/db/schema"

export const dynamic = "force-dynamic"

interface Body {
  agentId?: string
  action?: "human-approve" | "berthier-ack" | "send-back"
  reason?: string
  detach?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.agentId || !body.action) {
    return NextResponse.json(
      { error: "agentId and action required" },
      { status: 400 }
    )
  }
  const workspaceId = await getActiveWorkspaceId()

  if (body.action === "human-approve") {
    if (body.detach) {
      const ok = await detachThreadCardBinding(workspaceId, body.agentId, {
        reason: body.reason ?? null,
        humanApproved: true,
      })
      return NextResponse.json({ ok, action: "human-approve+detach" })
    }
    const ok = await setHumanApprovedAt(workspaceId, body.agentId, body.reason)
    return NextResponse.json({ ok, action: "human-approve" })
  }
  if (body.action === "berthier-ack") {
    const ok = await setBerthierReviewedAt(workspaceId, body.agentId, body.reason)
    return NextResponse.json({ ok, action: "berthier-ack" })
  }
  if (body.action === "send-back") {
    // Clear the Berthier ack so the binding drops back to
    // candidate-self-believed. Worker thread is untouched — David
    // should follow up via the cockpit chat.
    const db = getDb()
    const updated = await db
      .update(operatorThreadCardBindings)
      .set({ berthierReviewedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(operatorThreadCardBindings.workspaceId, workspaceId),
          eq(operatorThreadCardBindings.agentId, body.agentId),
          isNull(operatorThreadCardBindings.detachedAt)
        )
      )
      .returning({ id: operatorThreadCardBindings.id })
    return NextResponse.json({ ok: updated.length > 0, action: "send-back" })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
