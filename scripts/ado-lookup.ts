/**
 * pnpm os:ado <id> — keyed ADO intake bundle for a fresh agent.
 *
 *   pnpm os:ado 39
 *   pnpm os:ado 39 --json
 *   pnpm os:ado 39 --workspace=ID
 *   pnpm os:ado 39 --comments=12 --git-log=40
 *
 * Reads the local Operator Studio inbox / plan / factory / binding
 * read model. Does NOT call `az boards`. If data is thin, the bundle
 * surfaces deliberate empty markers and a `## Poll hints` section
 * pointing at the refresh command.
 */

import {
  buildAdoIntakeBundle,
  renderAdoIntakeBundle,
} from "../lib/operator-studio/ado-keyed-intake"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"
import { getPgPool } from "../lib/server/db/client"

interface Options {
  workspaceId: string
  workItemId: string | null
  json: boolean
  commentLimit: number | undefined
  gitLogLimit: number | undefined
}

function parseArgs(argv: string[]): Options {
  let workspaceId = GLOBAL_WORKSPACE_ID
  let workItemId: string | null = null
  let json = false
  let commentLimit: number | undefined
  let gitLogLimit: number | undefined
  for (const a of argv) {
    if (a === "--json") json = true
    else if (a === "-h" || a === "--help") {
      console.error(
        "usage: pnpm os:ado <id> [--json] [--workspace=ID] [--comments=N] [--git-log=N]"
      )
      process.exit(0)
    } else if (a.startsWith("--workspace=")) {
      workspaceId = a.slice("--workspace=".length) || workspaceId
    } else if (a.startsWith("--comments=")) {
      const n = Number(a.slice("--comments=".length))
      if (Number.isFinite(n) && n > 0) commentLimit = n
    } else if (a.startsWith("--git-log=")) {
      const n = Number(a.slice("--git-log=".length))
      if (Number.isFinite(n) && n > 0) gitLogLimit = n
    } else if (!a.startsWith("--") && workItemId === null) {
      workItemId = a
    }
  }
  return { workspaceId, workItemId, json, commentLimit, gitLogLimit }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.workItemId) {
    console.error(
      "usage: pnpm os:ado <id> [--json] [--workspace=ID] [--comments=N] [--git-log=N]"
    )
    process.exit(1)
  }
  try {
    const bundle = await buildAdoIntakeBundle(
      opts.workspaceId,
      opts.workItemId,
      {
        commentLimit: opts.commentLimit,
        gitLogLimit: opts.gitLogLimit,
      }
    )
    if (opts.json) {
      console.log(JSON.stringify(bundle, null, 2))
    } else {
      console.log(renderAdoIntakeBundle(bundle))
    }
  } catch (e) {
    console.error("os:ado failed:", (e as Error).message)
    console.error((e as Error).stack?.split("\n").slice(0, 12).join("\n"))
    process.exitCode = 1
  } finally {
    await getPgPool().end()
  }
}

main()
