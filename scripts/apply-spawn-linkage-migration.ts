/**
 * One-off: apply drizzle/0030_spawn_linkage.sql directly. The journal
 * (drizzle/meta/_journal.json) hasn't tracked migrations since 0023,
 * so `drizzle-kit migrate` is a no-op for newer files. This script
 * runs the raw SQL via pg.
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { getPgPool } from "@/lib/server/db/client"

async function main() {
  const sql = readFileSync(
    path.join(process.cwd(), "drizzle", "0030_spawn_linkage.sql"),
    "utf8"
  )
  const pool = getPgPool()
  console.log("Applying 0030_spawn_linkage.sql…")
  await pool.query(sql)
  console.log("✅ Applied. Verifying columns:")
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'operator_thread_card_bindings'
      AND column_name IN ('spawned_by_agent_id', 'spawn_origin')
    ORDER BY column_name;
  `)
  for (const row of res.rows) console.log(`  ${row.column_name}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
