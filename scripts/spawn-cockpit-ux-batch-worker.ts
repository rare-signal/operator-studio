/**
 * Cockpit spawn — UX batch (4 items): paste-flash hard-cap, detach
 * reason column, last-message preview on worker rows, auto-detach
 * safety net for stale ready-for-review workers.
 *
 * Single-phase mission with a programmatic acceptance gate.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-ux-batch-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-ux-batch-2026-05-10"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship a 4-item UX batch for the cockpit. Single-phase mission with a programmatic acceptance gate.

## Read first

1. Plan card with the full brief for all 4 items: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\` — has acceptance per item.
2. Sibling cards referenced:
   - \`step-cockpit-paste-flash-fix\` — Item 1 detailed history.
   - \`step-binding-detach-reason-column\` — Item 2 history.

## What to ship (all 4 in one PR)

### 1. Paste-flash hard-cap
- \`app/api/operator-studio/agents/[id]/snapshot/route.ts\`: drop the lastUser-anchor slice; replace with \`tail.turns.slice(-100)\` (100 default; respects existing \`?lines=\` param).
- \`lib/server/agent-bridge/types.ts\`: drop \`earlierTurnsHidden\` from AgentSnapshot.
- (gitignored bento-view if it references \`earlierTurnsHidden\`: remove the references.)

### 2. Detach reason column
- New migration \`drizzle/0032_binding_detach_reason.sql\`: \`ALTER TABLE operator_thread_card_bindings ADD COLUMN IF NOT EXISTS detach_reason TEXT;\`
- New apply script \`scripts/apply-binding-detach-reason-migration.ts\` (drizzle journal still pre-0029; use the same pattern as other apply-*-migration scripts).
- \`lib/server/db/schema.ts\`: add \`detachReason: text("detach_reason")\` to operatorThreadCardBindings.
- \`lib/operator-studio/thread-card-bindings.ts\`: \`detachThreadCardBinding(workspaceId, agentId, detachReason?)\` accepts optional reason; persists to column. \`ThreadCardBinding\` interface gains \`detachReason: string | null\`. \`rowToBinding\` maps it.
- \`scripts/cockpit-mark-done.ts\`: pass \`--reason\` arg through to the lib call.
- \`app/api/operator-studio/cockpit/spawned-by/route.ts\`: include \`detachReason\` per recently-completed worker so the drawer can surface it.
- (gitignored bento-view: \`why:\` line on recently-completed should prefer detachReason over creation rationale when present.)

### 3. Last-message preview on worker rows
- \`app/api/operator-studio/cockpit/spawned-by/route.ts\`: extend \`workers[]\` entries with \`lastAssistantSnippet: string | null\`. Compute by reading the worker's JSONL tail (reuse \`getAppSessionTail\` with a small \`lines\` cap, e.g. 20), find the last assistant turn, take the first text part, trim to 80 chars + "…" if longer. Null when no assistant turn yet.
- (gitignored bento-view: render snippet under each worker row label, subtle styling, single line.)

### 4. Auto-detach safety net
- New lib function \`autoDetachStaleReadyWorkers(workspaceId, thresholdMs = 60 * 60_000)\` in \`lib/operator-studio/thread-card-bindings.ts\` (or a sibling file if you prefer). For each active binding in the workspace:
  - Compute reviewStatus using the helper Worker 26 just shipped (probably exposed via \`lib/operator-studio/...\`; find it and reuse).
  - If \`reviewStatus === "ready-for-review"\` AND \`(now - updatedAt) > thresholdMs\`: detach with \`detachReason = "auto-detached after 60min ready-for-review"\`.
- Wire into the spawned-by route handler — call before computing the response. Cheap (bounded by active worker count).
- Configurable via \`OPERATOR_STUDIO_AUTO_DETACH_MINUTES\` env var (default 60; "0" disables).
- David's earlier doctrine was "no auto-detach", but recently-completed preserves visibility (he can still review final messages by tapping into the recently-completed worker), and he explicitly greenlit this safety-net version 2026-05-10 to stop the smoke-test bloat.

## Acceptance script

Create \`scripts/cockpit-ux-batch-acceptance.ts\` covering:
1. Snapshot returns ≤100 turns by default; \`earlierTurnsHidden\` field absent.
2. Detach reason: mark a synthetic binding done with \`--reason="X"\`, query the row, assert \`detach_reason = "X"\`. spawned-by route returns the detachReason for that worker.
3. workers[] entries include \`lastAssistantSnippet\` (null or string ≤80 chars + "…" if truncated).
4. \`autoDetachStaleReadyWorkers\` lib function exists and respects threshold (test with a small synthetic threshold like 1 second; spawn a synthetic ready-for-review binding, wait, call the function, assert it detaches).

The script is the new acceptance gate. Run it green, paste output in your final message.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate. Acceptance script may fetch localhost:4200 (programmatic-gate model).
- \`memory/feedback_dogfood_first.md\` — capture follow-on ideas as plan cards.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.
- \`memory/feedback_markdown_summaries.md\` — final recap uses markdown structure (headers/bullets), not dense paragraphs.

## Chip emission contract

When you finish a substantive turn, end with up to three \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` INSIDE the sentinel for a one-line "why pick this now" rationale: \`<<chip:LABEL|DESCRIPTION>>\` (canonical form — pipe goes INSIDE the closing >>; the parser tolerates outside-pipe but inside is canonical). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- All 4 items shipped + committable code touches typecheck green.
- \`pnpm tsx scripts/cockpit-ux-batch-acceptance.ts\` runs green; paste output.
- Final summary as markdown bullets per item, naming files touched.
- task_done + chips.

## Provenance

Spawned by exec \`${EXEC_AGENT_ID}\` against \`${PLAN_STEP_ID}\`. Berthier marks done via \`pnpm os:worker-done\` after acceptance + David's eyes on UI side.`

async function main() {
  console.log("Spawning cockpit UX batch worker…")
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
    rationale: "spawn-cockpit-ux-batch-worker.ts — paste-flash + detach reason + last-message preview + auto-detach safety net",
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
