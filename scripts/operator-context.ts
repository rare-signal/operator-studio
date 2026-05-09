/**
 * pnpm os:context — fast deterministic answer for Codex/Claude:
 * "what plan / step / agents / KB / review queue is the workspace
 * working in right now?"
 *
 * Sister of `pnpm os:state`. Where os:state shows operational
 * snapshot (live agents, blockers), os:context shows scope routing —
 * the bits an agent needs *before* writing anything to avoid silent
 * cross-plan mixing.
 *
 *   pnpm os:context                # active context summary
 *   pnpm os:context --json         # machine-readable
 *   pnpm os:context --inventory    # add plan inventory + sprawl signals
 *   pnpm os:context --queue        # add David Review queue (categorized)
 *   pnpm os:context --all          # context + inventory + queue
 *   pnpm os:context --workspace=ID # default: global
 *   pnpm os:context --propose      # with --inventory: upsert review
 *                                    items for duplicate plan pairs
 */

import { getActiveWorkContext } from "../lib/operator-studio/active-work-context"
import { getDavidReviewQueue } from "../lib/operator-studio/david-review-queue"
import {
  getPlanInventory,
  proposeMergePruneReview,
} from "../lib/operator-studio/plan-inventory"
import {
  getRecencyContext,
  renderRecencyContext,
} from "../lib/operator-studio/recency-context"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"

interface Options {
  workspaceId: string
  json: boolean
  inventory: boolean
  queue: boolean
  propose: boolean
}

function parseArgs(argv: string[]): Options {
  let workspaceId = GLOBAL_WORKSPACE_ID
  let json = false
  let inventory = false
  let queue = false
  let propose = false
  for (const a of argv) {
    if (a === "--json") json = true
    else if (a === "--inventory") inventory = true
    else if (a === "--queue") queue = true
    else if (a === "--all") {
      inventory = true
      queue = true
    } else if (a === "--propose") propose = true
    else if (a.startsWith("--workspace=")) workspaceId = a.slice(12) || workspaceId
    else if (a === "-h" || a === "--help") {
      console.error(
        [
          "usage: pnpm os:context [--json] [--inventory] [--queue] [--all] [--propose] [--workspace=ID]",
        ].join("\n")
      )
      process.exit(0)
    }
  }
  return { workspaceId, json, inventory, queue, propose }
}

function renderContext(
  ctx: Awaited<ReturnType<typeof getActiveWorkContext>>
): string {
  const lines: string[] = []
  lines.push(`# Active Work Context — workspace=${ctx.workspaceId}`)
  lines.push(
    `Plan: ${ctx.plan.title}  [${ctx.plan.id}] state=${ctx.plan.state}${ctx.plan.pinned ? " pinned" : ""}`
  )
  if (ctx.plan.goal) lines.push(`  goal: ${ctx.plan.goal}`)
  const c = ctx.plan.stepCounts
  lines.push(
    `  steps: ${ctx.plan.totalSteps} (open=${c.open} in-motion=${c["in-motion"]} covered=${c.covered} skipped=${c.skipped})`
  )
  lines.push(
    `  active step: ${ctx.plan.activeStepId ?? "(none)"} — ${ctx.plan.activeStepTitle ?? ""}`
  )
  lines.push(
    `Routing: workspace=${ctx.routing.workspaceId} plan=${ctx.routing.planId} step=${ctx.routing.defaultStepId ?? "(none)"} requireExplicitPlanId=${ctx.routing.requireExplicitPlanId}`
  )
  if (ctx.session) {
    lines.push(
      `Session: ${ctx.session.id} started=${ctx.session.startedAt} planId=${ctx.session.planId ?? "(none)"}`
    )
  } else {
    lines.push("Session: (none)")
  }
  lines.push(`Bound agents (in-plan): ${ctx.agents.length}`)
  for (const a of ctx.agents) {
    lines.push(
      `  - ${a.agentKind} ${a.agentId} → ${a.planStepId} (${a.planStepTitle ?? "?"}) via ${a.bindingSource}`
    )
  }
  lines.push(`Open review items: ${ctx.pendingReviewCount}`)
  for (const r of ctx.recentReviews) {
    lines.push(`  - [${r.sourceType}/${r.state}] ${r.id} ${r.title}`)
  }
  lines.push(`Related KB: ${ctx.relatedKb.length}`)
  for (const e of ctx.relatedKb) {
    lines.push(`  - [${e.entryType}] ${e.id} ${e.title}`)
  }
  lines.push(`Cross-plan bridges: ${ctx.crossPlanBridges.length}`)
  for (const b of ctx.crossPlanBridges) {
    lines.push(`  - via ${b.via} ${b.refId} → plan ${b.planId} (${b.planTitle ?? "?"}): ${b.hint}`)
  }
  return lines.join("\n")
}

