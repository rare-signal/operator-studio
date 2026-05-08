import { NextResponse, type NextRequest } from "next/server"
import { and, eq, isNull } from "drizzle-orm"

import { authorizeRequest } from "@/lib/operator-studio/auth"
import { getDb } from "@/lib/server/db/client"
import {
  operatorPlanSteps,
  operatorThreadMessages,
} from "@/lib/server/db/schema"
import {
  getFulfillmentsForStep,
  getThreadById,
} from "@/lib/operator-studio/queries"
import { getActiveWorkspaceId } from "@/lib/operator-studio/workspaces"

export const dynamic = "force-dynamic"

/**
 * GET /api/operator-studio/plans/[id]/steps/[stepId]/evidence
 *
 * Returns the enriched evidence (fulfillments) for a single plan step.
 * Each item is typed (`thread` | `message`) and pre-resolved with the
 * display fields the modal needs — thread title + source app for thread
 * targets, role + preview + parent thread title for message targets.
 *
 * The shape is intentionally flat and self-contained: the modal renders
 * straight off this payload without any further lookups.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> }
) {
  const auth = await authorizeRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: 401 })
  }
  const { id: planId, stepId } = await ctx.params
  const workspaceId = await getActiveWorkspaceId()

  const db = getDb()

  // Verify the step belongs to this plan in this workspace before
  // surfacing any evidence — otherwise a stepId from another tenant
  // could leak through if planId/stepId are mismatched.
  const stepRow = await db
    .select({ id: operatorPlanSteps.id })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.id, stepId),
        eq(operatorPlanSteps.planId, planId),
        eq(operatorPlanSteps.workspaceId, workspaceId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
    .limit(1)
  if (stepRow.length === 0) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 })
  }

  const fulfillments = await getFulfillmentsForStep(workspaceId, stepId)

  // Resolve each fulfillment in parallel. Bounded by the count of
  // accepted evidence on this step (small in practice — a step with
  // 50 attached messages is a code-smell, not a normal case).
  const items = await Promise.all(
    fulfillments.map(async (f) => {
      if (f.targetType === "thread") {
        const thread = await getThreadById(workspaceId, f.targetId)
        return {
          kind: "thread" as const,
          fulfillmentId: f.id,
          targetId: f.targetId,
          threadId: f.targetId,
          title:
            thread?.promotedTitle ??
            thread?.rawTitle ??
            "Untitled thread",
          sourceApp: thread?.sourceApp ?? null,
          messageCount: thread?.messageCount ?? 0,
          note: f.note,
          promotedAt: f.promotedAt,
          promotedBy: f.promotedBy,
          missing: !thread,
        }
      }
      // message target — pull preview + parent-thread display data.
      const messageRows = await db
        .select({
          id: operatorThreadMessages.id,
          threadId: operatorThreadMessages.threadId,
          role: operatorThreadMessages.role,
          content: operatorThreadMessages.content,
          turnIndex: operatorThreadMessages.turnIndex,
        })
        .from(operatorThreadMessages)
        .where(
          and(
            eq(operatorThreadMessages.id, f.targetId),
            eq(operatorThreadMessages.workspaceId, workspaceId)
          )
        )
        .limit(1)
      const message = messageRows[0]
      const thread = message
        ? await getThreadById(workspaceId, message.threadId)
        : null
      return {
        kind: "message" as const,
        fulfillmentId: f.id,
        targetId: f.targetId,
        threadId: message?.threadId ?? null,
        threadTitle:
          thread?.promotedTitle ??
          thread?.rawTitle ??
          (message ? "Untitled thread" : null),
        role: message?.role ?? null,
        turnIndex: message?.turnIndex ?? null,
        // Trimmed preview for the chip; modal can show the full text
        // when expanded. Cap to keep the JSON small for steps with
        // many message-fulfillments.
        preview: message ? truncate(message.content, 280) : null,
        content: message?.content ?? null,
        note: f.note,
        promotedAt: f.promotedAt,
        promotedBy: f.promotedBy,
        missing: !message,
      }
    })
  )

  return NextResponse.json({ items })
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + "…"
}
