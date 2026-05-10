/**
 * pnpm os:berthier-ack --agent=<agentId> [--exec=<execId>] [--reason="..."] [--json]
 *
 * Berthier explicitly acknowledges a worker's task_done. Sets
 * `berthier_reviewed_at = now` on the binding WITHOUT detaching.
 * The binding stays active so the cockpit can keep surfacing the
 * "needs your eyes — Berthier already looked" pill until David taps
 * Acknowledge or the auto-detach safety net fires after 24h.
 *
 * This is the middle gate of the multi-tier review state machine
 * (see kb-2026-05-10-multi-tier-review-state-machine). It exists
 * specifically to surface the *interstitial risk* of work that
 * Berthier looked at but David never validated.
 */

import {
  getActiveBindingsSpawnedBy,
  setBerthierReviewedAt,
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
        'usage: cockpit-berthier-ack --agent=<agentId> [--exec=<execId>] [--reason="..."] [--json]'
      )
      process.exit(0)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.agent) {
    console.error("error: --agent=<agentId> required")
    process.exit(2)
  }
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
    }
    process.exit(1)
  }
  const ok = await setBerthierReviewedAt(
    GLOBAL_WORKSPACE_ID,
    args.agent,
    args.reason
  )
  if (!ok) {
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: "ack-failed" }, null, 2))
    } else {
      console.error("error: berthier-ack returned no rows (race? already detached?)")
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
          berthierReviewedAt: new Date().toISOString(),
          reason: args.reason,
        },
        null,
        2
      )
    )
    return
  }
  console.log(`✓ berthier-ack: ${args.agent}`)
  console.log(`  step:   ${binding.planStepId}`)
  if (args.reason) console.log(`  reason: ${args.reason}`)
  console.log("")
  console.log("(binding stays active — needs your sign-off via `pnpm os:worker-done`)")
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
