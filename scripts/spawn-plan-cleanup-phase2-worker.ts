/**
 * Cockpit spawn — Phase 2 of the plan-cleanup field report. Worker 1
 * shipped Phase 1 (read-only field report) on 2026-05-09; David has
 * approved the proposed end-state. This worker executes the moves.
 *
 * Single-phase mission with a programmatic acceptance gate.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-plan-cleanup-phase2-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to execute Phase 2 of the plan-cleanup field report.

**Single-phase mission.** Worker 1 shipped Phase 1 (the read-only field report) on 2026-05-09 and David has approved the proposed end-state. You execute the moves. Programmatic acceptance gate — no visual verification dependency.

## Read first (in this order)

1. **The committed field report**: \`scripts/data/plan-cleanup-field-report-2026-05-09.md\`. Read end-to-end. This IS your blueprint — every move you make should match a proposal in that report.
2. The plan card that this work is bound to: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\` — has the original Phase 1+2 mandate and an "Iteration 2" addendum (which was about a different concern; Phase 2 here is the cleanup execution from the field report).
3. \`pnpm plan:card --help\` — the CLI you'll use for every move.

## What to ship

Execute the field report's proposal. Summary:

### Plan A — Operator Studio meta (reuse plan-1777793035871-dkq1b8)
- Re-pin as the active plan (per field report — currently pinned).
- Receive the 153 cards from the Valikharlia plan that the report classifies as OS-meta.
- Create the 6 proposed bucket cards as new top-level lanes for incoming cards: \`step-os-software-factory-spine\`, \`step-os-agent-orchestration\`, \`step-os-operations-desk\`, \`step-os-idea-gravity\`, \`step-os-product-launch-media\`, \`step-os-context-and-recency\`.
- Re-parent the migrated Valikharlia cards under the appropriate buckets per the field report's "Card-level moves — Valikharlia → OS" section.
- Migrate the 6 non-trash cards from \`plan-draft-t-1776930795204\` ("Ship the OSS treatment") under \`step-B\`.

### Plan B — Clarifying Media Group + Telegento (NEW)
- Create plan id \`plan-clarifying-media-group-telegento\`, workspace \`global\`, state \`active\`.
- Receive the 104 cards from OS-era plan classified as CMG/Telegento (lanes \`step-C\`, \`step-C-pipeline\`, \`step-C-cd\`, \`step-E\`, \`step-H\` and their subtrees).
- Receive the 37 \`step-telegento-*\` cards from the Valikharlia plan + \`step-software-factory-clarifying-telegento\` subtree.
- Create the proposed top-level lanes: \`step-cmg-jsa-product\`, \`step-cmg-telegento-pipeline\`, \`step-cmg-telegento-product\`, \`step-cmg-telegento-demo-readiness\`, \`step-cmg-cd-safety\`.

### Plan C — Valikharlia Engine (game) — strip down
- Reuse \`plan-valikharlia-agentic-studio-buildout\`.
- After the migrations above, only ~25 \`step-valikharlia-*\` cards + \`step-side-game-engine-lane\` remain.
- Status normalization: \`done\` → \`covered\`, \`todo\` → \`open\`, \`in_progress\` → \`in-motion\`. 24 cards affected.
- Unpin (Plan A becomes the active pin).

### Trash — soft-delete
- \`plan-draft-global-1776926241051\` ("Step one") — 4 placeholder cards.
- \`plan-session-t-2026-04-22T18-15\` ("Session plan") — 1 "test" card in workspace \`t\`.
- \`plan-draft-t-1776930795204\` ("Ship the OSS treatment") — after migrating its 6 OS cards, retire the plan + its 6 placeholder children.
- 12 trash cards total + 3 plans retired.

## Provenance — required on every move

Per the field report: each moved/deleted card should leave a comment in its body (or a related KB note) saying when, why, and from where it moved. Use \`pnpm plan:card upsert --id=<card> --description-file=<file>\` to append a provenance line to the card's existing description before/during the move.

Suggested provenance line template:
\`\`\`
> _2026-05-10 plan-cleanup: moved from <source-plan> to <dest-plan> per scripts/data/plan-cleanup-field-report-2026-05-09.md._
\`\`\`

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate. Acceptance script is allowed to hit localhost:4200.
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.

## Acceptance script

Create \`scripts/plan-cleanup-acceptance.ts\` that:
- Queries the operator_plans table directly (or hits a plans-list endpoint if one exists)
- Asserts exactly 3 plans remain in active state: plan-1777793035871-dkq1b8 (OS-meta, pinned), plan-clarifying-media-group-telegento (CMG+Telegento), plan-valikharlia-agentic-studio-buildout (Valikharlia, unpinned)
- Asserts the 3 trash plans are soft-deleted (deletedAt IS NOT NULL)
- Asserts the Valikharlia plan has ≤ 30 active cards (target ~25 + buffer)
- Asserts every Valikharlia card has status in {open, in-motion, covered, skipped} (no done/todo/in_progress)
- Asserts the 6 new OS-meta bucket cards exist as top-level lanes in plan-1777793035871-dkq1b8
- Asserts the 5 new CMG+Telegento top-level lanes exist
- Exits 0 on green; prints which assertion failed and exits 1 on red

The script is the new acceptance gate. You ship task_done ONLY when it runs green.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale (under ~80 chars). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- All moves from the field report executed.
- \`pnpm typecheck\` green.
- \`pnpm tsx scripts/plan-cleanup-acceptance.ts\` runs green; paste the output.
- Final summary of: cards moved, cards retired, plans retired, status normalizations applied.
- Then end with \`task_done\` and chips.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion. Berthier will mark you done via \`pnpm os:worker-done\` once verified.`

async function main() {
  console.log("Spawning plan-cleanup Phase 2 worker…")
  console.log(`  exec: ${EXEC_AGENT_ID}`)
  console.log(`  plan step: ${PLAN_STEP_ID}`)

  const result = await createNewAppSessionAndSend({
    appKind: "claude",
    prompt: KICKOFF_PROMPT,
    submit: true,
  })

  if (!result.ok) {
    console.error("Spawn failed:", result.error)
    process.exit(1)
  }

  console.log(`Spawned. reconciled=${result.reconciled} agentId=${result.agentId}`)

  if (!result.reconciled || !result.agentId) {
    console.error(
      "No agentId reconciled — the worker started but cockpit linkage cannot be recorded yet. Re-run after the JSONL appears."
    )
    process.exit(2)
  }

  const binding = await upsertThreadCardBinding({
    workspaceId: GLOBAL_WORKSPACE_ID,
    agentId: result.agentId,
    agentKind: "claude",
    planStepId: PLAN_STEP_ID,
    source: "launch",
    spawnedByAgentId: EXEC_AGENT_ID,
    spawnOrigin: "cockpit",
    rationale: "spawn-plan-cleanup-phase2-worker.ts — execute the field report's moves",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await getPgPool().end()
  })
