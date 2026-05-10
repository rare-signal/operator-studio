/**
 * Seed the 2026-05-09 plan-cleanup field report into the OS knowledge base.
 *
 * Phase 1 deliverable from the cockpit-spawned worker. No plan writes — this
 * is just the read-only sweep + proposal. Phase 2 executes only after David
 * approves the plan in this entry.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { upsertEntry } from "../lib/operator-studio/knowledge"
import { GLOBAL_WORKSPACE_ID } from "../lib/operator-studio/workspaces"

async function main() {
  const body = readFileSync(
    resolve(process.cwd(), "scripts/data/plan-cleanup-field-report-2026-05-09.md"),
    "utf8"
  )

  const entry = await upsertEntry(GLOBAL_WORKSPACE_ID, {
    id: "kb-2026-05-09-plan-cleanup-field-report",
    title: "Plan-cleanup field report — 2026-05-09 (Phase 1)",
    summary:
      "Read-only sweep across 5 plans / 437 cards. Proposes a three-plan split (Operator Studio meta · Clarifying Media Group + Telegento · Valikharlia game engine), retires three trash plans, normalizes Valikharlia statuses. Phase 2 executes only after David approves.",
    bodyMarkdown: body,
    entryType: "report",
    stability: "draft",
    tags: [
      "operator-studio",
      "plan-cleanup",
      "phase-1",
      "field-report",
      "operations",
    ],
    metadata: {
      executiveBerthier: "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6",
      sourceCard: "step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup",
      phase: "1-readonly",
      writesPerformed: false,
    },
  })

  console.log(`upserted KB entry: ${entry.id} (version ${entry.versionCount})`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
