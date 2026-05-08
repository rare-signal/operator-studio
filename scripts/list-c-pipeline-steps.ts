import { like } from "drizzle-orm"

import { getDb, getPgPool } from "../lib/server/db/client"
import { operatorPlanSteps } from "../lib/server/db/schema"

async function main() {
  const db = getDb()
  const rows = await db
    .select({
      id: operatorPlanSteps.id,
      status: operatorPlanSteps.status,
      parentStepId: operatorPlanSteps.parentStepId,
      title: operatorPlanSteps.title,
    })
    .from(operatorPlanSteps)
    .where(like(operatorPlanSteps.id, "step-C-pipeline-%"))
  rows.sort((a, b) => a.id.localeCompare(b.id))
  for (const r of rows) {
    const status = (r.status ?? "?").padEnd(10)
    console.log(`${r.id.padEnd(40)} [${status}] parent=${r.parentStepId ?? "-"}  ${r.title}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
