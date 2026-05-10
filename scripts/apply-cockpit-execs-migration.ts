/**
 * One-off: apply drizzle/0031_cockpit_execs.sql directly. The journal
 * (drizzle/meta/_journal.json) hasn't tracked migrations since 0023, so
 * `drizzle-kit migrate` is a no-op for newer files.
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { getPgPool } from "@/lib/server/db/client"

async function main() {
  const sql = readFileSync(
    path.join(process.cwd(), "drizzle", "0031_cockpit_execs.sql"),
    "utf8"
  )
  const pool = getPgPool()
  console.log("Applying 0031_cockpit_execs.sql…")
  await pool.query(sql)
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'operator_cockpit_execs'
    ORDER BY column_name;
  `)
  console.log("✅ Applied. Columns:")
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
