/**
 * Cockpit smoke-test spawn #9 — Berthier-as-exec spawns a Claude worker
 * to fix the cockpit's missing "back to main view" affordance, AND
 * doubles as the smoke test for the new auto-bypass-permissions
 * spawn pipeline (committed in e9d7d6e).
 *
 * Single-phase mission. Implementation; no Phase-1-then-pause.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-collapse-back-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-collapse-back-affordance"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to fix the cockpit's missing "back to main view" affordance from focused worker views on mobile.

**Single-phase mission.** Ship the fix, then post \`task_done\`.

**You're also the smoke test for a new spawn-pipeline feature.** As of commit e9d7d6e, every newly-spawned Claude session is automatically switched to "Bypass permissions" mode via Cmd+Shift+M + "5" before the kickoff prompt lands. Your first action — reading a file, running a command — should NOT trigger a permission UI prompt. If it does, the bypass-mode toggle didn't take effect; flag that in your final message so Berthier can investigate.

## Read first

1. The plan card: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\` — diagnostic notes from David's report.
2. \`app/2/v2/components/bento-view.tsx\` (gitignored; \`app/2/\` is local-only by design). The cockpit UI. The existing back button is at line ~978 (ArrowLeft icon + "Threads" label, \`onClick={() => setFocusedAgentId(null)}\`, \`aria-label="Back to threads"\`). It DOES exist; the problem is it's invisible to David from his focused worker view on mobile Safari.

## What to investigate + fix

1. **Reproduce the gap.** Read \`bento-view.tsx\` to map every view state the cockpit can be in (main 3-pane, focused-worker, Nintendo DS split, fullscreen-out-of-split). For each one, identify whether the back-to-main button renders, where, and whether it's likely to be visible on mobile Safari given the safe-area inset + the URL bar chrome.
2. **Decide on a consistent affordance.** The user's mental model is "any focused state should have an obvious 'back to main' button." Pick one of:
   - Make the existing line ~978 button render in EVERY focused state (DS split + fullscreen-out-of-split + plain focused-worker), with consistent styling.
   - Add a global "home" / "main view" affordance always visible in the bottom nav (the "+" / nav row at the very bottom of the cockpit) regardless of view state.
   - Repurpose the "X" in the "LANE Cockpit X" header at top-left to mean "back to main view" with appropriate aria-label.
3. **Implement.** Whichever you pick, make sure:
   - It's visible on mobile Safari with safe-area insets respected.
   - Tapping it returns the user to the 3-pane main view (\`setFocusedAgentId(null)\` or whatever the right state mutation is).
   - Tapping it does NOT lose composer draft state.
   - It has an aria-label and a hover/title hint.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate.
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line) representing the most likely next user messages. Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale (under ~80 chars; only when it materially helps decision-making). Skip chips entirely if no clear next-action stands out.

## Acceptance

- From any view state in the cockpit, there's a visible, labeled, tappable affordance that returns the user to the main 3-pane (exec thread + active workers list).
- Tapping it preserves composer draft state.
- \`pnpm typecheck\` green.
- Final message includes \`task_done\` plus a one-line confirmation of whether your spawn experienced ANY permission UI prompts on first action (smoke test for the new bypass-mode auto-flip).

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. You are Worker 9 in this session's spawn timeline. The cockpit watches for \`task_done\` to surface your completion.`

async function main() {
  console.log("Spawning cockpit worker #9 — collapse-back affordance + bypass-mode smoke test…")
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
    rationale: "spawn-cockpit-collapse-back-worker.ts (worker #9) — collapse-back + bypass-mode smoke test",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #9 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
