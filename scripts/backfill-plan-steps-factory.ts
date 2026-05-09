/**
 * Backfill `operator_plan_steps.factory_id` from step ids using a
 * conservative substring heuristic.
 *
 * Classification (priority order, first match wins):
 *
 *   1. id starts with `step-telegento-` AND id is NOT in the meta-set
 *      → factory-clarifying-telegento
 *      (telegento-prefixed cards are product engineering on the
 *      Telegento app, with the exception of the meta-cards that
 *      describe the operator-studio agentic loop watching ADO #N.)
 *
 *   2. id starts with `step-software-factory-` or
 *      `step-ado-intake-nucleus` or step-ado- (any ADO nucleus card)
 *      → factory-operator-studio (these build the meta-system).
 *
 *   3. Anything else stays NULL — falls back to plan.factory_id at
 *      read sites. We do NOT default the entire historical
 *      plan-valikharlia-agentic-studio-buildout to one factory; mixed
 *      cards (cinema, valikharlia, bento, …) keep their step-level
 *      ambiguity until explicit follow-up cards classify them.
 *
 * Idempotent. Re-running is safe — only writes when the inferred
 * factory_id differs from the current value.
 */

import { eq, isNull } from "drizzle-orm"
import { and } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"

const TELEGENTO = "factory-clarifying-telegento"
const OS_META = "factory-operator-studio"

// step ids that LOOK telegento-prefixed but actually describe the
// operator-studio meta-loop (ADO ingest, Teams ingest, etc.). These
// belong to factory-operator-studio.
const META_TELEGENTO_PREFIX_OVERRIDES = new Set<string>([
  "step-telegento-agentic-loop-today",
  "step-telegento-agentic-loop-known-issues",
  "step-telegento-agentic-loop-preview-review",
  "step-telegento-agentic-loop-daily-intake",
  "step-telegento-agentic-loop-promote-this-thread",
  "step-telegento-agentic-loop-claude-signal-ui",
  "step-telegento-agentic-loop-claude-context-pack",
  "step-telegento-ado-teams-assisted-action-lane",
])

function classify(stepId: string): string | null {
  if (stepId.startsWith("step-telegento-")) {
    if (META_TELEGENTO_PREFIX_OVERRIDES.has(stepId)) return OS_META
    return TELEGENTO
  }
  if (stepId.startsWith("step-software-factory-")) return OS_META
  if (stepId.startsWith("step-ado-intake-nucleus")) return OS_META
  if (stepId.startsWith("step-ado-")) return OS_META
  return null
}

async function main() {
  const db = getDb()
  const rows = await db
    .select({
      id: operatorPlanSteps.id,
      currentFactoryId: operatorPlanSteps.factoryId,
    })
    .from(operatorPlanSteps)
    .where(isNull(operatorPlanSteps.deletedAt))

  let updated = 0
  let skippedAlreadyClassified = 0
  let skippedNoMatch = 0
  const factoryCounts: Record<string, number> = {}

  for (const r of rows) {
    const inferred = classify(r.id)
    if (!inferred) {
      skippedNoMatch += 1
      continue
    }
    if (r.currentFactoryId === inferred) {
      skippedAlreadyClassified += 1
      factoryCounts[inferred] = (factoryCounts[inferred] ?? 0) + 1
      continue
    }
    await db
      .update(operatorPlanSteps)
      .set({ factoryId: inferred, updatedAt: new Date() })
      .where(eq(operatorPlanSteps.id, r.id))
    updated += 1
    factoryCounts[inferred] = (factoryCounts[inferred] ?? 0) + 1
  }

  console.log(`backfill-plan-steps-factory · ${rows.length} active steps`)
  console.log(`  updated: ${updated}`)
  console.log(`  already_correct: ${skippedAlreadyClassified}`)
  console.log(`  unmatched (left NULL): ${skippedNoMatch}`)
  console.log(`  by factory:`)
  for (const [k, v] of Object.entries(factoryCounts)) {
    console.log(`    ${k}: ${v}`)
  }

  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})

// Silence unused-import warning if drizzle's `and` is brought in via
// future heuristic extensions.
void and
