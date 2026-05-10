/**
 * MCP tools for active work context, plan inventory, and the David
 * review queue.
 *
 * `work_active_context` is the agent's first call before any write —
 * it answers "where am I?" deterministically (active plan + step,
 * bound agents, related KB, open review count, cross-plan bridges).
 *
 * `plan_inventory` is the second call before creating a plan — it
 * surfaces sprawl signals (empty / stale / abandoned) and duplicate
 * candidates so the agent can route an idea to an existing plan
 * rather than spawning a new one.
 *
 * `review_queue` projects David's review bucket by category. Read-only
 * here; mutation lives in HTTP routes (`/review-items/[id]`).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

import { getActiveWorkContext } from "@/lib/operator-studio/active-work-context"
import { getDavidReviewQueue } from "@/lib/operator-studio/david-review-queue"
import {
  getPlanInventory,
  proposeMergePruneReview,
} from "@/lib/operator-studio/plan-inventory"

import type { McpContext } from "../context.js"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  }
}

function renderActiveWorkContext(
  ctx: Awaited<ReturnType<typeof getActiveWorkContext>>
): string {
  const lines: string[] = []
  lines.push(`# Active Work Context — workspace ${ctx.workspaceId}`)
  lines.push(`Resolved at ${ctx.resolvedAt}`)
  lines.push("")
  lines.push(
    `## Plan: ${ctx.plan.title}  \`${ctx.plan.id}\` · state=${ctx.plan.state}${ctx.plan.pinned ? " · pinned" : ""}`
  )
  if (ctx.plan.goal) lines.push(`Goal: ${ctx.plan.goal}`)
  if (ctx.plan.outcome) lines.push(`Outcome: ${ctx.plan.outcome}`)
  const c = ctx.plan.stepCounts
  lines.push(
    `Steps: ${ctx.plan.totalSteps} total — ${c.open} open · ${c["in-motion"]} in-motion · ${c.covered} covered · ${c.skipped} skipped`
  )
  if (ctx.plan.activeStepId) {
    lines.push(
      `Active step: \`${ctx.plan.activeStepId}\` — ${ctx.plan.activeStepTitle ?? ""}`
    )
  } else {
    lines.push(`Active step: (none — plan has no in-motion or open step)`)
  }

  lines.push("")
  lines.push(`## Routing default`)
  lines.push(
    `workspace=${ctx.routing.workspaceId} plan=${ctx.routing.planId} step=${ctx.routing.defaultStepId ?? "(none)"}`
  )
  lines.push(
    `requireExplicitPlanId=${ctx.routing.requireExplicitPlanId} (silent cross-plan writes are blocked by convention)`
  )

  lines.push("")
  lines.push(`## Session`)
  if (ctx.session) {
    lines.push(
      `id=\`${ctx.session.id}\` started=${ctx.session.startedAt} planId=${ctx.session.planId ?? "(none)"}`
    )
  } else {
    lines.push("(no session)")
  }

  lines.push("")
  lines.push(`## Bound agents (in active plan)`)
  if (ctx.agents.length === 0) {
    lines.push("(none)")
  } else {
    for (const a of ctx.agents) {
      lines.push(
        `- ${a.agentKind} \`${a.agentId}\` → step \`${a.planStepId}\` (${a.planStepTitle ?? "?"}) · ${a.bindingSource}`
      )
    }
  }

  lines.push("")
  lines.push(`## David Review queue`)
  lines.push(`Open items: ${ctx.pendingReviewCount}`)
  for (const r of ctx.recentReviews) {
    lines.push(`- [${r.sourceType}/${r.state}] \`${r.id}\` ${r.title}`)
  }

  lines.push("")
  lines.push(`## Related KB (${ctx.relatedKb.length})`)
  for (const e of ctx.relatedKb) {
    lines.push(
      `- [${e.entryType}] \`${e.id}\` ${e.title}${e.tags.length ? ` (${e.tags.slice(0, 4).join(", ")})` : ""}`
    )
  }

  lines.push("")
  lines.push(`## Cross-plan bridges (${ctx.crossPlanBridges.length})`)
  if (ctx.crossPlanBridges.length === 0) {
    lines.push("(none — no open review item references a step outside this plan)")
  } else {
    for (const b of ctx.crossPlanBridges) {
      lines.push(
        `- via ${b.via} \`${b.refId}\` → plan \`${b.planId}\` (${b.planTitle ?? "?"}): ${b.hint}`
      )
    }
  }
  return lines.join("\n")
}

function renderPlanInventory(
  inv: Awaited<ReturnType<typeof getPlanInventory>>
): string {
  const lines: string[] = []
  lines.push(`# Plan Inventory — workspace ${inv.workspaceId}`)
  lines.push(
    `Total plans: ${inv.totalPlans} · empty=${inv.sprawlSummary.empty} stale=${inv.sprawlSummary.stale} abandoned=${inv.sprawlSummary.abandoned} duplicates=${inv.sprawlSummary.duplicates} shipped-pinned=${inv.sprawlSummary.shippedPinned} multi-pinned-active=${inv.sprawlSummary.multiPinnedActive}`
  )
  lines.push("")
  for (const p of inv.plans) {
    const c = p.stepCounts
    const flags = p.flags.length ? ` ⚠ ${p.flags.join(",")}` : ""
    lines.push(
      `- \`${p.id}\` [${p.state}${p.pinned ? "/pinned" : ""}] ${p.title} — ${c.total} steps (${c.open}o ${c["in-motion"]}m ${c.covered}c ${c.skipped}s) · ${p.daysSinceUpdate}d since update · agents=${p.boundAgentCount}${flags}`
    )
    if (p.duplicateCandidateIds.length > 0) {
      lines.push(`    dupes: ${p.duplicateCandidateIds.join(", ")}`)
    }
  }
  if (inv.duplicatePairs.length > 0) {
    lines.push("")
    lines.push(`## Duplicate pairs`)
    for (const pair of inv.duplicatePairs) {
      lines.push(
        `- \`${pair.aPlanId}\` ↔ \`${pair.bPlanId}\` similarity=${pair.similarity} shared=[${pair.sharedTokens.join(", ")}]`
      )
    }
  }
  return lines.join("\n")
}

function renderReviewQueue(
  queue: Awaited<ReturnType<typeof getDavidReviewQueue>>
): string {
  const lines: string[] = []
  lines.push(`# David Review Queue — workspace ${queue.workspaceId}`)
  lines.push(`Total open: ${queue.totalOpen}`)
  for (const b of queue.buckets) {
    lines.push("")
    lines.push(`## ${b.category} (${b.count})`)
    for (const it of b.items) {
      lines.push(
        `- \`${it.id}\` [${it.sourceType}/${it.state}] ${it.title}${it.relatedPlanStepId ? ` → step \`${it.relatedPlanStepId}\`` : ""}`
      )
    }
    if (b.items.length === 0) lines.push("(empty)")
  }
  return lines.join("\n")
}

export function registerWorkContextTools(
  server: McpServer,
  ctx: McpContext
) {
  server.registerTool(
    "work_active_context",
    {
      title: "Active work context",
      description:
        "Deterministic answer to 'what plan / step / agents / KB / review queue is the workspace working in right now?'. Call this before any write so subsequent plan/KB/review-item mutations are scoped correctly. Cross-plan references are surfaced explicitly under 'crossPlanBridges'.",
      inputSchema: {
        workspaceId: z.string().optional(),
        kbLimit: z.number().int().min(1).max(50).optional(),
        reviewLimit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ workspaceId, kbLimit, reviewLimit }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const result = await getActiveWorkContext(ws, {
          reviewer: ctx.reviewer,
          kbLimit,
          reviewLimit,
        })
        return textResult(renderActiveWorkContext(result))
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  server.registerTool(
    "plan_inventory",
    {
      title: "Plan inventory & sprawl signals",
      description:
        "List every plan in the workspace with step counts, days since update, bound-agent count, and sprawl flags (empty / stale / abandoned / shipped-pinned). Surfaces duplicate-title candidates (Jaccard ≥ threshold). Read-only. Pass `proposeDuplicates=true` to upsert a david-only review item per duplicate pair (idempotent).",
      inputSchema: {
        workspaceId: z.string().optional(),
        staleDays: z.number().int().min(1).max(365).optional(),
        threshold: z.number().min(0).max(1).optional(),
        proposeDuplicates: z.boolean().optional(),
      },
    },
    async ({ workspaceId, staleDays, threshold, proposeDuplicates }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const inv = await getPlanInventory(ws, {
          staleDays,
          duplicateThreshold: threshold,
        })
        const proposed: string[] = []
        if (proposeDuplicates && inv.duplicatePairs.length > 0) {
          const titleById = new Map(inv.plans.map((p) => [p.id, p.title]))
          for (const pair of inv.duplicatePairs) {
            const aTitle = titleById.get(pair.aPlanId) ?? "(unknown)"
            const bTitle = titleById.get(pair.bPlanId) ?? "(unknown)"
            const item = await proposeMergePruneReview(ws, pair, {
              aTitle,
              bTitle,
            })
            proposed.push(item.id)
          }
        }
        const tail =
          proposed.length > 0
            ? `\n\nProposed ${proposed.length} review item(s): ${proposed.join(", ")}`
            : ""
        return textResult(renderPlanInventory(inv) + tail)
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )

  server.registerTool(
    "review_queue",
    {
      title: "David Review queue",
      description:
        "Project the workspace's review-item bucket by category (executive / sprawl / intake / agent / other). Open items only by default. Use this to triage what's waiting for human judgment.",
      inputSchema: {
        workspaceId: z.string().optional(),
        includeClosed: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ workspaceId, includeClosed, limit }) => {
      const ws = workspaceId ?? ctx.defaultWorkspaceId
      try {
        const queue = await getDavidReviewQueue(ws, {
          includeClosed,
          limitPerBucket: limit,
        })
        return textResult(renderReviewQueue(queue))
      } catch (err) {
        return errorResult((err as Error).message)
      }
    }
  )
}
