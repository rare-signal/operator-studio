/**
 * pnpm tsx scripts/timeline.ts [--factory=<id>] [--since=<ISO>] [--limit=<N>]
 *
 * Prints the operations timeline as plain text. The narrative
 * spans inbox events, outbox state changes, plan-step touches,
 * review items, KB activity, and thread-card bindings.
 *
 * Per step-operator-studio-timeline-story-surface.
 */

import { getTimeline, renderTimeline } from "../lib/operator-studio/timeline"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"

interface Args {
  workspaceId: string
  factoryId: string | null
  since: Date | undefined
  limit: number
}

function parseArgs(argv: string[]): Args {
  let workspaceId = GLOBAL_WORKSPACE_ID
  let factoryId: string | null = null
  let since: Date | undefined
  let limit = 50
  for (const a of argv) {
    if (a.startsWith("--workspace=")) workspaceId = a.slice("--workspace=".length) || workspaceId
    else if (a.startsWith("--factory=")) factoryId = a.slice("--factory=".length) || null
    else if (a.startsWith("--since=")) {
      const d = new Date(a.slice("--since=".length))
      if (!Number.isNaN(d.getTime())) since = d
    } else if (a.startsWith("--limit=")) {
      const n = Number(a.slice("--limit=".length))
      if (Number.isFinite(n) && n > 0) limit = n
    }
  }
  return { workspaceId, factoryId, since, limit }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const events = await getTimeline(args.workspaceId, {
    factoryId: args.factoryId ?? undefined,
    since: args.since,
    limit: args.limit,
  })
  const factoryNote = args.factoryId ? `factory=${args.factoryId}` : "all factories"
  const sinceNote = args.since ? args.since.toISOString() : "default 14d window"
  console.log(
    `# Operations timeline · workspace=${args.workspaceId} · ${factoryNote} · since=${sinceNote} · ${events.length} events`
  )
  console.log()
  console.log(renderTimeline(events))
  await getPgPool().end()
}

main().catch(async (err) => {
  console.error(err)
  await getPgPool().end().catch(() => undefined)
  process.exit(1)
})
