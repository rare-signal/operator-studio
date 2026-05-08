import { Pool } from "pg"
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) { console.error("no DATABASE_URL"); process.exit(1) }
const pool = new Pool({ connectionString: databaseUrl })
async function main() {
  // 1) confirm columns exist
  const cols = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='operator_threads' AND column_name LIKE 'marked%' ORDER BY column_name"
  )
  console.log("=== marked_* columns ===")
  for (const r of cols.rows) console.log(" ", r.column_name)

  // 2) any threads currently flagged done?
  const flagged = await pool.query(
    "SELECT id, source_app, raw_title, marked_done_at, marked_done_source, marked_done_by FROM operator_threads WHERE marked_done_at IS NOT NULL ORDER BY marked_done_at DESC LIMIT 10"
  )
  console.log(`\n=== flagged-done threads (count=${flagged.rowCount}) ===`)
  for (const r of flagged.rows) console.log(JSON.stringify(r))

  // 3) any USER messages whose normalized content matches the default phrase?
  const phrase = "all done in this chat, ty!"
  const msgs = await pool.query(
    `SELECT thread_id, turn_index, role, created_at, LEFT(content, 200) AS preview
     FROM operator_thread_messages
     WHERE role='user' AND lower(trim(content)) = $1
     ORDER BY created_at DESC LIMIT 10`,
    [phrase]
  )
  console.log(`\n=== user msgs matching default phrase (SQL strict) (count=${msgs.rowCount}) ===`)
  for (const r of msgs.rows) console.log(JSON.stringify(r))

  // 4) fuzzy: any user msg content that *contains* "all done in this chat"
  const fuzzy = await pool.query(
    `SELECT thread_id, turn_index, role, created_at, LEFT(content, 240) AS preview, length(content) AS len
     FROM operator_thread_messages
     WHERE role='user' AND lower(content) LIKE '%all done in this chat%'
     ORDER BY created_at DESC LIMIT 10`
  )
  console.log(`\n=== user msgs containing 'all done in this chat' (count=${fuzzy.rowCount}) ===`)
  for (const r of fuzzy.rows) console.log(JSON.stringify(r))

  // 5) for any of those, also show what the raw content looks like (first 400 chars, with control chars escaped)
  if ((fuzzy.rowCount ?? 0) > 0) {
    const sample = await pool.query(
      `SELECT thread_id, turn_index, role, content
       FROM operator_thread_messages
       WHERE role='user' AND lower(content) LIKE '%all done in this chat%'
       ORDER BY created_at DESC LIMIT 3`
    )
    console.log("\n=== sample raw content (JSON-stringified to expose whitespace) ===")
    for (const r of sample.rows) {
      console.log(`thread_id=${r.thread_id} turn=${r.turn_index} role=${r.role}`)
      console.log("  raw:", JSON.stringify(r.content.slice(0, 400)))
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => pool.end())
