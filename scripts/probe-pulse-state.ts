import { getDb, getPgPool } from "@/lib/server/db/client"
import { sql } from "drizzle-orm"

async function main() {
  const db = getDb()
  const workspaceId = process.argv[2] ?? "t"

  console.log("=== Latest 5 messages in DB ===")
  const latest = await db.execute<{
    id: string
    thread_id: string
    role: string
    created_at: string
    source_app: string
    raw_title: string | null
  }>(sql`
    SELECT m.id, m.thread_id, m.role, m.created_at, t.source_app, t.raw_title
    FROM operator_thread_messages m
    JOIN operator_threads t ON t.id = m.thread_id
    WHERE m.workspace_id = ${workspaceId}
    ORDER BY m.created_at DESC
    LIMIT 5
  `)
  for (const r of (latest as unknown as { rows: Array<Record<string, unknown>> }).rows) {
    console.log(
      `  ${r.created_at}  ${r.source_app}  ${String(r.role ?? "").padEnd(9)}  ${String(r.raw_title ?? "").slice(0, 60)}`
    )
  }

  console.log("\n=== Latest 5 sessions ===")
  const sessions = await db.execute<{
    id: string
    started_at: string
    ended_at: string
    message_count: number
    thread_count: number
  }>(sql`
    SELECT id, started_at, ended_at, message_count, thread_count
    FROM operator_sessions
    WHERE workspace_id = ${workspaceId}
    ORDER BY started_at DESC
    LIMIT 5
  `)
  for (const r of (sessions as unknown as { rows: Array<Record<string, unknown>> }).rows) {
    console.log(
      `  ${r.started_at}  →  ${r.ended_at}   msgs=${r.message_count}  threads=${r.thread_count}`
    )
  }

  console.log("\n=== Now ===")
  console.log(`  ${new Date().toISOString()}`)

  await getPgPool().end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
