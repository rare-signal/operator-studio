/**
 * Cockpit spawn — meta-Berthier discovery (orchestrator-of-orchestrators
 * design + connectors). Discovery only; no implementation. Output is a
 * KB entry + scoping recommendation.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-meta-berthier-discovery-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-meta-berthier-discovery"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to design the meta-Berthier — an orchestrator-of-orchestrators that watches all active work lanes and orchestrates between them.

Discovery mission. No implementation. Output is a KB entry + scoping recommendation for the future implementation card.

## Read first

Plan card with the full brief:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

Sibling card you sit on top of:
\`pnpm plan:card show --id=step-cockpit-work-lanes-mvp --plan-id=plan-1777793035871-dkq1b8\` — the work-lanes MVP that defines the substrate meta-Berthier observes. Read this carefully so your design assumes the right primitives.

## What to ship

A KB entry \`kb-2026-05-10-meta-berthier-design\` with these sections:

1. **TL;DR** — 3-4 sentences: what meta-Berthier is, what it sees, what it decides.
2. **Read scope** — what does meta-Berthier see across lanes? List of active lanes per workspace, per-lane state (exec, worker counts, ready-for-review counts, last activity, recent task_done parrots), per-lane pulled-in members, cross-lane signals (same plan card touched by multiple lanes, stale lanes, lanes with idle workers).
3. **Write scope** — what does meta-Berthier DO? Suggestions only (David approves all execution): move worker between lanes, archive stale lanes, create new lanes for emerging work, surface aggregated phone screen.
4. **Connectors** — what API endpoints does it need? GET /api/operator-studio/meta/all-lanes-snapshot, GET /api/operator-studio/meta/cross-lane-conflicts, GET /api/operator-studio/meta/stale-lanes. Specify response shapes.
5. **Architecture** — is meta-Berthier just another Berthier with a different system prompt + different read scope, OR a structurally different agent kind? Recommend with rationale. (David's "recursive" framing suggests the former; verify.)
6. **Recommended next moves** — smallest first-ship of meta-Berthier that delivers value. Probably: just the all-lanes-snapshot endpoint + a minimal system-prompt template for promoting a Claude session as "meta-Berthier" of a workspace. No write actions yet.

## Don't

- No auto-creating an implementation card. Recommend it in section 6 — David creates.
- No code outside of the KB entry. This is design discovery.
- No implementation of the meta-Berthier itself. Just the design.

## Programmatic acceptance

\`scripts/meta-berthier-discovery-acceptance.ts\` asserts the KB entry exists, body length > 3000 chars, contains all section headers above. Per the safety cards: tests use synthetic data, no production mutation.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate.
- \`memory/feedback_dogfood_first.md\` — KB entries + plan cards over stray markdown.
- \`memory/feedback_terse_plain_english.md\` + \`memory/feedback_markdown_summaries.md\` — final user-facing recap is plain English with markdown structure.
- \`memory/feedback_no_break_chips.md\` — chip suggestions are forward-leaning only.

## Chip emission contract

End substantive turns with up to three \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` INSIDE the sentinel. **Forward-leaning suggestions only — never "wind down" / "take a break" / equivalent.**

## Acceptance — what task_done means

- KB entry exists with the right structure.
- \`pnpm tsx scripts/meta-berthier-discovery-acceptance.ts\` runs green; paste output.
- Final summary in markdown bullets: KB entry id, top recommendation for the smallest first-ship, any architectural surprises.

## Provenance

Spawned by exec \`${EXEC_AGENT_ID}\` against \`${PLAN_STEP_ID}\`.`

async function main() {
  console.log("Spawning meta-Berthier discovery worker…")
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
    rationale: "spawn-meta-berthier-discovery-worker.ts — orchestrator-of-orchestrators design",
  })
  console.log(`Binding written: ${binding.id}`)
  console.log(`\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
