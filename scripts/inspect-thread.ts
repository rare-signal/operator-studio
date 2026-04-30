/**
 * Quick read-back: dump a thread row + sample messages to confirm
 * source-payload provenance and message metadata land correctly.
 *
 * Usage: `pnpm tsx scripts/inspect-thread.ts <threadId>`
 */

import { Pool } from "pg"

const threadId = process.argv[2]
if (!threadId) {
  console.error("usage: pnpm tsx scripts/inspect-thread.ts <threadId>")
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("DATABASE_URL not set; load .env.local first")
  process.exit(1)
}

const pool = new Pool({ connectionString: databaseUrl })

async function main() {
  const t = await pool.query(
    "SELECT id, source_app, source_thread_key, source_locator, raw_title, source_payload_json, message_count FROM operator_threads WHERE id = $1",
    [threadId]
  )
  if (t.rows.length === 0) {
    console.log("no such thread")
    return
  }
  const row = t.rows[0]
  console.log("=== thread ===")
  console.log("title:", row.raw_title)
  console.log("source_app:", row.source_app)
  console.log("source_locator:", row.source_locator)
  console.log("source_thread_key:", row.source_thread_key)
  console.log("message_count:", row.message_count)
  console.log("source_payload_json:", JSON.stringify(row.source_payload_json, null, 2))

  const m = await pool.query(
    "SELECT turn_index, role, LEFT(content, 80) AS preview, metadata_json FROM operator_thread_messages WHERE thread_id = $1 ORDER BY turn_index LIMIT 3",
    [threadId]
  )
  console.log("\n=== first 3 messages ===")
  for (const r of m.rows) {
    console.log(
      `[${r.turn_index}] ${r.role}: ${JSON.stringify(r.preview)} meta=${JSON.stringify(r.metadata_json)}`
    )
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end())
