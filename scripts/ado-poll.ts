/**
 * One-shot ADO poll, runnable from the terminal.
 *
 *   node --import tsx --import ./scripts/tsx-loader-register.mjs \
 *     scripts/ado-poll.ts [factoryId]
 *
 * Defaults to factory-clarifying-telegento. Prints a small summary
 * with counts.
 */

import { pollAdoForFactory } from "../lib/operator-studio/ingest/ado-poller"
import { getPgPool } from "../lib/server/db/client"

const workspaceId = "global"
const factoryId = process.argv[2] ?? "factory-clarifying-telegento"

async function main() {
  const result = await pollAdoForFactory(workspaceId, factoryId)
  console.log(`ado-poll · ${result.factoryId}`)
  console.log(
    `  started: ${result.pollStartedAt}  finished: ${result.pollFinishedAt}`
  )
  console.log(
    `  items_seen=${result.itemsSeen}  ingested=${result.rowsIngested}  ` +
      `skipped_duplicate=${result.rowsSkippedDuplicate}  errors=${result.errors.length}`
  )
  for (const e of result.errors) console.log(`  ! ${e}`)
  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
