/**
 * Cockpit spawn — research worker for push notification options
 * (customer-of-one mobile alerts for David only). Discovery; no
 * implementation. Output is a KB entry + recommendation.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-push-notification-research-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-push-notification-research"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to research the best push notification solution for David's customer-of-one mobile-alert needs.

Discovery mission. No implementation. Output is a KB entry comparing options + a single recommendation.

## Read first

Plan card with the full brief, criteria, options to evaluate, and acceptance:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

## Key context

- David is the only user (customer-of-one). Free-tier strongly preferred.
- Use case: alert his phone when cockpit work needs attention (workers transitioning to ready-for-review, blockers, etc.) without depending on the cockpit tab being foregrounded.
- He's on macOS + iPhone. Past reference: Pushover was a known option years ago.
- He's open to anything: dedicated apps, Telegram, ntfy, even SMS or iMessage automation.

## What to ship

A KB entry \`kb-2026-05-10-push-notification-options-for-customer-of-one\` with:
1. TL;DR with recommendation
2. Comparison table (rows = options, columns = criteria)
3. Top 3 deep-dives with curl-style integration sketch
4. Single explicit recommendation + smallest-first-ship sketch
5. Hooks needed in operator-studio (what server-side wiring needs to land)
6. Open questions for David

Per the card body: at least 5 distinct options evaluated by name. Markdown comparison table required.

## Doctrine

- \`pnpm typecheck\` green.
- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate.
- \`memory/feedback_dogfood_first.md\` — KB entry, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` + \`memory/feedback_markdown_summaries.md\` — final user-facing recap is plain English with markdown structure.
- \`memory/feedback_no_break_chips.md\` — chip suggestions forward-leaning only. Never "wind down" / "take a break" / equivalent.

## Programmatic acceptance

\`scripts/push-notification-research-acceptance.ts\` per the card spec. Run green; paste output before claiming task_done.

## Chip emission contract

End substantive turns with up to three \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` INSIDE the sentinel: \`<<chip:LABEL|DESCRIPTION>>\`. Skip if no clear next action. **Forward-leaning suggestions only.**

## Acceptance — what task_done means

- KB entry exists with the right structure.
- \`pnpm tsx scripts/push-notification-research-acceptance.ts\` runs green; paste output.
- Final summary in markdown bullets: recommended option, top-3 alternatives ranked, smallest-first-ship sketch.

## Provenance

Spawned by exec \`${EXEC_AGENT_ID}\` against \`${PLAN_STEP_ID}\`.`

async function main() {
  console.log("Spawning push-notification research worker…")
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
    console.error("No agentId reconciled — re-run after JSONL appears.")
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
    rationale: "spawn-push-notification-research-worker.ts — customer-of-one mobile alerts research",
  })
  console.log(`Binding written: ${binding.id}`)
  console.log(`\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
