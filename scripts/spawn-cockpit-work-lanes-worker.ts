/**
 * Cockpit spawn — work-lanes MVP. Tertiary container above plans, with
 * cockpit picker + air-gapped per-lane scope. Single-phase mission.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-work-lanes-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-work-lanes-mvp"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship the work-lanes MVP. Single-phase mission with a programmatic acceptance gate.

## Read first

Plan card with the full brief, mental model, scope, and acceptance:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

The earlier "lane management MVP" (\`step-cockpit-lane-management-mvp\`) shipped a workspace-level dropdown + role-conflict guard. That's a building block but it's NOT the work-lanes concept David actually wanted. Your job is the proper next-level container ABOVE plans:

- Work lanes are a NEW first-class container per workspace.
- Each lane is air-gapped: own exec, own worker rail, own pulled-in scope.
- Multiple lanes per workspace, switchable from David's phone via a top-level lane picker.

## What to ship

Per the card body:

1. **Data model**: drizzle/0033_work_lanes.sql with operator_work_lanes + operator_work_lane_membership tables. Apply script.
2. **Lib**: lib/operator-studio/work-lanes.ts with create/list/get/archive lane primitives + member management + setLaneExec (calls into the existing role-conflict guard).
3. **Routes**: POST /work-lanes (create), GET /work-lanes (list), POST /work-lanes/[id]/exec, POST /work-lanes/[id]/members, DELETE /work-lanes/[id]/members/[kind]/[id], POST /work-lanes/[id]/archive.
4. **Cockpit UI** (gitignored bento-view): top-level lane picker, mobile-first, "+ Create new lane" with optional immediate-spawn-fresh-Claude-exec, lane-switch with no page reload.
5. **Migration adapter**: existing workspaces get a "Default lane" auto-created from their current cockpit-execs entry. No data loss.

## Programmatic acceptance

\`scripts/work-lanes-acceptance.ts\` per the card spec — synthetic workspace + lanes + members + archive + role-conflict guard test + migration assertion. Run green before claiming task_done. Per the safety cards \`step-acceptance-scripts-test-isolation\` and \`step-auto-detach-min-threshold-guard\`: tests MUST use synthetic workspace ids, never mutate production GLOBAL data.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate.
- \`memory/feedback_dogfood_first.md\` — capture follow-ons as plan cards.
- \`memory/feedback_terse_plain_english.md\` + \`memory/feedback_markdown_summaries.md\` — final user-facing recap is plain English with markdown structure.
- \`memory/feedback_no_break_chips.md\` — chip suggestions never propose breaks/winding-down. Forward-leaning only.

## Chip emission contract

End substantive turns with up to three \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` INSIDE the sentinel: \`<<chip:LABEL|DESCRIPTION>>\`. Skip if no clear next action. **Forward-leaning suggestions only — never "wind down" / "take a break" / equivalent.**

## Acceptance — what task_done means

- Schema + lib + routes + cockpit UI + migration shipped.
- \`pnpm typecheck\` green.
- \`pnpm tsx scripts/work-lanes-acceptance.ts\` runs green; paste output.
- Final summary in markdown bullets per item.

## Provenance

Spawned by exec \`${EXEC_AGENT_ID}\` against \`${PLAN_STEP_ID}\`.`

async function main() {
  console.log("Spawning work-lanes MVP worker…")
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
    rationale: "spawn-cockpit-work-lanes-worker.ts — tertiary container above plans + mobile picker",
  })
  console.log(`Binding written: ${binding.id}`)
  console.log(`\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
