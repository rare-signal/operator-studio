/**
 * pnpm os:planners — preflight Berthier planner/worker backends.
 *
 * This is deliberately read-only. Its job is to stop the executive
 * loop from silently substituting Codex subagents when the operator
 * asked for Claude, Hermes, LM Studio, or another worker surface.
 */

import {
  inspectPlannerBackends,
  renderPlannerBackendReport,
} from "../lib/operator-studio/planner-backends"

async function main() {
  const json = process.argv.includes("--json")
  const report = await inspectPlannerBackends()
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(renderPlannerBackendReport(report))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
