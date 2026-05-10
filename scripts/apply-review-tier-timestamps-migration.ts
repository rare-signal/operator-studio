/**
 * One-off: apply drizzle/0034_review_tier_timestamps.sql directly.
 *
 *   pnpm tsx scripts/apply-review-tier-timestamps-migration.ts
 */

import { readFileSync } from "node:fs"
import path from "node:path"

import { getPgPool } from "@/lib/server/db/client"

async function main() {
  const sql = readFileSync(
    path.join(process.cwd(), "drizzle", "0034_review_tier_timestamps.sql"),
    "utf8"
  )
  const pool = getPgPool()
  console.log("Applying 0034_review_tier_timestamps.sql…")
  await pool.query(sql)
  console.log("✅ Applied. Verifying columns:")
  const res = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'operator_thread_card_bindings'
      AND column_name IN ('berthier_reviewed_at', 'human_approved_at')
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
