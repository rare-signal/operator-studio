import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import {
  getSessionById,
  updatePlanSteps,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

const planSchema = z.object({
  steps: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        title: z.string().trim().min(1).max(256),
        description: z.string().trim().max(4096).optional(),
        order: z.number().int(),
      })
    )
    .max(64),
})

/**
 * PUT /api/operator-studio/sessions/[sessionId]/plan
 *
 * @deprecated Writes to the legacy `operator_sessions.plan_steps`
 * jsonb column. The plan model has moved to durable plans (see
 * `operator_plans` + `operator_plan_steps`, migration 0007). All
 * plan-related UI now reads from the new tables via the resolver
 * in `lib/operator-studio/plans.ts`.
 *
 * The only remaining caller is the session-detail page's plan
 * editor at /operator-studio/sessions/[sessionId]. That UI still
 * works, but it edits a parallel store from the rest of the studio.
 * Replace with calls to the plan-scoped endpoints
 * (`/api/operator-studio/plans/[id]/steps/[stepId]` and friends)
 * and remove this route.
 *
 * Originally documented as: "Replace the session's plan step list
 * atomically. Client sends the full new list; preserving step ids
 * across edits keeps existing fulfillments attached."
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }

  // Loud breadcrumb so this gets noticed on the next refactor pass.
  console.warn(
    "[deprecated] PUT /api/operator-studio/sessions/:id/plan was called. " +
      "Migrate to the plan-scoped endpoints (operator_plans / operator_plan_steps)."
  )

  const workspaceId = await getActiveWorkspaceId()
  const { sessionId } = await params
  const raw = await req.json().catch(() => null)
  const parsed = planSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const existing = await getSessionById(workspaceId, sessionId)
  if (!existing) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  // Re-normalize order so holes/gaps don't leak through to the UI.
  // Fill in defaults for the new step fields — this legacy endpoint
  // only takes title/description/order; tree/layout fields default
  // to top-level + grid-layout fallback.
  const normalized = [...parsed.data.steps]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      ...s,
      order: i,
      status: "open" as const,
      parentStepId: null,
      positionX: null,
      positionY: null,
      coverImageUrl: null,
    }))

  await updatePlanSteps(workspaceId, sessionId, normalized)
  return NextResponse.json({ ok: true, steps: normalized })
}
