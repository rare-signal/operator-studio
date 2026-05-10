/**
 * Cockpit spawn — multi-tier review state machine. Distinguishes
 * berthier-reviewed from human-approved; surfaces the interstitial
 * risk of work that passed only one gate.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-multi-tier-review-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-multi-tier-review-state-machine"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship the multi-tier review state machine. Single-phase mission with a programmatic acceptance gate.

## Read first

Plan card with the full brief, schema, contract, UI rules, and acceptance:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

The current single-tier reviewStatus (live | ready-for-review | idle) masks an **interstitial risk** David flagged 2026-05-10: work that Berthier acknowledged but David never personally validated can rot silently. We need to surface that gap explicitly.

## What to ship

Per the card body:

1. **Schema**: drizzle/0034_review_tier_timestamps.sql adds berthier_reviewed_at + human_approved_at to operator_thread_card_bindings. Apply script.
2. **Lib**: extend lib/operator-studio/review-status.ts with the new enum (live | candidate-self-believed | awaiting-berthier-check | berthier-reviewed | human-approved | idle). Update computeReviewStatus to read the two new timestamps. Update autoDetachStaleReadyWorkers to NEVER fire on candidate-self-believed or awaiting-berthier-check (regardless of threshold), and to ONLY fire on berthier-reviewed after a much longer threshold (24h default).
3. **Lib**: lib/operator-studio/thread-card-bindings.ts gets two new functions: setBerthierReviewedAt(workspaceId, agentId, reason?) and setHumanApprovedAt(workspaceId, agentId, reason?). Plus existing detachThreadCardBinding can take human_approved=true to set both.
4. **CLI**: scripts/cockpit-berthier-ack.ts — pnpm os:berthier-ack --agent=<id> --reason="..." sets berthier_reviewed_at without detaching. Add to package.json scripts.
5. **CLI**: scripts/cockpit-mark-done.ts — extend so that pnpm os:worker-done sets BOTH human_approved_at AND detached_at (semantics: David explicitly signs off + retires).
6. **API**: cockpit/spawned-by route returns the new reviewStatus per worker. Sort order: awaiting-berthier-check > berthier-reviewed > live > idle > human-approved.
7. **UI** (gitignored bento-view): distinct visual treatments per state per the card's UI clarity rules. Yellow pill for awaiting-berthier-check, amber for berthier-reviewed (existing), muted green for human-approved.
8. **Cockpit affordance**: tap a berthier-reviewed worker → modal with "Acknowledge as human-approved" + "Send back for revision".
9. **KB entry**: kb-2026-05-10-multi-tier-review-state-machine capturing the doctrine — why three tiers, state diagram, operator playbook, anti-patterns.

## Programmatic acceptance

scripts/multi-tier-review-acceptance.ts walks through each transition with synthetic data per the card spec. Per safety cards: synthetic workspace ids only; never mutate GLOBAL.

## Doctrine

- pnpm typecheck green.
- memory/feedback_no_browser_or_curl_verification.md — typecheck is the gate.
- memory/feedback_dogfood_first.md — KB + cards over stray markdown.
- memory/feedback_terse_plain_english.md + memory/feedback_markdown_summaries.md — final user-facing recap is plain English with markdown structure.
- memory/feedback_no_break_chips.md — chip suggestions forward-leaning only.
- memory/step-acceptance-scripts-test-isolation rationale — synthetic data only in tests.
- memory/step-auto-detach-min-threshold-guard rationale — your auto-detach changes inherit + extend the existing safety guard.

## Chip emission contract

End substantive turns with up to three <<chip:LABEL>> lines (each on its own line). Optionally append |DESCRIPTION INSIDE the sentinel: <<chip:LABEL|DESCRIPTION>>. Skip if no clear next action. Forward-leaning suggestions only.

## Acceptance — what task_done means

- Schema + migration applied + apply script committable.
- Lib + CLI + routes + UI all shipped.
- KB entry exists.
- pnpm typecheck green.
- pnpm tsx scripts/multi-tier-review-acceptance.ts runs green; paste output.
- Final summary in markdown bullets.

## Provenance

Spawned by exec ${EXEC_AGENT_ID} against ${PLAN_STEP_ID}.`

async function main() {
  console.log("Spawning multi-tier review state worker…")
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
    rationale: "spawn-multi-tier-review-worker.ts — surface interstitial risk between berthier-reviewed and human-approved",
  })
  console.log(`Binding written: ${binding.id}`)
  console.log(`\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