function renderInventory(
  inv: Awaited<ReturnType<typeof getPlanInventory>>,
  proposedIds: string[]
): string {
  const lines: string[] = []
  lines.push("")
  lines.push(`# Plan Inventory — ${inv.totalPlans} plan(s)`)
  const s = inv.sprawlSummary
  lines.push(
    `Sprawl: empty=${s.empty} stale=${s.stale} abandoned=${s.abandoned} duplicates=${s.duplicates} shipped-pinned=${s.shippedPinned} multi-pinned-active=${s.multiPinnedActive}`
  )
  for (const p of inv.plans) {
    const cc = p.stepCounts
    const flags = p.flags.length ? ` ⚠ ${p.flags.join(",")}` : ""
    lines.push(
      `  - ${p.id} [${p.state}${p.pinned ? "/pinned" : ""}] ${p.title} — ${cc.total} steps (${cc.open}o ${cc["in-motion"]}m ${cc.covered}c ${cc.skipped}s) · ${p.daysSinceUpdate}d · agents=${p.boundAgentCount}${flags}`
    )
    if (p.duplicateCandidateIds.length > 0) {
      lines.push(`      dupes: ${p.duplicateCandidateIds.join(", ")}`)
    }
  }
  if (proposedIds.length > 0) {
    lines.push(`Proposed ${proposedIds.length} review item(s): ${proposedIds.join(", ")}`)
  }
  return lines.join("\n")
}

function renderQueue(
  queue: Awaited<ReturnType<typeof getDavidReviewQueue>>
): string {
  const lines: string[] = []
  lines.push("")
  lines.push(`# David Review Queue — totalOpen=${queue.totalOpen}`)
  for (const b of queue.buckets) {
    lines.push(`## ${b.category} (${b.count})`)
    for (const it of b.items) {
      lines.push(`  - ${it.id} [${it.sourceType}/${it.state}] ${it.title}`)
    }
  }
  return lines.join("\n")
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const result: Record<string, unknown> = {}
  try {
    // Recency-first prelude. Fast (≤1s on the dogfood workspace) and
    // designed for an LLM startup-prompt block — answers "what
    // matters right now" before the agent reads the plan.
    const recency = await getRecencyContext(opts.workspaceId)
    result.recency = recency

    const ctx = await getActiveWorkContext(opts.workspaceId, {
      reviewer: "os:context",
    })
    result.context = ctx

    let inventory:
      | Awaited<ReturnType<typeof getPlanInventory>>
      | null = null
    const proposedIds: string[] = []
    if (opts.inventory) {
      inventory = await getPlanInventory(opts.workspaceId)
      result.inventory = inventory
      if (opts.propose && inventory.duplicatePairs.length > 0) {
        const titleById = new Map(inventory.plans.map((p) => [p.id, p.title]))
        for (const pair of inventory.duplicatePairs) {
          const item = await proposeMergePruneReview(opts.workspaceId, pair, {
            aTitle: titleById.get(pair.aPlanId) ?? "(unknown)",
            bTitle: titleById.get(pair.bPlanId) ?? "(unknown)",
          })
          proposedIds.push(item.id)
        }
        result.proposedReviewItemIds = proposedIds
      }
    }

    let queue: Awaited<ReturnType<typeof getDavidReviewQueue>> | null = null
    if (opts.queue) {
      queue = await getDavidReviewQueue(opts.workspaceId)
      result.queue = queue
    }

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(renderRecencyContext(recency))
      console.log("")
      console.log(renderContext(ctx))
      if (inventory) console.log(renderInventory(inventory, proposedIds))
      if (queue) console.log(renderQueue(queue))
    }
  } catch (e) {
    console.error("os:context failed:", (e as Error).message)
    console.error((e as Error).stack?.split("\n").slice(0, 12).join("\n"))
    process.exitCode = 1
  } finally {
    await getPgPool().end()
  }
}

main()
