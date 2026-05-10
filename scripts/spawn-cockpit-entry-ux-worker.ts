/**
 * Cockpit spawn — entry UX fix: persistent exec anointing + create-
 * new-lane as the primary entry CTA, not auto-route into a default lane.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-entry-ux-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-entry-ux-persistent-anointing"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to fix two related entry-UX issues David surfaced 2026-05-10.

## Read first

Plan card with the full brief, both problems, design recommendation, and acceptance:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

## Problems

1. **Exec selection isn't persistent across reloads.** Today the cockpit reads localStorage for the active exec. On reload (different device, different origin, cleared cache, ngrok vs LAN), it loses the selection and asks David to "pick an executive." Wrong — picking an exec is an "anointing." The backend already persists per-lane in operator_work_lanes.exec_agent_id; the cockpit just isn't reading from it as the source of truth.

2. **"Default lane" auto-routing is the wrong primary entry experience.** The work-lanes MVP backfilled a Default lane per workspace for backward compat. But David's framing is: most of the time the ergonomic flow is "create new lane → start brand new exec chat." The default lane should NOT auto-route. Show the lane picker first; let users tap into an existing lane OR create a new one.

## What to ship (per the card body)

- cockpit-client.tsx: on mount, fetch /api/operator-studio/work-lanes for the active workspace. If no lanes exist → show "+ Create new lane" CTA prominently. If lanes exist → show them as the entry list. localStorage is at most a "last lane I had open" hint; never the source of truth.
- /api/operator-studio/work-lanes GET: ensure response includes per-lane exec metadata (exec_agent_id, exec label, last activity, live worker count, ready-for-review count) so the entry picker can show at-a-glance state.
- New cockpit "lane picker view" (top-level state): list of lanes + "+ Create new lane" CTA always visible. Each row shows name, description, exec, counts, last activity. Tap to enter.
- Inside a lane: existing cockpit experience + a "back to lanes" affordance in the header.
- Default-lane handling: don't special-case the backfilled Default lane. It's just one row in the picker; David decides whether to use it or create a new one.

## Programmatic acceptance

scripts/cockpit-entry-ux-acceptance.ts per the card spec — synthetic workspaces with 0 lanes / 2 lanes / Default-lane-only, asserting API responses and entry-state behavior. Synthetic data only per the safety cards.

## Doctrine

- pnpm typecheck green.
- memory/feedback_no_browser_or_curl_verification.md — typecheck is the gate.
- memory/feedback_dogfood_first.md — KB + cards over stray markdown.
- memory/feedback_terse_plain_english.md + memory/feedback_markdown_summaries.md — final user-facing recap is plain English with markdown structure.
- memory/feedback_no_break_chips.md — chip suggestions forward-leaning only.

## Chip emission contract

End substantive turns with up to three <<chip:LABEL>> lines (each on its own line). Optionally append |DESCRIPTION INSIDE the sentinel: <<chip:LABEL|DESCRIPTION>>. Skip if no clear next action. Forward-leaning suggestions only.

## Acceptance — what task_done means

- Cockpit reads exec state from backend, not localStorage. Reload preserves anointing.
- Lane picker view shows lanes list + create-new CTA. No auto-route into Default lane.
- pnpm typecheck green.
- pnpm tsx scripts/cockpit-entry-ux-acceptance.ts runs green; paste output.
- Final summary in markdown bullets.

## Provenance

Spawned by exec ${EXEC_AGENT_ID} against ${PLAN_STEP_ID}.`

async function main() {
  console.log("Spawning cockpit entry UX worker…")
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
    rationale: "spawn-cockpit-entry-ux-worker.ts — persistent anointing + lane picker as primary entry",
  })
  console.log(`Binding written: ${binding.id}`)
  console.log(`\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
