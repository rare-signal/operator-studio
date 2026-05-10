/**
 * pnpm os:ado-triage — turn recent ADO inbox events into a crisp
 * call sheet: quick lift, investigation, in motion.
 *
 *   pnpm os:ado-triage                # plain text, default workspace
 *   pnpm os:ado-triage --json
 *   pnpm os:ado-triage --workspace=ID
 *   pnpm os:ado-triage --hours=72     # narrower lookback window
 */

import {
  getAdoTriageReport,
  renderAdoTriageReport,
} from "../lib/operator-studio/ado-triage"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"

interface Options {
  workspaceId: string
  json: boolean
  lookbackHours: number
}

function parseArgs(argv: string[]): Options {
  let workspaceId = GLOBAL_WORKSPACE_ID
  let json = false
  let lookbackHours = 24 * 14
  for (const a of argv) {
    if (a === "--json") json = true
    else if (a.startsWith("--workspace=")) {
      workspaceId = a.slice("--workspace=".length) || workspaceId
    } else if (a.startsWith("--hours=")) {
      const n = Number(a.slice("--hours=".length))
      if (Number.isFinite(n) && n > 0) lookbackHours = n
    } else if (a === "-h" || a === "--help") {
      console.error(
        "usage: pnpm os:ado-triage [--json] [--workspace=ID] [--hours=N]"
      )
      process.exit(0)
    }
  }
  return { workspaceId, json, lookbackHours }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  try {
    const report = await getAdoTriageReport(opts.workspaceId, {
      lookbackHours: opts.lookbackHours,
    })
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(renderAdoTriageReport(report))
    }
  } catch (e) {
    console.error("os:ado-triage failed:", (e as Error).message)
    console.error((e as Error).stack?.split("\n").slice(0, 12).join("\n"))
    process.exitCode = 1
  } finally {
    await getPgPool().end()
  }
}

main()
