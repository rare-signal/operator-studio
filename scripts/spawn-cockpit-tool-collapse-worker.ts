/**
 * Cockpit spawn — collapse tool-call rows into one inline-expandable
 * summary per assistant turn. UI cleanup only; gitignored bento-view.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-tool-collapse-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-collapse-tool-calls-per-turn"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to clean up tool-call noise in the cockpit chat view.

Single-phase mission. UI cleanup; lives in gitignored bento-view.

## Read first

Plan card with full brief, what-changes/what-doesn't, implementation notes, and acceptance:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

## What to ship

For each assistant turn that contains tool-call parts (file reads, Bash, Edit/Write, MCP tool invocations, web fetches — anything currently rendered in purple/gray): collapse them ALL into ONE summary line per turn, inline-expandable.

- Lives in app/2/v2/components/bento-view.tsx in TurnView (gitignored — app/2/ is local-only by design).
- Pre-pass groups consecutive non-text/non-thinking parts into "tool groups."
- Render ONE summary row per group: muted styling, icon (lucide Terminal or Wrench), "{N} tool actions in this turn", chevron indicating expand state.
- Click anywhere on the summary line toggles expand/collapse.
- When expanded, render the SAME content currently shown — no styling change to the expanded view, just the wrapper.
- Persist expand state per turn in localStorage keyed by message id.

DO NOT change:
- Assistant text parts (chat messages) — render at top level.
- Thinking parts — render at top level.
- User turns — unchanged.

## Concurrency

Entry-UX worker (claude:c24b7631) is currently active and may also touch bento-view. Read the file's current state before editing to avoid stomping their changes.

## Doctrine

- pnpm typecheck green.
- memory/feedback_no_browser_or_curl_verification.md — typecheck is the gate.
- memory/feedback_dogfood_first.md — capture follow-ons as plan cards.
- memory/feedback_terse_plain_english.md + memory/feedback_markdown_summaries.md — final user-facing recap is plain English with markdown structure.
- memory/feedback_no_break_chips.md — chip suggestions forward-leaning only.

## Chip emission contract

End substantive turns with up to three <<chip:LABEL>> lines (each on its own line). Optionally append |DESCRIPTION INSIDE the sentinel: <<chip:LABEL|DESCRIPTION>>. Skip if no clear next action. Forward-leaning suggestions only.

## Acceptance — what task_done means

- Tool-call rows collapsed to one inline-expandable summary per assistant turn.
- Assistant text + thinking parts unchanged at top level.
- pnpm typecheck green.
- One unit test for the grouping function passes (input: array of turn parts, output: array of "groups").
- Final summary in markdown bullets: file touched, behavior summary, anything that surprised you about the existing TurnView render path.

## Provenance

Spawned by exec ${EXEC_AGENT_ID} against ${PLAN_STEP_ID}.`

async function main() {
  console.log("Spawning cockpit tool-collapse worker…")
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
    rationale: "spawn-cockpit-tool-collapse-worker.ts — collapse tool-call noise to one expandable line per turn",
  })
  console.log(`Binding written: ${binding.id}`)
  console.log(`\n✅ Worker should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`)
}

main().catch((err) => { console.error(err); process.exitCode = 1 }).finally(async () => { await getPgPool().end() })
