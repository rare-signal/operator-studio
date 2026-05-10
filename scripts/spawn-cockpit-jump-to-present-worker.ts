/**
 * Cockpit spawn — Discord-style "jump to present" floating button in
 * the cockpit's message panel. Tiny focused work; no server change.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-jump-to-present-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-jump-to-present-button"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship a Discord-style "jump to present" floating button in the cockpit message panel.

Single-phase mission. Tiny focused work; no server change.

## Read first

The plan card has the full spec including visibility rule, placement, sequencing constraint:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

## What to ship

- Floating button in the cockpit's message panel render in \`app/2/v2/components/bento-view.tsx\` (gitignored — \`app/2/\` is local-only by design).
- Visibility: only when scrolled up past ~2 viewport heights from the bottom of the scrollable content.
- Tap: smooth-scroll to bottom of the message panel.
- Placement: bottom-center or bottom-right, floating above the messages, ABOVE the composer.
- Visual: small pill or circle with a down-arrow icon (\`ChevronDown\` or \`ArrowDown\` from lucide-react — already imported elsewhere in cockpit-client.tsx).
- Doesn't render when the panel has too little content to scroll (avoid flash on freshly-opened threads).

## Sequencing constraint

The UX batch worker (currently active, agentId starts \`5eaff04b\`) is shipping the paste-flash fix as its Item 1 — replaces the slice-on-anchor approach with a hard-cap-100-turns approach. Your work sits on TOP of that new scroll-behavior foundation. **Read the bento-view scroll handling AFTER the UX batch worker has landed their changes** — if you start before them, your scroll-threshold math will be against the old approach and have to be redone.

Practical move: poll the working tree (\`git status\`) before you start; if \`bento-view.tsx\` shows recent edits with paste-flash-related comments, the foundation is in place and you're good to start. If you're not sure, ask David via task_done message and chip back.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate.
- \`memory/feedback_dogfood_first.md\` — capture follow-ons as plan cards.
- \`memory/feedback_terse_plain_english.md\` + \`memory/feedback_markdown_summaries.md\` — final user-facing recap is plain English with markdown structure.

## Chip emission contract

When you finish a substantive turn, end with up to three \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` INSIDE the sentinel for a one-line "why pick this now" rationale: \`<<chip:LABEL|DESCRIPTION>>\` (canonical form — pipe goes INSIDE the closing >>; the parser tolerates outside-pipe but inside is canonical). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- Floating button renders + behaves per spec when David refreshes the cockpit.
- \`pnpm typecheck\` green.
- Final summary as markdown bullets: file touched (will be the gitignored bento-view), behavior summary, anything that surprised you about the existing scroll handling.
- task_done + 2-3 chips.

## Provenance

Spawned by exec \`${EXEC_AGENT_ID}\` against \`${PLAN_STEP_ID}\`.`

async function main() {
  console.log("Spawning cockpit jump-to-present worker…")
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
    rationale: "spawn-cockpit-jump-to-present-worker.ts — Discord-style floating button",
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
