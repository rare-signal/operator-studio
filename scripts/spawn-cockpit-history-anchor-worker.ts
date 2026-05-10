/**
 * Cockpit smoke-test spawn #5 — Berthier-as-exec spawns a Claude worker
 * to fix the cockpit message-thread truncation + scroll-anchor UX gap
 * David surfaced during the chip system battle test.
 *
 * Single-phase mission. Implementation; no Phase-1-then-pause.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-history-anchor-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-history-anchor-on-last-user-message"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to fix a message-thread truncation + scroll-anchor UX gap.

**Single-phase mission.** Ship the implementation, then post \`task_done\`. No Phase 1 review gate — David already approved the direction.

## Read first

1. The plan card: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\` — has the full brief including acceptance.
2. \`app/2/v2/components/bento-view.tsx\` — the cockpit UI (gitignored; \`app/2/\` is local-only by design). The message-thread render lives here. Find where messages are paginated/truncated and where scroll position is set on thread open.
3. The feed/snapshot endpoints bento-view pulls from — find them by grep'ing for \`fetch(\` and \`agents/\` paths in bento-view.tsx; check the route handlers under \`app/api/operator-studio/agents/\` for any per-call message cap.

## What to build

**Goal:** when David opens an executive (or worker) thread on mobile, his **last sent message** should be visible at or near the top of the message panel. Scrolling up reveals every prior turn back to the start of the session — no truncation, no infinite-scroll pager that forgets state.

1. **Eliminate the truncation cap** (or raise it to "all turns in session"). Sessions have JSONL on disk; loading all turns is cheap for typical session sizes.
2. **Anchor scroll position on thread open** to the last user-role message. Use a ref + \`scrollIntoView({ block: "start" })\` after first render lands. Subsequent tabs back into the same thread should preserve last scroll position (don't re-anchor on every visit).
3. **(Optional, if low effort)** add a small "↑ jump to last sent" button as a sticky affordance for re-anchoring after the user has scrolled away.
4. Keep the composer pinned at the bottom; only the message scroll position changes.

## Acceptance

- Open any cockpit thread on mobile → David's last user message is at/near the top of the visible message panel.
- Scroll up → every prior turn loads (no truncation hiding pasted images or earlier prompts).
- Scroll down → AI's response and any subsequent turns visible.
- Composer stays at the bottom throughout.
- \`pnpm typecheck\` green.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl. **\`pnpm typecheck\` is the gate.**
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.

## Chip emission contract

When you finish a substantive turn (a deliverable, a status, a decision point), end with **up to three** \`<<chip:LABEL>>\` lines representing the most likely next user messages — concrete, self-contained, ready-to-send. Each \`<<chip:LABEL>>\` should be on its own line. The LABEL inside the sentinel is the literal text that will become the user's next message when they tap the chip, so write it as a complete request the receiving agent can act on without further context. Skip chips entirely if no clear next-action stands out. (Note: chips inline with prose — e.g. inside backticks like the example in this paragraph — do NOT match per the line-anchor regex.)

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion. Berthier will mark you done via \`pnpm os:worker-done\` once verified.`

async function main() {
  console.log("Spawning cockpit worker #5 — history anchor + truncation fix…")
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
    rationale: "spawn-cockpit-history-anchor-worker.ts (worker #5) — message scroll anchor",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #5 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
