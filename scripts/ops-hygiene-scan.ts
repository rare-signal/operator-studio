/**
 * pnpm tsx scripts/ops-hygiene-scan.ts [--workspace=<id>]
 *
 * Walks every in-motion plan step, joins active thread-card bindings,
 * and emits an advisory recommendation per stale / agent-less card
 * into the David Review Queue (operator_review_items, source_type =
 * 'ops_hygiene'). Idempotent — re-runs update existing recommendation
 * rows in place rather than fan-outing.
 *
 * Per step-ops-dream-paradise-hygiene-pass: AI suggests, David
 * commits. The script never mutates a plan_step directly.
 */

import { scanOpsHygiene } from "../lib/operator-studio/ops-hygiene"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"

function parseArgs(argv: string[]): { workspaceId: string } {
  let workspaceId = GLOBAL_WORKSPACE_ID
  for (const a of argv) {
    if (a.startsWith("--workspace=")) {
      workspaceId = a.slice("--workspace=".length) || workspaceId
    }
  }
  return { workspaceId }
}

async function main() {
  const { workspaceId } = parseArgs(process.argv.slice(2))
  const result = await scanOpsHygiene(workspaceId)
  console.log(`ops-hygiene-scan · workspace=${workspaceId}`)
  console.log(
    `  scanned_in_motion=${result.scannedInMotion}  recommendations=${result.emittedRecommendations}`
  )
  if (result.rows.length === 0) {
    console.log(
      `  (clean — every in-motion card is either fresh or has an active agent.)`
    )
  } else {
    console.log(`  by recommendation:`)
    const counts = result.rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.recommendation] = (acc[r.recommendation] ?? 0) + 1
      return acc
    }, {})
    for (const [k, v] of Object.entries(counts)) {
      console.log(`    ${k}: ${v}`)
    }
    console.log(`  rows:`)
    for (const r of result.rows) {
      console.log(
        `    ${r.recommendation.padEnd(13)} ${r.ageHours}h  ${r.stepId}  →  ${r.reviewItemId ?? "(no review item)"}`
      )
      console.log(`      ${r.title}`)
    }
    console.log(``)
    console.log(
      `Review at /operator-studio/executive (filter source_type=ops_hygiene) or via getDavidReviewQueue.`
    )
  }
  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
