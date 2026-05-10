/**
 * Cockpit smoke-test spawn #4 — Berthier-as-exec spawns a Claude worker
 * to implement Phase 2 of the exec chip system: cockpit render + tap
 * behavior + spawn-prompt addendum.
 *
 * Unlike Workers 1-3, this is a SINGLE-PHASE mission. The design was
 * already reviewed and simplified by David in this session (chips are
 * next-message suggestions, not typed actions). Worker 4 ships
 * implementation, then posts task_done. No Phase-1-then-pause.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-chip-system-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-exec-chip-system"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to implement Phase 2 of the exec chip system.

**Single-phase mission.** The design was reviewed + simplified by David in this session. You ship the implementation, then post \`task_done\`. There is no "Phase 1 field report; pause" — the field report already exists and is approved. You build.

## Read first

1. \`scripts/data/exec-chip-system-design-2026-05-09.md\` — the simplified design brief. **Read end-to-end before touching code.** Key points:
   - Sentinel syntax: \`<<chip:LABEL>>\` — literal label, no JSON.
   - Tap: fills chat input with the label, focuses input. **Do NOT auto-send.**
   - No registry, no handler dispatch, no API route. Chip "dispatch" is the agent's next turn responding to the chip text as a normal user message.
2. \`lib/operator-studio/chip-actions.ts\` — the parser + stripper. Already wired + typecheck-clean. You import \`parseChipsFromMessage\` and \`stripChipSentinels\`.
3. \`lib/operator-studio/chip-actions.test.ts\` — 11 tests passing. You don't need to add tests for the parser; you DO need to add at least one component test for the chip render (vitest + RTL pattern that already exists in the repo if any; otherwise just a typecheck-only smoke component).
4. The plan card body: \`pnpm plan:card show --id=step-exec-chip-system --plan-id=plan-valikharlia-agentic-studio-buildout\` — has the Phase 2 scope.

## What to build

### 1. Render chips in the cockpit message list

- Find where assistant messages are rendered in \`app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx\` (or its child components — search for the assistant-role render path; the BentoPane reuse mentioned in plan card \`step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup\` is the relevant surface).
- For each assistant message body:
  - Call \`parseChipsFromMessage(content)\` to get the chip list.
  - Call \`stripChipSentinels(content)\` to get the body to render.
  - Render the stripped content as the message body (whatever markdown render path is in use).
  - Below the body, render a horizontal flex row of pill buttons — one per chip.
- Tap behavior: clicking a pill fills the chat input with the chip's \`label\` and focuses the input. **Do NOT auto-send.** The user reviews + edits + sends manually. (Future override — Cmd/Shift-click to auto-send — is out of scope.)

### 2. Same render in the executive thread

- The Berthier-to-David exec thread renders through the same cockpit components. Confirm chips render there too (Berthier emitting → David sees pills).
- If the exec thread has a different render path, mirror the same parse + strip + pills + tap behavior.

### 3. Spawn-prompt addendum

- Append the chip-emission contract to the kickoff prompts in:
  - \`scripts/spawn-cockpit-worker.ts\`
  - \`scripts/spawn-cockpit-cross-platform-worker.ts\`
  - \`scripts/spawn-cockpit-pending-affordance-worker.ts\`
- The addendum text (lift verbatim from the design brief, "Spawn-prompt addendum" section):

> When you finish a substantive turn (a deliverable, a status, a decision point), end with **up to three** \`<<chip:...>>\` lines representing the most likely next user messages — concrete, self-contained, ready-to-send. Each \`<<chip:...>>\` should be its own line. The LABEL inside the sentinel is the literal text that will become the user's next message when they tap the chip, so write it as a complete request the receiving agent can act on without further context. Skip chips entirely if no clear next-action stands out.

### 4. (Optional) emit a verification chip yourself

- At the end of your final assistant message, emit one chip yourself so David has something concrete to tap when he refreshes the cockpit and verifies the render. Example:
  - \`<<chip:Mark Worker 4 done>>\`
  - \`<<chip:Spawn Worker 5 on the in-the-wings affordance Phase 2>>\`

## Doctrine (read these memory files before starting)

- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl. **\`pnpm typecheck\` is the gate.** Also run \`pnpm test lib/operator-studio/chip-actions.test.ts\` to confirm parser still passes after any changes.
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English. Code/comments unaffected.
- \`memory/project_no_clis_only_desktop.md\` — David uses Desktop GUI apps exclusively.

## Your sibling workers (recently completed)

Three workers shipped Phase 1 deliverables earlier this session:
- Worker 1 (\`step-mobile-cockpit-smoke-test-worker-spawn-plan-cleanup\`) — plan-cleanup field report.
- Worker 2 (\`step-cross-platform-integration-gap-survey\`) — cross-platform integration gap.
- Worker 3 (\`step-cockpit-pending-spawn-affordance\`) — in-the-wings + cancel affordance.

All three were marked complete via \`pnpm os:worker-done\` and live under "recently completed" in \`pnpm os:workers --completed\`. Their deliverables are in \`scripts/data/\`.

## Acceptance — what it means to be done

- Cockpit refresh shows \`<<chip:LABEL>>\` rendered as a tappable pill under the assistant message that emitted it.
- The literal sentinel does NOT appear in the rendered body.
- Tapping the pill fills the chat input with the label and focuses it (no auto-send).
- Same behavior in the Berthier-to-David exec thread.
- The three spawn scripts include the chip-emission addendum.
- \`pnpm typecheck\` green.
- \`pnpm test lib/operator-studio/chip-actions.test.ts\` passes.
- Your final assistant message includes \`task_done\` on its own line, AND ideally one or two chips so David can verify the render by tapping.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion. Berthier will mark you done via \`pnpm os:worker-done\` once verified.`

async function main() {
  console.log("Spawning cockpit worker #4 — chip system Phase 2…")
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
    rationale: "spawn-cockpit-chip-system-worker.ts (worker #4) — chip system Phase 2",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #4 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
