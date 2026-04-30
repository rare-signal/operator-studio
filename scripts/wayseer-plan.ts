/**
 * Wayseer plan inspector — terminal-side view of the active plan, so an
 * agent (or you) can ingest it in one command. Mirrors the resolution
 * the in-app Plan view uses by calling `getActivePlan()` directly,
 * which means: pinned-active plan > current session's plan > a fresh
 * drafting plan (auto-created by the resolver if none exists).
 *
 * Steps are nested via `parentStepId`, so output renders as an indented
 * outline. Cover image URLs are surfaced as `image://<url>` placeholders
 * — Wayseer can backfill captions later without changing this CLI shape.
 *
 * Usage:
 *   pnpm wayseer:plan
 *   pnpm wayseer:plan --workspace=t
 *   pnpm wayseer:plan --card=<step-id>          zoom to one card + descendants
 *   pnpm wayseer:plan --json                    raw JSON output (for scripting)
 *   pnpm wayseer:plan --no-images               omit coverImageUrl placeholders
 *   pnpm wayseer:plan --description-chars=400   truncate long descriptions
 *
 * Flags:
 *   --workspace=ID                 default: global
 *   --card=ID                      zoom to one step (and its children)
 *   --description-chars=N          default: 600  (0 = unlimited)
 *   --base-url=URL                 default: http://localhost:3000
 *   --json                         raw JSON output
 *   --no-images                    omit image:// placeholders
 *   --no-color                     disable ANSI colour
 */

import { getActivePlan } from "../lib/operator-studio/plans"
import { getPgPool } from "../lib/server/db/client"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import type {
  OperatorPlanStep,
  OperatorSessionPlan,
} from "../lib/operator-studio/types"

interface CliOptions {
  workspace: string
  cardId: string | null
  descriptionChars: number
  baseUrl: string
  json: boolean
  images: boolean
  color: boolean
}

function printUsageAndExit(message?: string): never {
  if (message) console.error(`error: ${message}\n`)
  console.error(
    [
      "usage: pnpm wayseer:plan [flags]",
      "",
      "flags:",
      "  --workspace=ID                 default: global",
      "  --card=ID                      zoom to one step (and its children)",
      "  --description-chars=N          default: 600  (0 = unlimited)",
      "  --base-url=URL                 default: http://localhost:3000",
      "  --json                         raw JSON output",
      "  --no-images                    omit image:// placeholders",
      "  --no-color                     disable ANSI colour",
    ].join("\n")
  )
  process.exit(message ? 1 : 0)
}

function parseArgs(argv: string[]): CliOptions {
  let workspace = GLOBAL_WORKSPACE_ID
  let cardId: string | null = null
  let descriptionChars = 600
  let baseUrl = process.env.WAYSEER_BASE_URL?.trim() || "http://localhost:3000"
  let json = false
  let images = true
  let color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") printUsageAndExit()
    if (raw === "--json") { json = true; continue }
    if (raw === "--no-color") { color = false; continue }
    if (raw === "--no-images") { images = false; continue }
    if (raw.startsWith("--workspace=")) {
      workspace = raw.slice("--workspace=".length).trim() || GLOBAL_WORKSPACE_ID
      continue
    }
    if (raw.startsWith("--card=")) {
      cardId = raw.slice("--card=".length).trim() || null
      continue
    }
    if (raw.startsWith("--description-chars=")) {
      const n = Number.parseInt(raw.slice("--description-chars=".length), 10)
      if (!Number.isFinite(n) || n < 0) printUsageAndExit("invalid --description-chars")
      descriptionChars = n
      continue
    }
    if (raw.startsWith("--base-url=")) {
      baseUrl = raw.slice("--base-url=".length).trim().replace(/\/$/, "")
      continue
    }
    printUsageAndExit(`unknown arg: ${raw}`)
  }

  return { workspace, cardId, descriptionChars, baseUrl, json, images, color }
}

const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
} as const

function colorize(opts: CliOptions, code: keyof typeof ANSI, text: string) {
  if (!opts.color) return text
  return `${ANSI[code]}${text}${ANSI.reset}`
}

const STATUS_COLOR: Record<OperatorPlanStep["status"], keyof typeof ANSI> = {
  open: "dim",
  "in-motion": "yellow",
  covered: "green",
  skipped: "magenta",
}

function planLink(opts: CliOptions): string {
  return `${opts.baseUrl}/operator-studio/plan`
}

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (max <= 0 || text.length <= max) return { text, truncated: false }
  return { text: text.slice(0, max).trimEnd() + "…", truncated: true }
}

/**
 * Build a child-list map from a flat step list. Steps without a parent
 * (or whose parent isn't in `byId`) are roots. Children inherit the
 * parent's `order` semantics — sort by `order` ascending.
 */
function buildTree(steps: OperatorPlanStep[]): {
  roots: OperatorPlanStep[]
  childrenOf: Map<string, OperatorPlanStep[]>
  byId: Map<string, OperatorPlanStep>
} {
  const byId = new Map<string, OperatorPlanStep>()
  for (const s of steps) byId.set(s.id, s)

  const childrenOf = new Map<string, OperatorPlanStep[]>()
  const roots: OperatorPlanStep[] = []
  for (const s of steps) {
    const parent = s.parentStepId && byId.get(s.parentStepId) ? s.parentStepId : null
    if (parent === null) {
      roots.push(s)
      continue
    }
    let bucket = childrenOf.get(parent)
    if (!bucket) {
      bucket = []
      childrenOf.set(parent, bucket)
    }
    bucket.push(s)
  }
  const sortFn = (a: OperatorPlanStep, b: OperatorPlanStep) => a.order - b.order
  roots.sort(sortFn)
  for (const arr of childrenOf.values()) arr.sort(sortFn)
  return { roots, childrenOf, byId }
}

