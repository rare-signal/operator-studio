/**
 * Agent-friendly plan-card writer.
 *
 * This is the CLI sibling of the MCP plan_step_* tools. Use it for live
 * Operator Studio planning updates; reserve seed scripts for fixtures,
 * repeatable demos, and migrations.
 */

import { readFileSync } from "node:fs"

import {
  getActivePlan,
  getPlanById,
  restorePlanStep,
  setPlanStepStatus,
  softDeletePlanStep,
  upsertPlanStep,
} from "../lib/operator-studio/plans"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"
import type { OperatorSessionPlan } from "../lib/operator-studio/types"

type Status = "open" | "in-motion" | "covered" | "skipped"
type Command = "list" | "show" | "upsert" | "status" | "delete" | "restore"

interface Options {
  command: Command
  workspaceId: string
  planId: string | null
  id: string | null
  title: string | null
  description: string | null
  descriptionFile: string | null
  parentStepId: string | null | undefined
  status: Status | null
  stepOrder: number | null
  cascade: boolean
  json: boolean
}

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`)
  console.error(
    [
      "usage:",
      "  pnpm plan:card list [--status=open] [--json]",
      "  pnpm plan:card show --id=step-id [--json]",
      "  pnpm plan:card upsert --title='Card title' [--id=step-id] [--parent=step-id] [--status=open] [--description='...']",
      "  pnpm plan:card status --id=step-id --status=in-motion",
      "  pnpm plan:card delete --id=step-id [--no-cascade]",
      "  pnpm plan:card restore --id=step-id [--cascade]",
      "",
      "flags:",
      "  --workspace=ID             default: global",
      "  --plan-id=ID               default: active plan",
      "  --id=ID                    stable step id",
      "  --title=TEXT               required for upsert",
      "  --description=TEXT         long-form card body",
      "  --description-file=PATH    read long-form card body from a file",
      "  --parent=ID                parent step id; omit for top-level",
      "  --no-parent                detach / insert as top-level",
      "  --status=STATUS            open | in-motion | covered | skipped",
      "  --step-order=N             insertion order for new cards",
      "  --cascade / --no-cascade   delete/restore descendant behavior",
      "  --json                     machine-readable output",
    ].join("\n")
  )
  process.exit(message ? 1 : 0)
}

function parseStatus(raw: string): Status {
  if (raw === "open" || raw === "in-motion" || raw === "covered" || raw === "skipped") {
    return raw
  }
  usage(`invalid status: ${raw}`)
}

function parseArgs(argv: string[]): Options {
  const rawCommand = argv[0]
  if (!rawCommand || rawCommand === "--help" || rawCommand === "-h") usage()
  const command = rawCommand as Command
  if (!["list", "show", "upsert", "status", "delete", "restore"].includes(command)) {
    usage(`unknown command: ${command}`)
  }

  const opts: Options = {
    command,
    workspaceId: GLOBAL_WORKSPACE_ID,
    planId: null,
    id: null,
    title: null,
    description: null,
    descriptionFile: null,
    parentStepId: undefined,
    status: null,
    stepOrder: null,
    cascade: command === "delete",
    json: false,
  }

  for (const raw of argv.slice(1)) {
    if (raw === "--help" || raw === "-h") usage()
    if (raw === "--json") {
      opts.json = true
      continue
    }
    if (raw === "--cascade") {
      opts.cascade = true
      continue
    }
    if (raw === "--no-cascade") {
      opts.cascade = false
      continue
    }
    if (raw === "--no-parent") {
      opts.parentStepId = null
      continue
    }
    if (raw.startsWith("--workspace=")) {
      opts.workspaceId = raw.slice("--workspace=".length).trim() || GLOBAL_WORKSPACE_ID
      continue
    }
    if (raw.startsWith("--plan-id=")) {
      opts.planId = raw.slice("--plan-id=".length).trim() || null
      continue
    }
    if (raw.startsWith("--id=")) {
      opts.id = raw.slice("--id=".length).trim() || null
      continue
    }
    if (raw.startsWith("--title=")) {
      opts.title = raw.slice("--title=".length).trim() || null
      continue
    }
    if (raw.startsWith("--description=")) {
      opts.description = decodeTextArg(raw.slice("--description=".length))
      continue
    }
    if (raw.startsWith("--description-file=")) {
      opts.descriptionFile = raw.slice("--description-file=".length).trim() || null
      continue
    }
    if (raw.startsWith("--parent=")) {
      opts.parentStepId = raw.slice("--parent=".length).trim() || null
      continue
    }
    if (raw.startsWith("--status=")) {
      opts.status = parseStatus(raw.slice("--status=".length).trim())
      continue
    }
    if (raw.startsWith("--step-order=")) {
      const n = Number.parseInt(raw.slice("--step-order=".length), 10)
      if (!Number.isFinite(n)) usage("invalid --step-order")
      opts.stepOrder = n
      continue
    }
    usage(`unknown arg: ${raw}`)
  }

  return opts
}

function decodeTextArg(value: string) {
  return value.replace(/\\n/g, "\n").replace(/\\t/g, "\t")
}

async function resolvePlan(workspaceId: string, planId: string | null) {
  if (planId) {
    const plan = await getPlanById(workspaceId, planId)
    if (!plan) usage(`plan not found: ${planId}`)
    return plan
  }
  return getActivePlan(workspaceId, null, "plan-card-cli")
}

function output(opts: Options, value: unknown) {
  if (opts.json) {
    console.log(JSON.stringify(value, null, 2))
    return
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "action" in value &&
    "id" in value
  ) {
    const result = value as { action: string; id: string; planId?: string }
    console.log(`${result.action}: ${result.id}${result.planId ? ` (${result.planId})` : ""}`)
    return
  }
  console.log(JSON.stringify(value, null, 2))
}

function outputList(opts: Options, plan: OperatorSessionPlan) {
  const steps = opts.status
    ? plan.steps.filter((step) => step.status === opts.status)
    : plan.steps

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          plan: {
            id: plan.id,
            title: plan.title,
            state: plan.state,
            pinned: plan.pinned,
          },
          count: steps.length,
          steps: steps.map((step) => ({
            id: step.id,
            title: step.title,
            status: step.status,
            parentStepId: step.parentStepId,
            order: step.order,
          })),
        },
        null,
        2
      )
    )
    return
  }

  console.log(`${plan.title} (${plan.id})`)
  console.log(`state=${plan.state} pinned=${plan.pinned ? "yes" : "no"} cards=${steps.length}`)
  if (steps.length === 0) {
    console.log(opts.status ? `No ${opts.status} cards.` : "No cards yet.")
    return
  }
  for (const step of steps) {
    const parent = step.parentStepId ? ` parent=${step.parentStepId}` : ""
    console.log(`[${step.status}] ${step.id}${parent} — ${step.title}`)
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const plan = await resolvePlan(opts.workspaceId, opts.planId)

  if (opts.command === "list") {
    outputList(opts, plan)
    return
  }

  if (opts.command === "show") {
    if (!opts.id) usage("show requires --id")
    const step = plan.steps.find((s) => s.id === opts.id)
    if (!step) usage(`step not found in plan ${plan.id}: ${opts.id}`)
    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            plan: { id: plan.id, title: plan.title },
            step: {
              id: step.id,
              title: step.title,
              status: step.status,
              parentStepId: step.parentStepId,
              order: step.order,
              description: step.description ?? null,
            },
          },
          null,
          2
        )
      )
      return
    }
    const { renderPlanStep } = await import("../lib/mcp-server/views/plan-view")
    console.log(renderPlanStep(plan, step, { includeChildren: true }))
    return
  }

  if (opts.command === "upsert") {
    if (!opts.title) usage("upsert requires --title")
    const description = opts.descriptionFile
      ? readFileSync(opts.descriptionFile, "utf8")
      : opts.description
    const result = await upsertPlanStep(opts.workspaceId, plan.id, {
      id: opts.id ?? undefined,
      title: opts.title,
      description,
      status: opts.status ?? undefined,
      parentStepId: opts.parentStepId,
      stepOrder: opts.stepOrder ?? undefined,
    })
    output(opts, { ...result, planId: plan.id })
    return
  }

  if (!opts.id) usage(`${opts.command} requires --id`)

  if (opts.command === "status") {
    if (!opts.status) usage("status requires --status")
    const result = await setPlanStepStatus(opts.workspaceId, plan.id, opts.id, opts.status)
    output(opts, { ...result, id: opts.id, planId: plan.id })
    return
  }

  if (opts.command === "delete") {
    const result = await softDeletePlanStep(opts.workspaceId, plan.id, opts.id, {
      cascade: opts.cascade,
    })
    output(opts, { ...result, planId: plan.id })
    return
  }

  const result = await restorePlanStep(opts.workspaceId, plan.id, opts.id, {
    cascade: opts.cascade,
  })
  output(opts, { ...result, planId: plan.id })
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
