/**
 * Cockpit spawn — implement the push-notification recommendation
 * from this morning's KB; wire to ready-for-review transitions.
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const PLAN_STEP_ID = "step-push-notification-implementation"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to implement the push-notification path David needs.

Read the plan card for the full brief:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

CRITICAL FIRST STEP: read this morning's research KB to get the recommended option. Use the knowledge module (look in lib/operator-studio/knowledge.ts or similar) to fetch entry id \`kb-2026-05-10-push-notification-options-for-customer-of-one\`. Implement THE recommendation in section 4 of that KB; don't second-guess it.

Then per the card body:
1. lib/operator-studio/notifier.ts with notify({ title, body, url? }) hitting the chosen provider
2. Trigger point in spawned-by route (or sibling) detecting transitions FROM not-ready-for-review TO ready-for-review (or stronger un-approved tiers)
3. Env var OPERATOR_STUDIO_NOTIFICATIONS_ENABLED (default 1)
4. Setup instructions in scripts/data/push-notification-setup-2026-05-10.md and at top of notifier.ts

Acceptance script per the card.

Doctrine:
- pnpm typecheck green
- memory/feedback_dogfood_first.md, memory/feedback_terse_plain_english.md, memory/feedback_markdown_summaries.md, memory/feedback_no_break_chips.md
- safety cards: synthetic data only; the test must NOT actually fire a notification to David's phone (use a no-op or test endpoint mode)

Chip emission contract: end with up to 3 \`<<chip:LABEL>>\` on their own lines. Optional \`|DESCRIPTION\` INSIDE the sentinel. Forward-leaning suggestions only.

task_done with: provider chosen, exact setup steps for David, files touched, acceptance script output.`

async function main() {
  const r = await createNewAppSessionAndSend({ appKind: "claude", prompt: KICKOFF_PROMPT, submit: true })
  if (!r.ok) { console.error("Spawn failed:", r.error); process.exit(1) }
  console.log(`Spawned. reconciled=${r.reconciled} agentId=${r.agentId}`)
  if (!r.reconciled || !r.agentId) { console.error("No agentId reconciled — re-run after JSONL appears."); process.exit(2) }
  const b = await upsertThreadCardBinding({
    workspaceId: GLOBAL_WORKSPACE_ID, agentId: r.agentId, agentKind: "claude",
    planStepId: PLAN_STEP_ID, source: "launch",
    spawnedByAgentId: EXEC_AGENT_ID, spawnOrigin: "cockpit",
    rationale: "spawn-push-notif-impl-worker.ts — wire push notifications per KB recommendation",
  })
  console.log(`Binding written: ${b.id}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
