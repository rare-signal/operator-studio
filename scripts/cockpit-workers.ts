/**
 * pnpm tsx scripts/cockpit-workers.ts [--exec=<agentId>] [--json]
 *
 * Fast context output for an executive: lists workers spawned by a
 * given exec agent, with plan-step, source, and recency. Reads
 * directly from `operator_thread_card_bindings` so it works without
 * the dev server being up (matches the no-curl rule in memory).
 *
 * This is the CLI equivalent of GET /api/operator-studio/cockpit/spawned-by
 * — same code path (`getActiveBindingsSpawnedBy`), no HTTP roundtrip.
 *
 * Defaults to the EXEC_AGENT_ID baked into spawn-cockpit-worker.ts so a
 * raw `pnpm tsx scripts/cockpit-workers.ts` invocation is sufficient
 * for the canonical Berthier exec session.
 */

import { and, eq, isNull } from "drizzle-orm"

import { getDb, getPgPool } from "@/lib/server/db/client"
import { operatorPlanSteps } from "@/lib/server/db/schema"
import {
  getActiveBindingsSpawnedBy,
  getRecentlyDetachedBindingsSpawnedBy,
} from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"

const DEFAULT_EXEC =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

interface Args {
  exec: string
  json: boolean
  showCompleted: boolean
  completedLimit: number
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    exec: DEFAULT_EXEC,
    json: false,
    showCompleted: false,
    completedLimit: 10,
  }
  for (const a of argv.slice(2)) {
    if (a === "--json") out.json = true
    else if (a === "--completed") out.showCompleted = true
    else if (a.startsWith("--completed-limit=")) {
      out.completedLimit = Math.max(1, parseInt(a.slice(18), 10) || 10)
      out.showCompleted = true
    } else if (a.startsWith("--exec=")) out.exec = a.slice(7)
    else if (a === "-h" || a === "--help") {
      console.error(
        "usage: cockpit-workers [--exec=<agentId>] [--json] [--completed] [--completed-limit=N]"
      )
      process.exit(0)
    }
  }
  return out
}

function ageHuman(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 48) return `${hr}h`
  return `${Math.round(hr / 24)}d`
}

async function resolveStepTitles(
  workspaceId: string,
  stepIds: string[]
): Promise<Map<string, string | null>> {
  if (stepIds.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({
      id: operatorPlanSteps.id,
      title: operatorPlanSteps.title,
    })
    .from(operatorPlanSteps)
    .where(
      and(
        eq(operatorPlanSteps.workspaceId, workspaceId),
        isNull(operatorPlanSteps.deletedAt)
      )
    )
  const titleMap = new Map<string, string | null>()
  for (const r of rows) {
    if (stepIds.includes(r.id)) titleMap.set(r.id, r.title)
  }
  return titleMap
}

async function main() {
  const args = parseArgs(process.argv)
  const [bindings, completed] = await Promise.all([
    getActiveBindingsSpawnedBy(GLOBAL_WORKSPACE_ID, args.exec),
    getRecentlyDetachedBindingsSpawnedBy(
      GLOBAL_WORKSPACE_ID,
      args.exec,
      args.completedLimit
    ),
  ])
  const allStepIds = [
    ...bindings.map((b) => b.planStepId),
    ...completed.map((b) => b.planStepId),
  ]
  const titleMap = await resolveStepTitles(GLOBAL_WORKSPACE_ID, allStepIds)

  if (args.json) {
    const renderBinding = (b: typeof bindings[number]) => ({
      agentId: b.agentId,
      agentKind: b.agentKind,
      planStepId: b.planStepId,
      planStepTitle: titleMap.get(b.planStepId) ?? null,
      source: b.source,
      spawnOrigin: b.spawnOrigin,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      detachedAt: b.detachedAt,
      ageSinceCreated: ageHuman(b.createdAt),
      ageSinceUpdated: ageHuman(b.updatedAt),
      ageSinceDetached: b.detachedAt ? ageHuman(b.detachedAt) : null,
    })
    console.log(
      JSON.stringify(
        {
          exec: args.exec,
          activeCount: bindings.length,
          completedCount: completed.length,
          workers: bindings.map(renderBinding),
          completed: completed.map(renderBinding),
        },
        null,
        2
      )
    )
    return
  }

  console.log(`exec: ${args.exec}`)
  console.log(`active workers: ${bindings.length}`)
  if (bindings.length === 0) {
    console.log("(no workers spawned by this exec)")
  } else {
    console.log("")
    for (const b of bindings) {
      const title = titleMap.get(b.planStepId)
      console.log(`• ${b.agentKind}:${b.agentId.replace(/^[^:]+:/, "")}`)
      console.log(`    step:    ${b.planStepId}`)
      if (title) console.log(`    title:   ${title}`)
      console.log(`    origin:  ${b.spawnOrigin ?? "unknown"} via ${b.source}`)
      console.log(
        `    age:     spawned ${ageHuman(b.createdAt)} ago • last touch ${ageHuman(b.updatedAt)} ago`
      )
      console.log("")
    }
  }

  // Recently completed: collapsed by default, expand with --completed.
  if (completed.length === 0) {
    console.log("recently completed: 0")
    return
  }
  if (!args.showCompleted) {
    console.log(
      `recently completed: ${completed.length} (pass --completed to expand)`
    )
    return
  }
  console.log(`recently completed: ${completed.length}`)
  console.log("")
  for (const b of completed) {
    const title = titleMap.get(b.planStepId)
    console.log(`✓ ${b.agentKind}:${b.agentId.replace(/^[^:]+:/, "")}`)
    console.log(`    step:    ${b.planStepId}`)
    if (title) console.log(`    title:   ${title}`)
    console.log(`    origin:  ${b.spawnOrigin ?? "unknown"} via ${b.source}`)
    console.log(
      `    age:     spawned ${ageHuman(b.createdAt)} ago • completed ${b.detachedAt ? ageHuman(b.detachedAt) : "?"} ago`
    )
    if (b.rationale) console.log(`    why:     ${b.rationale}`)
    console.log("")
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
