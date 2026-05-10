/**
 * Cockpit spawn — Berthier self-hydration kickoff template + wire
 * into work-lane "Create new exec" flow. Single-phase mission with
 * a programmatic acceptance gate.
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"
const PLAN_STEP_ID = "step-berthier-self-hydration-smoke-test"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship the Berthier self-hydration kickoff template + wire it into the work-lane "Create new exec" flow.

Read the plan card for the full brief:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\`

Per the card: build a canonical \`buildBerthierKickoff({ laneId, laneName, workspaceId, initialPlanStepId? })\` in lib/operator-studio/berthier-kickoff.ts. Wire into the existing work-lane "set/create exec" flow so the generated kickoff is what gets pasted into the freshly-spawned Claude Desktop session via the existing spawn pipeline.

Acceptance script (\`scripts/berthier-self-hydration-acceptance.ts\`) per the card spec — synthetic ids, assert prompt contains "Berthier", lane name, doctrine memory references, chip emission contract, references to os:worker-done and pnpm plan:card. Sane length range (>2000, <20000 chars).

Doctrine:
- pnpm typecheck green
- memory/feedback_dogfood_first.md, memory/feedback_terse_plain_english.md, memory/feedback_markdown_summaries.md, memory/feedback_no_break_chips.md
- safety cards: synthetic data only; never mutate production GLOBAL workspace

The card's "Out of scope" section explicitly names: meta-Berthier integration, persistent system prompts, per-workspace flavor variants. Don't build those.

Chip emission contract: end with up to 3 \`<<chip:LABEL>>\` on their own lines. Optional \`|DESCRIPTION\` INSIDE the sentinel. Forward-leaning suggestions only.

task_done with: file list touched, summary, kickoff template prompt-length, anything surprising about the existing work-lane exec wiring you discovered.`

async function main() {
  const r = await createNewAppSessionAndSend({ appKind: "claude", prompt: KICKOFF_PROMPT, submit: true })
  if (!r.ok) { console.error("Spawn failed:", r.error); process.exit(1) }
  console.log(`Spawned. reconciled=${r.reconciled} agentId=${r.agentId}`)
  if (!r.reconciled || !r.agentId) { console.error("No agentId reconciled — re-run after JSONL appears."); process.exit(2) }
  const b = await upsertThreadCardBinding({
    workspaceId: GLOBAL_WORKSPACE_ID, agentId: r.agentId, agentKind: "claude",
    planStepId: PLAN_STEP_ID, source: "launch",
    spawnedByAgentId: EXEC_AGENT_ID, spawnOrigin: "cockpit",
    rationale: "spawn-berthier-self-hydration-worker.ts — canonical kickoff template + lane wiring",
  })
  console.log(`Binding written: ${b.id}`)
}
main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
