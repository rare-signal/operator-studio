/**
 * pnpm os:worker-done --agent=<agentId> [--exec=<execId>] [--reason="..."] [--json]
 *
 * Mark a spawned worker complete from Berthier's POV. Flips the
 * binding's detached_at = now so the worker:
 *   - drops out of the active rail (`pnpm os:workers`)
 *   - shows up under "recently completed" (collapsed; expand with --completed)
 *
 * Plan-card status is NOT touched — a worker can be "complete" (binding
 * detached) while its plan card stays in-motion (e.g. Phase 1 done,
 * Phase 2 still gated on David's approval). Use `pnpm plan:card status`
 * separately if you also want to flip the card.
 *
 * Safety:
 *   - Verifies the binding belongs to the given exec before detaching
 *     (prevents accidentally detaching another exec's worker).
 *   - Pass --reason="..." to log the mark-complete rationale to stdout
 *     (and to the JSON output). The binding's original `rationale` is
 *     preserved as-is — per-detach reasons are stdout-only until we
 *     add a `detach_reason` column.
 */

import {
  detachThreadCardBinding,
  getActiveBindingsSpawnedBy,
} from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const DEFAULT_EXEC =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

interface Args {
  agent: string | null
  exec: string
  reason: string | null
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { agent: null, exec: DEFAULT_EXEC, reason: null, json: false }
  for (const a of argv.slice(2)) {
    if (a === "--json") out.json = true
    else if (a.startsWith("--agent=")) out.agent = a.slice(8)
    else if (a.startsWith("--exec=")) out.exec = a.slice(7)
    else if (a.startsWith("--reason=")) out.reason = a.slice(9)
    else if (a === "-h" || a === "--help") {
      console.error(
        'usage: cockpit-mark-done --agent=<agentId> [--exec=<execId>] [--reason="..."] [--json]'
      )
      process.exit(0)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.agent) {
    console.error('error: --agent=<agentId> required (e.g. --agent=claude:cdd73e96-...)')
    process.exit(2)
  }

  // Verify the binding actually belongs to this exec before detaching.
  const owned = await getActiveBindingsSpawnedBy(GLOBAL_WORKSPACE_ID, args.exec)
  const binding = owned.find((b) => b.agentId === args.agent)
  if (!binding) {
    if (args.json) {
      console.log(
        JSON.stringify(
          { ok: false, error: "agent-not-owned-by-exec", exec: args.exec, agent: args.agent },
          null,
          2
        )
      )
    } else {
      console.error(
        `error: agent ${args.agent} is not currently active under exec ${args.exec}`
      )
      console.error(`  (run \`pnpm os:workers\` to see what's active)`)
    }
    process.exit(1)
  }

  const detached = await detachThreadCardBinding(
    GLOBAL_WORKSPACE_ID,
    args.agent,
    args.reason
  )
  if (!detached) {
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: "detach-failed" }, null, 2))
    } else {
      console.error("error: detach returned no rows (race? already detached?)")
    }
    process.exit(1)
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          exec: args.exec,
          agent: args.agent,
          planStepId: binding.planStepId,
          source: binding.source,
          spawnOrigin: binding.spawnOrigin,
          markedAt: new Date().toISOString(),
          reason: args.reason,
        },
        null,
        2
      )
    )
    return
  }

  console.log(`✓ marked complete: ${args.agent}`)
  console.log(`  step:   ${binding.planStepId}`)
  console.log(`  origin: ${binding.spawnOrigin ?? "unknown"} via ${binding.source}`)
  if (args.reason) console.log(`  reason: ${args.reason}`)
  console.log("")
  console.log("(worker dropped from active rail; visible under `pnpm os:workers --completed`)")
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
