import { getDb, getPgPool } from "@/lib/server/db/client"
import { sql } from "drizzle-orm"

async function main() {
  const db = getDb()
  const ws = await db.execute(sql`SELECT id, label FROM workspaces ORDER BY id`)
  console.log("=== workspaces ===")
  for (const r of (ws as unknown as { rows: Array<Record<string, unknown>> }).rows) {
    console.log(`  ${r.id}\t${r.label}`)
  }

  const counts = await db.execute(sql`
    SELECT workspace_id, COUNT(*) AS c, MAX(created_at) AS latest
    FROM operator_thread_messages
    GROUP BY workspace_id
    ORDER BY latest DESC NULLS LAST
  `)
  console.log("\n=== messages per workspace ===")
  for (const r of (counts as unknown as { rows: Array<Record<string, unknown>> }).rows) {
    console.log(`  ${r.workspace_id}\tcount=${r.c}\tlatest=${r.latest}`)
  }

  await getPgPool().end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
