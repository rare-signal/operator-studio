/**
 * Markdown projections for plan data. Tools return text content (not
 * raw JSON) because LLMs read structured prose far more efficiently
 * than nested JSON, and markdown headers / bullet indentation map
 * cleanly to the parent/child step tree.
 */

import type {
  OperatorPlanStep,
  OperatorSessionPlan,
} from "@/lib/operator-studio/types"

const STATUS_GLYPH: Record<OperatorPlanStep["status"], string> = {
  open: "○",
  "in-motion": "◐",
  covered: "●",
  skipped: "⊘",
}

function buildStepTree(steps: OperatorPlanStep[]): {
  roots: OperatorPlanStep[]
  childrenOf: Map<string, OperatorPlanStep[]>
} {
  const childrenOf = new Map<string, OperatorPlanStep[]>()
  const roots: OperatorPlanStep[] = []
  for (const step of steps) {
    if (step.parentStepId === null) {
      roots.push(step)
    } else {
      const bucket = childrenOf.get(step.parentStepId) ?? []
      bucket.push(step)
      childrenOf.set(step.parentStepId, bucket)
    }
  }
  // Stable order within each parent bucket — matches the web app's
  // ordering on `step.order`.
  const sortByOrder = (a: OperatorPlanStep, b: OperatorPlanStep) =>
    a.order - b.order
  roots.sort(sortByOrder)
  for (const bucket of childrenOf.values()) bucket.sort(sortByOrder)
  return { roots, childrenOf }
}

/**
 * Outline view — titles + status + child counts, depth-limited.
 *
 * Default `maxDepth=2` keeps a reasonably large plan readable in one
 * tool response. Steps deeper than maxDepth are collapsed into a
 * "(N more deeper)" hint so the agent knows there's more without
 * paying for it. The agent can drill down with `plan.step`.
 */
export function renderPlanOutline(
  plan: OperatorSessionPlan,
  maxDepth = 2
): string {
  const { roots, childrenOf } = buildStepTree(plan.steps)

  const lines: string[] = []
  lines.push(`# Plan: ${plan.title}`)
  const meta: string[] = [plan.state]
  if (plan.pinned) meta.push("pinned")
  if (plan.ownerName) meta.push(`owner: ${plan.ownerName}`)
  meta.push(`id: ${plan.id}`)
  lines.push(`_${meta.join(" · ")}_`)
  if (plan.goal) lines.push("", `**Goal:** ${plan.goal}`)
  if (plan.outcome) lines.push("", `**Outcome:** ${plan.outcome}`)
  lines.push("")
  lines.push(`## Steps (${plan.steps.length} total, max depth ${maxDepth})`)
  lines.push("")

  if (roots.length === 0) {
    lines.push("_No steps yet — plan is empty._")
    return lines.join("\n")
  }

  function walk(step: OperatorPlanStep, depth: number, prefix: string) {
    const glyph = STATUS_GLYPH[step.status] ?? "?"
    const children = childrenOf.get(step.id) ?? []
    const childCount = children.length
    const indent = "  ".repeat(depth)
    const stepLabel = `${prefix} ${step.title}`.trim()
    const childHint =
      childCount > 0
        ? depth + 1 > maxDepth
          ? ` (${childCount} child${childCount === 1 ? "" : "ren"} deeper)`
          : ""
        : ""
    lines.push(
      `${indent}- ${glyph} \`${step.id}\` ${stepLabel}${childHint}`
    )

    if (depth + 1 > maxDepth) return
    children.forEach((child, i) => {
      walk(child, depth + 1, `${prefix}${i + 1}.`)
    })
  }

  roots.forEach((step, i) => {
    walk(step, 0, `${i + 1}.`)
  })

  lines.push("")
  lines.push(
    "_Glyphs: ○ open · ◐ in-motion · ● covered · ⊘ skipped. Use `plan.step` with the backtick id to fetch a step's full description and children._"
  )
  return lines.join("\n")
}

/**
 * Single-step view — title, status, full description, children list.
 */
export function renderPlanStep(
  plan: OperatorSessionPlan,
  step: OperatorPlanStep,
  options: { includeChildren?: boolean } = {}
): string {
  const { childrenOf } = buildStepTree(plan.steps)
  const children = childrenOf.get(step.id) ?? []
  const parent = step.parentStepId
    ? plan.steps.find((s) => s.id === step.parentStepId)
    : null

  const lines: string[] = []
  lines.push(`# Step: ${step.title}`)
  lines.push(
    `_${STATUS_GLYPH[step.status]} ${step.status} · order ${step.order} · plan ${plan.id} (${plan.title})_`
  )
  if (parent) {
    lines.push(`_Parent: \`${parent.id}\` ${parent.title}_`)
  } else {
    lines.push("_Parent: (top-level)_")
  }
  lines.push("")

  lines.push("## Description")
  lines.push("")
  lines.push(step.description?.trim() || "_(no description)_")
  lines.push("")

  if (children.length > 0) {
    lines.push(`## Children (${children.length})`)
    if (options.includeChildren) {
      for (const child of children) {
        lines.push(
          `- ${STATUS_GLYPH[child.status]} \`${child.id}\` ${child.title}`
        )
        if (child.description) {
          const trimmed = child.description.trim()
          const preview =
            trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
          lines.push(`  ${preview}`)
        }
      }
    } else {
      for (const child of children) {
        lines.push(
          `- ${STATUS_GLYPH[child.status]} \`${child.id}\` ${child.title}`
        )
      }
      lines.push("")
      lines.push(
        "_Pass `includeChildren: true` to include each child's description preview._"
      )
    }
  } else {
    lines.push("_No children._")
  }

  return lines.join("\n")
}

/**
 * Search match — short result row.
 */
export function renderSearchMatch(
  step: OperatorPlanStep,
  plan: OperatorSessionPlan,
  query: string
): string {
  const desc = step.description ?? ""
  // Try to extract a short snippet around the match. If the query
  // matched the title only, fall back to a description preview.
  const lowerQ = query.toLowerCase()
  const lowerDesc = desc.toLowerCase()
  const idx = lowerDesc.indexOf(lowerQ)
  let snippet = ""
  if (idx >= 0) {
    const start = Math.max(0, idx - 40)
    const end = Math.min(desc.length, idx + lowerQ.length + 40)
    const head = start > 0 ? "…" : ""
    const tail = end < desc.length ? "…" : ""
    snippet = `${head}${desc.slice(start, end).replace(/\s+/g, " ")}${tail}`
  } else if (desc.length > 0) {
    snippet =
      desc.length > 100 ? `${desc.slice(0, 100).replace(/\s+/g, " ")}…` : desc
  }

  const lines = [
    `- ${STATUS_GLYPH[step.status]} \`${step.id}\` ${step.title}`,
    `  _Plan: ${plan.title} (${plan.id})_`,
  ]
  if (snippet) lines.push(`  > ${snippet}`)
  return lines.join("\n")
}
