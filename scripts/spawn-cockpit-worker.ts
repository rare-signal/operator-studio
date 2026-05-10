/**
 * Cockpit smoke-test spawn — Berthier-as-exec spawns a Claude worker
 * for the plan-cleanup field report and records the spawn linkage so
 * the cockpit's spawned-by rail surfaces the new chat live.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-worker.ts
 *
 * Environment defaults below; override via env vars if you need to
 * run a different smoke test.
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

// This thread's agent id — David picked it as the exec in the cockpit
// earlier in the session. Override via env if running a different exec.
const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID =
  process.env.COCKPIT_PLAN_STEP_ID ||
  "step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup"

const KICKOFF_PROMPT = `You are a Claude worker spawned by the Operator Studio cockpit's executive Berthier for a two-phase plan-cleanup field report.

**Two-phase mandate. STOP after Phase 1 and surface the field report for David's review. NO writes happen until David approves.**

## Phase 1 — Read-only sweep + field report

1. Read every active plan in Operator Studio. Use the agent-friendly CLI:
   - \`pnpm plan:card list --json\` (active plan)
   - For other plans, query via \`pnpm plan:card list --plan-id=<id> --json\` once you discover them in the DB.
2. For every card across every plan, classify which lane it belongs to:
   - **Clarifying Media Group + Telegento** — JSA / insurance product lane.
   - **Game engine** — Valikharlia and adjacent.
   - **Operator Studio** — the meta lane (this app, including the cockpit work).
   - Propose additional lanes if the data demands. Flag uncertain cards with reasoning.
3. Map every card's full ancestry (parent → grandparent → root) so the cleanup preserves hierarchy.
4. Produce a **field report** as a KB entry (\`pnpm tsx scripts/seed-...\`-style or via the knowledge module's \`upsertEntry\`):
   - Suggested KB id: \`kb-2026-05-09-plan-cleanup-field-report\`.
   - Per source plan: which cards stay, which cards move, where they go.
   - Per destination lane: the proposed parent → child tree.
   - Cards whose lane is ambiguous, with reasoning + recommendation.
   - Any orphaned / stale cards worth retiring.
   - A concrete list of \`pnpm plan:card\` operations (re-parent, status changes, soft-deletes) that would execute the proposal.
5. Write the field report. Then post a final assistant message that includes the literal token \`task_done\` on its own line so the cockpit can detect completion.
6. **Stop. Wait for David's go.**

## Phase 2 — Execute the approved cleanup (only after David explicitly approves)

1. Apply the approved operations via \`pnpm plan:card\` calls.
2. Maintain provenance: each move/delete should leave a comment in the card body (or a related KB note) saying when, why, and from where it moved.
3. Re-pin the active plan to whatever's most relevant (probably Operator Studio).
4. Report back with the new tree summaries per plan, ending with \`task_done\` again.

## Doctrine (read these memory files before starting)

- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl, run \`pnpm typecheck\` instead.
- \`memory/project_no_clis_only_desktop.md\` — David uses Desktop apps exclusively (you are spawned in Claude Code Desktop).

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion.`

async function main() {
  console.log("Spawning cockpit worker for plan-cleanup smoke test…")
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
    rationale: "spawn-cockpit-worker.ts smoke test",
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
