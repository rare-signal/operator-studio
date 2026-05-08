import { Pool } from "pg"
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const ids = process.argv.slice(2)
async function main() {
  for (const id of ids) {
    const t = await pool.query("SELECT raw_title, source_app, message_count, updated_at FROM operator_threads WHERE id=$1", [id])
    if (!t.rows[0]) { console.log(`-- ${id}: not found`); continue }
    const row = t.rows[0]
    console.log(`\n=== ${id} ===`)
    console.log(`title: ${row.raw_title}`)
    console.log(`src=${row.source_app}  msgs=${row.message_count}  updated=${row.updated_at?.toISOString?.()}`)
    const m = await pool.query(
      "SELECT turn_index, role, content, metadata_json FROM operator_thread_messages WHERE thread_id=$1 ORDER BY turn_index DESC LIMIT 3",
      [id]
    )
    for (const r of m.rows.reverse()) {
      const c = (r.content || "").toString().slice(0, 600).replace(/\s+/g, " ")
      console.log(`  [${r.turn_index}] ${r.role}: ${c}`)
    }
  }
}
main().catch(console.error).finally(() => pool.end())
