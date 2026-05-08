import { getPgPool } from "../lib/server/db/client"
import { getThreadById, getThreadMessages } from "../lib/operator-studio/queries"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"

async function main() {
  const ids = process.argv.slice(2)
  if (ids.length === 0) {
    console.error("usage: tsx dump-thread.ts <threadId> [...]")
    process.exit(1)
  }
  for (const id of ids) {
    const t = await getThreadById(GLOBAL_WORKSPACE_ID, id)
    if (!t) { console.log(`# missing: ${id}\n`); continue }
    const msgs = await getThreadMessages(GLOBAL_WORKSPACE_ID, id)
    console.log(`\n========================================`)
    console.log(`THREAD ${id}`)
    console.log(`title: ${t.promotedTitle ?? t.rawTitle}`)
    console.log(`sourceApp: ${t.sourceApp}`)
    console.log(`messageCount: ${msgs.length}`)
    console.log(`========================================\n`)
    for (const m of msgs) {
      const head = `--- [${m.turnIndex}] ${m.role} (${m.createdAt}) ---`
      console.log(head)
      const body = (m.content ?? "").trim()
      console.log(body.length > 4000 ? body.slice(0, 4000) + "\n…[truncated " + (body.length - 4000) + " chars]" : body)
      console.log()
    }
  }
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { try { await getPgPool().end() } catch {} })
