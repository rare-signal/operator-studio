/**
 * Cockpit spawn — surface the "DONE done = ready for review" signal
 * on worker rows in the cockpit drawer. Uses the existing task_done
 * power-string detector; surfaces the state server-side; renders three
 * visual treatments client-side; plays thread_rest sound on transition.
 *
 * Single-phase mission with a programmatic acceptance gate.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-review-status-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-review-status-on-worker-rows"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to surface a "ready for review" state on cockpit drawer worker rows.

**Single-phase mission.** Read the card, ship the design, prove via the acceptance script, post task_done with the green output.

## Read first

1. Plan card with the full design + David's defaults: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\`
2. \`lib/operator-studio/power-strings.ts\` — the task_done detector you'll reuse (\`task-done-token\` spec).
3. \`lib/operator-studio/thread-card-bindings.ts\` — the bindings primitives.
4. \`app/api/operator-studio/cockpit/spawned-by/route.ts\` — the route that returns workers[]; you extend it.
5. \`lib/server/agent-bridge/app-sessions.ts\` — the JSONL helpers; \`getAppSessionTail\` returns parsed turns.
6. \`app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx\` — the drawer. Has the spawned-by polling + render path.
7. \`app/(operator-studio)/operator-studio/components/sound-context.tsx\` + the existing \`thread_rest\` usage in cockpit-client.tsx — sound infrastructure to plug into.

## What to ship

### Server-side
- Add \`reviewStatus: "live" | "ready-for-review" | "idle"\` to each worker entry returned by \`/api/operator-studio/cockpit/spawned-by\`.
- Computation per worker:
  - Read the worker's JSONL tail (use \`getAppSessionTail\` with a reasonable \`lines\` cap, e.g. 50)
  - Find the last assistant turn. Run \`matchesPowerString(taskDoneSpec, "assistant", content)\` against its content.
  - Find the last user turn. If lastUserTurnIndex > lastAssistantTurnIndex, the worker is back in-flight (David replied after task_done) → \`live\`.
  - If task_done matches in the last assistant turn AND no user turn has come after → \`ready-for-review\`.
  - If no recent activity (use 5 minutes as the idle threshold; tunable constant) AND not ready-for-review → \`idle\`.
  - Otherwise → \`live\`.
- Use \`getPowerStrings().find(s => s.id === "task-done-token")\` to grab the spec; reuse \`matchesPowerString\` from the same module.

### Client-side
- In cockpit-client.tsx, the worker rows already render with status indicators. Extend the render to:
  - Apply distinct visual treatment per \`reviewStatus\`:
    - \`ready-for-review\`: bright highlight + small "✓ awaiting your review" pill
    - \`live\`: subtle existing dot indicator
    - \`idle\`: muted indicator
  - Sort the workers list: ready-for-review first, then live, then idle. Within each group preserve current sort.
- Sound trigger: track previous \`reviewStatus\` per worker in component state. On transition (was NOT ready-for-review, IS now ready-for-review), call the existing thread_rest sound from sound-context. **Do NOT play on initial load** — only on transitions. Initialize the prev-state map from the first poll WITHOUT triggering sound.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate. The acceptance script IS allowed to fetch localhost:4200.
- \`memory/feedback_dogfood_first.md\` — capture follow-on ideas as plan cards.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.

## Acceptance script

Create \`scripts/cockpit-review-status-acceptance.ts\` per the spec in the card body.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale (under ~80 chars). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- Server returns \`reviewStatus\` per worker; values are constrained.
- Cockpit drawer renders three visual states distinctly + ready-for-review pinned to top.
- Sound plays on transition to ready-for-review, NOT on initial load.
- User reply flips a ready-for-review worker back to live.
- \`pnpm typecheck\` green.
- \`pnpm tsx scripts/cockpit-review-status-acceptance.ts\` runs green; paste output.

## Out of scope (carded separately if needed)

- Auto-detach on task_done. David explicitly wants to review the final message before mark-done. The visual flag raises; David clears manually.
- Notification beyond sound (toast, badge, etc.). Sound + visual is enough for v1.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion. Berthier will mark you done via \`pnpm os:worker-done\` once verified.`

async function main() {
  console.log("Spawning cockpit review-status worker…")
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
    rationale: "spawn-cockpit-review-status-worker.ts — surface DONE done signal on drawer rows",
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