/**
 * Collect a step + all transitive descendants in pre-order. Used by
 * `--card=ID` zoom so JSON consumers get the same subtree view as
 * the printed outline.
 */
function collectSubtree(
  rootId: string,
  childrenOf: Map<string, OperatorPlanStep[]>,
  byId: Map<string, OperatorPlanStep>
): OperatorPlanStep[] {
  const root = byId.get(rootId)
  if (!root) return []
  const out: OperatorPlanStep[] = [root]
  const stack: OperatorPlanStep[] = [root]
  while (stack.length > 0) {
    const node = stack.pop() as OperatorPlanStep
    const kids = childrenOf.get(node.id) ?? []
    for (let i = kids.length - 1; i >= 0; i--) {
      out.push(kids[i])
      stack.push(kids[i])
    }
  }
  return out
}

function renderStep(
  step: OperatorPlanStep,
  depth: number,
  childrenOf: Map<string, OperatorPlanStep[]>,
  opts: CliOptions
): string {
  const indent = "  ".repeat(depth)
  const status = colorize(opts, STATUS_COLOR[step.status], `[${step.status}]`)
  const title = colorize(opts, "cyan", step.title || "(untitled)")
  const id = colorize(opts, "dim", step.id)

  const lines: string[] = [`${indent}${status} ${title} ${id}`]

  if (step.description) {
    const { text, truncated } = truncate(step.description, opts.descriptionChars)
    for (const line of text.split("\n")) {
      lines.push(`${indent}  ${line}`)
    }
    if (truncated) {
      lines.push(`${indent}  ${colorize(opts, "dim", `… (truncated; --description-chars=0 to expand)`)}`)
    }
  }

  if (opts.images && step.coverImageUrl) {
    lines.push(`${indent}  ${colorize(opts, "blue", `image://${step.coverImageUrl}`)}`)
  }

  for (const child of childrenOf.get(step.id) ?? []) {
    lines.push(renderStep(child, depth + 1, childrenOf, opts))
  }

  return lines.join("\n")
}

function emitJson(
  plan: OperatorSessionPlan,
  visibleSteps: OperatorPlanStep[],
  opts: CliOptions
) {
  const out = {
    workspace: opts.workspace,
    plan: {
      id: plan.id,
      title: plan.title,
      goal: plan.goal,
      outcome: plan.outcome,
      state: plan.state,
      pinned: plan.pinned,
      ownerName: plan.ownerName,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      url: planLink(opts),
    },
    cardId: opts.cardId,
    stepCount: visibleSteps.length,
    steps: visibleSteps.map((s) => {
      const { text, truncated } =
        s.description !== undefined && s.description !== null
          ? truncate(s.description, opts.descriptionChars)
          : { text: "", truncated: false }
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        order: s.order,
        parentStepId: s.parentStepId,
        description: s.description ? text : null,
        descriptionTruncated: truncated,
        coverImageUrl: opts.images ? s.coverImageUrl : null,
      }
    }),
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n")
}

async function run(opts: CliOptions) {
  // Reviewer string is just an audit-trail tag; getActivePlan auto-creates
  // a drafting plan if none exists in this workspace.
  const plan = await getActivePlan(opts.workspace, null, "wayseer-cli")
  const tree = buildTree(plan.steps)

  let visibleSteps = plan.steps
  if (opts.cardId) {
    if (!tree.byId.has(opts.cardId)) {
      console.error(
        colorize(opts, "red", `card not found in active plan: ${opts.cardId}`)
      )
      console.error(colorize(opts, "dim", `(plan ${plan.id} has ${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"})`))
      process.exitCode = 1
      return
    }
    visibleSteps = collectSubtree(opts.cardId, tree.childrenOf, tree.byId)
  }

  if (opts.json) {
    emitJson(plan, visibleSteps, opts)
    return
  }

  const header = colorize(
    opts,
    "dim",
    `wayseer plan · ${opts.workspace} · ${plan.id}`
  )
  process.stdout.write(`${header}\n`)
  const titleLine = `${colorize(opts, "bold", plan.title || "(untitled plan)")} ${colorize(opts, "dim", `[${plan.state}${plan.pinned ? "·pinned" : ""}]`)}`
  process.stdout.write(`${titleLine}\n`)
  if (plan.goal) process.stdout.write(`  ${colorize(opts, "dim", "goal:")} ${plan.goal}\n`)
  if (plan.outcome) process.stdout.write(`  ${colorize(opts, "dim", "outcome:")} ${plan.outcome}\n`)
  process.stdout.write(`  ${colorize(opts, "dim", planLink(opts))}\n\n`)

  if (opts.cardId) {
    const root = tree.byId.get(opts.cardId) as OperatorPlanStep
    process.stdout.write(`${colorize(opts, "bold", `zoomed to card ${opts.cardId} (${visibleSteps.length} node${visibleSteps.length === 1 ? "" : "s"})`)}\n\n`)
    // Render the zoomed subtree as a fresh tree so depth starts at 0.
    process.stdout.write(renderStep(root, 0, tree.childrenOf, opts) + "\n")
    return
  }

  if (tree.roots.length === 0) {
    process.stdout.write(`${colorize(opts, "dim", "(plan has no steps yet)")}\n`)
    return
  }

  const heading = `${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}`
  process.stdout.write(`${colorize(opts, "bold", heading)}\n`)
  for (const root of tree.roots) {
    process.stdout.write(renderStep(root, 0, tree.childrenOf, opts) + "\n")
  }
}

const opts = parseArgs(process.argv.slice(2))

run(opts)
  .catch((err) => {
    console.error(colorize(opts, "red", "wayseer plan failed:"), err?.message ?? err)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await getPgPool().end()
    } catch {
      /* already ended */
    }
  })
