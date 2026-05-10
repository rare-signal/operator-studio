/**
 * Cockpit spawn — CMG/JSA software factory battle-test discovery.
 * Single-phase, discovery only. Output is a KB entry + structured
 * implementation-card proposals.
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const PLAN_STEP_ID = "step-cmg-jsa-battle-test-discovery"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to scope the CMG/JSA software factory battle test — David's stated 80%-of-compute priority. Discovery only; no implementation.

Read the plan card for the full brief, then ship the KB entry per the spec:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

Use \`pnpm wayseer:search\` for prior context. Read the JSA cards under plan-clarifying-media-group-telegento. Survey existing ADO scaffolding in lib/operator-studio/ado-*.ts and the API routes. Find or note the absence of Teams primitives. Output kb-2026-05-10-cmg-jsa-battle-test-scope with the structured sections David approved.

Don't auto-create child cards. Recommend them in section 6 of the KB; David greenlights what to spawn.

Doctrine:
- pnpm typecheck green; acceptance script (\`scripts/cmg-jsa-battle-test-scope-acceptance.ts\`) green per the card spec
- memory/feedback_dogfood_first.md, memory/feedback_terse_plain_english.md, memory/feedback_markdown_summaries.md, memory/feedback_no_break_chips.md
- safety cards: synthetic data only in tests, never mutate production scope

Chip emission: end with up to 3 \`<<chip:LABEL>>\` lines on their own lines. Optional |DESCRIPTION inside the sentinel: \`<<chip:LABEL|DESCRIPTION>>\`. Forward-leaning suggestions only.

task_done with KB entry id + top 3-5 recommended cards in the final summary.`

async function main() {
  const r = await createNewAppSessionAndSend({ appKind: "claude", prompt: KICKOFF_PROMPT, submit: true })
  if (!r.ok) { console.error("Spawn failed:", r.error); process.exit(1) }
  console.log(`Spawned. reconciled=${r.reconciled} agentId=${r.agentId}`)
  if (!r.reconciled || !r.agentId) { console.error("No agentId reconciled — re-run after JSONL appears."); process.exit(2) }
  const b = await upsertThreadCardBinding({
    workspaceId: GLOBAL_WORKSPACE_ID, agentId: r.agentId, agentKind: "claude",
    planStepId: PLAN_STEP_ID, source: "launch",
    spawnedByAgentId: EXEC_AGENT_ID, spawnOrigin: "cockpit",
    rationale: "spawn-cmg-jsa-discovery-worker.ts — scope the 80%-of-compute lane",
  })
  console.log(`Binding written: ${b.id}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
