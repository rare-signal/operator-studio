/**
 * pnpm os:hydrate [stepId] — the "tiny launch prompt → full context
 * unfold" seam. A fresh Claude/Codex/Hermes worker only needs to know
 *
 *   You are an Operator Studio worker on card <stepId>.
 *   Run: pnpm os:hydrate <stepId>
 *   End with: task_done
 *
 * and this command emits, in one stream, everything that worker needs:
 *
 *   1. The agent startup manifest (factory context + tools-first rules
 *      + first-moves checklist + recency packet).
 *   2. The full plan-step body for the named card (title, status,
 *      description, parent, children) — exactly what the operator
 *      otherwise has to paste into the launch prompt by hand.
 *
 * No filesystem dumps; no markdown blob attached to the launch UI.
 * The launch prompt stays tiny and safe to compose; the agent
 * self-hydrates through the same product-native tool surfaces it will
 * use for the rest of the task.
 *
 * Flags:
 *   --workspace=ID     default: global
 *   --factory=ID       force a factory; default = resolve from the
 *                      target card (step.factoryId ?? plan.factoryId),
 *                      else fall back to factory-clarifying-telegento
 *   --no-card          skip the plan-step section (manifest only)
 *   --no-children      omit child preview from the plan-step section
 *
 * The first positional arg is the step id; alternatively pass
 * --step=<id> or set OPERATOR_STUDIO_STEP.
 */

import { and, eq } from "drizzle-orm"

import { renderAgentManifest } from "../lib/operator-studio/agent-manifest"
import { renderPlanStep } from "../lib/mcp-server/views/plan-view"
import {
  getActivePlan,
  getPlanById,
  listPlans,
} from "../lib/operator-studio/plans"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getDb, getPgPool } from "../lib/server/db/client"
import {
  operatorPlans,
  operatorPlanSteps,
} from "../lib/server/db/schema"

const FALLBACK_FACTORY_ID = "factory-clarifying-telegento"

interface Options {
  workspaceId: string
  /** Factory the operator pinned at the CLI / env. If null, we resolve
   *  from the target card (step.factoryId ?? plan.factoryId) and only
   *  fall back to FALLBACK_FACTORY_ID when no binding exists. */
  factoryId: string | null
  factoryExplicit: boolean
  stepId: string | null
  includeCard: boolean
  includeChildren: boolean
}

function parseArgs(argv: string[]): Options {
  let stepId: string | null =
    process.env.OPERATOR_STUDIO_STEP?.trim() || null
  let workspaceId =
    process.env.OPERATOR_STUDIO_WORKSPACE?.trim() || GLOBAL_WORKSPACE_ID
  const envFactory = process.env.OPERATOR_STUDIO_FACTORY?.trim() || ""
  let factoryId: string | null = envFactory || null
  let factoryExplicit = envFactory.length > 0
  let includeCard = true
  let includeChildren = true
  for (const a of argv) {
    if (a === "-h" || a === "--help") {
      console.error(
        [
          "usage: pnpm os:hydrate [stepId] [--workspace=ID] [--factory=ID] [--no-card] [--no-children]",
          "",
          "Emits the agent-startup manifest plus the full body of the",
          "named plan card. Designed so that a fresh agent can be",
          "launched with a tiny prompt that just names the card +",
          "instructs the agent to run this command.",
        ].join("\n")
      )
      process.exit(0)
    } else if (a === "--no-card") includeCard = false
    else if (a === "--no-children") includeChildren = false
    else if (a.startsWith("--workspace=")) workspaceId = a.slice(12) || workspaceId
    else if (a.startsWith("--factory=")) {
      const v = a.slice(10)
      if (v) {
        factoryId = v
        factoryExplicit = true
      }
    }
    else if (a.startsWith("--step=")) stepId = a.slice(7) || stepId
    else if (!a.startsWith("--") && stepId === null) stepId = a
  }
  return { workspaceId, factoryId, factoryExplicit, stepId, includeCard, includeChildren }
}

/**
 * Look up the bound factory for a card directly from the database.
 *
 * The plans.ts mapper doesn't surface `factory_id` on the typed step /
 * plan objects (it's a soft FK used by other read paths), so the
 * hydrate script queries it itself rather than widening the shared
 * type. Resolution order matches the schema comment on
 * operator_plan_steps.factory_id: step.factory_id ?? plan.factory_id.
 */
async function lookupCardFactoryId(
  workspaceId: string,
  stepId: string
): Promise<string | null> {
  const db = getDb()
  const rows = await db
    .select({
      stepFactoryId: operatorPlanSteps.factoryId,
      planFactoryId: operatorPlans.factoryId,
    })
    .from(operatorPlanSteps)
    .innerJoin(operatorPlans, eq(operatorPlanSteps.planId, operatorPlans.id))
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        eq(operatorPlanSteps.id, stepId)
      )
    )
    .limit(1)
  if (rows.length === 0) return null
  return rows[0].stepFactoryId ?? rows[0].planFactoryId ?? null
}

async function findStep(workspaceId: string, stepId: string) {
  const active = await getActivePlan(workspaceId, null, "os-hydrate")
  const direct = active.steps.find((s) => s.id === stepId)
  if (direct) return { plan: active, step: direct }

  const all = await listPlans(workspaceId)
  for (const summary of all) {
    const plan = await getPlanById(workspaceId, summary.id)
    if (!plan) continue
    const step = plan.steps.find((s) => s.id === stepId)
    if (step) return { plan, step }
  }
  return null
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  // Resolve the card-bound factory first (when one is named) so the
  // manifest header reflects the actual factory the card lives in.
  // Without this, an Operator Studio card hydrated with no explicit
  // --factory would render with the Telegento header.
  let factoryId = opts.factoryId
  if (!opts.factoryExplicit && opts.includeCard && opts.stepId) {
    const cardFactoryId = await lookupCardFactoryId(
      opts.workspaceId,
      opts.stepId
    )
    if (cardFactoryId) factoryId = cardFactoryId
  }
  if (!factoryId) factoryId = FALLBACK_FACTORY_ID

  const manifest = await renderAgentManifest({
    workspaceId: opts.workspaceId,
    factoryId,
  })
  process.stdout.write(manifest)
  process.stdout.write("\n\n")

  if (!opts.includeCard) return
  if (!opts.stepId) {
    process.stdout.write(
      [
        "## Your card",
        "(no step id passed — call `pnpm os:hydrate <step-id>` to unfold a specific card.",
        "List candidates with `pnpm plan:card list --status=in-motion`.)",
        "",
      ].join("\n")
    )
    return
  }

  const found = await findStep(opts.workspaceId, opts.stepId)
  if (!found) {
    process.stdout.write(
      [
        "## Your card",
        `Step \`${opts.stepId}\` not found in workspace \`${opts.workspaceId}\`.`,
        "Run `pnpm plan:card list` to see available cards, or",
        "`pnpm plan:card show --id=<id>` once you know the id.",
        "",
      ].join("\n")
    )
    return
  }

  process.stdout.write(`## Your card\n\n`)
  process.stdout.write(
    renderPlanStep(found.plan, found.step, {
      includeChildren: opts.includeChildren,
    })
  )
  process.stdout.write("\n")
}

main()
  .catch(async (err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end().catch(() => undefined)
  })
