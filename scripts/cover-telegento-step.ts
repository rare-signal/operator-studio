/**
 * Quick one-shot to flip telegento-pipeline plan steps to "covered".
 * Usage: pnpm tsx ./scripts/cover-telegento-step.ts step-C-pipeline-B3 step-C-pipeline-B4
 */
import { eq, inArray } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"

async function main() {
  const ids = process.argv.slice(2)
  if (ids.length === 0) {
    console.error("Usage: pass step IDs to mark as covered")
    process.exit(1)
  }
  const db = getDb()
  const now = new Date()
  await db
    .update(operatorPlanSteps)
    .set({ status: "covered", updatedAt: now })
    .where(inArray(operatorPlanSteps.id, ids))
  const updated = await db
    .select({ id: operatorPlanSteps.id, status: operatorPlanSteps.status, title: operatorPlanSteps.title })
    .from(operatorPlanSteps)
    .where(inArray(operatorPlanSteps.id, ids))
  for (const r of updated) console.log(`  ${r.id}  [${r.status}]  ${r.title}`)
}

main()
  .catch((e) => {
    console.error("Cover failed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
