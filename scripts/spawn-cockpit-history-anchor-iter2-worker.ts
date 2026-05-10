/**
 * Cockpit smoke-test spawn #7 — Berthier-as-exec spawns a Claude worker
 * to fix the regression on Worker 5's history-anchor work.
 *
 * Worker 5 wired the scaffold (lastUserIdx + data-last-user-turn marker
 * + scrollTop += delta) but two bugs surfaced when David refreshed:
 *   1. Layout-not-settled: anchor runs on first paint before markdown +
 *      images add their height; scroll lands near top of the now-taller
 *      doc.
 *   2. Wrong branch: only the focused-pane path got the anchor; the
 *      main-cockpit exec view (Berthier-David in the 3-pane layout)
 *      still slices + bottom-scrolls.
 *
 * Worker 5 stays marked complete (their scaffold is reused); Worker 7
 * ships the corrective scroll-execution logic.
 *
 * Single-phase mission. Implementation; no Phase-1-then-pause.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-history-anchor-iter2-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-history-anchor-on-last-user-message"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to fix a regression on Worker 5's history-anchor work.

**Single-phase mission.** Ship the fix, then post \`task_done\`. The plan card has been iterated with the corrective brief; read it FIRST.

## Read first (in this order)

1. **The plan card body** — \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\`. Scroll to the **"Iteration 2 — what missed"** section near the end. That's the entire spec for what you ship.
2. \`app/2/v2/components/bento-view.tsx\` (gitignored; \`app/2/\` is local-only). Worker 5's wiring lives around:
   - line ~1726: scroll-anchor block inside the snapshot effect
   - line ~2885: \`mobileFocused ? all : all.slice(-6)\` turn slice
   - line ~2899: \`isLastUserTurn={mobileFocused && i === lastUserIdx}\` prop
   - line ~3065: \`data-last-user-turn\` attribute on the rendered turn

## What to ship (3 changes only)

### 1. Replace the manual scroll calc with \`scrollIntoView\`

Find the block around line ~1726 that does:
\`\`\`
const target = el.querySelector('[data-last-user-turn="true"]') as HTMLElement | null
if (target) {
  const delta = target.getBoundingClientRect().top - el.getBoundingClientRect().top
  el.scrollTop += delta
  ...
}
\`\`\`

Replace the math with:
\`\`\`
target.scrollIntoView({ block: "start", behavior: "instant" })
\`\`\`

Browsers handle a still-settling layout better than a one-shot delta calc.

### 2. Defer the anchor until layout has likely settled

Wrap the anchor block in a 2-frame defer (or wait for image \`load\` events on any \`<img>\` inside the panel — pick whichever fits the existing patterns in the file). The simplest reliable defer:
\`\`\`
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    // run the anchor here
  })
})
\`\`\`

Two frames is enough for the typical paint + layout cycle to settle without fighting fast scrolls. If image-load tracking is easy in the existing code, prefer that — it's more correct for messages with pasted images.

### 3. Apply the anchor to the main-cockpit exec render path too

The current code only fires when \`mobileFocused === true\`. Find the main-cockpit exec render path (search for where the exec lane renders messages WITHOUT \`mobileFocused\`) and wire the same anchor logic there. The user's mental model is "any thread I open should anchor on my last sent message" — that includes the main exec view in the 3-pane layout, not just the worker fullscreen.

If the main exec render currently slices to the last ~6 turns (\`all.slice(-6)\`), drop that slice on mobile so the anchor has all turns to find the last-user one. Desktop can keep its existing render — desktop wasn't broken.

## Don't change

- The existing \`lastUserIdx\` calculation — correct as-is.
- The \`data-last-user-turn\` DOM marker — correct as-is.
- The truncation removal Worker 5 did — preserve it.
- The \`hasScrolledOnceRef\` guard — keep it so subsequent re-renders don't fight user scroll. Just trigger re-anchor when the snapshot's session/agent id changes (user navigated to a different thread).
- The composer pinned at the bottom — unchanged.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl. **\`pnpm typecheck\` is the gate.**
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line) representing the most likely next user messages. Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale (under ~80 chars; only when it materially helps decision-making). Skip chips entirely if no clear next-action stands out.

## Acceptance

- David refreshes the executive thread on mobile → his last user message is at/near the **top** of the visible message panel (not the beginning of the session, not the very bottom).
- David navigates to a focused worker pane → same anchor behavior.
- David scrolls up → all earlier turns visible (truncation removal preserved).
- \`pnpm typecheck\` green.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\` (iteration 2). Worker 5 stays marked complete; you ship the corrective scroll-execution. The cockpit watches for \`task_done\` to surface your completion.`

async function main() {
  console.log("Spawning cockpit worker #7 — history anchor iteration 2…")
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
    rationale: "spawn-cockpit-history-anchor-iter2-worker.ts (worker #7) — anchor regression fix",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #7 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
