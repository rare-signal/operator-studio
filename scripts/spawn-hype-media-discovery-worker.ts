/**
 * Cockpit spawn — wayseer-crawl + KB distillation for the product
 * hype/media lane David surfaced 2026-05-10. Discovery work; no
 * implementation. Output is a single durable KB entry that becomes
 * the starting point for the lane.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-hype-media-discovery-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-product-hype-media-lane-discovery"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to crawl prior operator-studio threads on product hype/media work and distill the findings into a single durable KB entry.

This is a DISCOVERY mission — read, don't build. The output is one well-structured KB article that becomes the starting point for a major new lane David wants to develop.

## Read first

The plan card has the full brief, structure for the KB entry, and acceptance script spec:
\`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-1777793035871-dkq1b8\`

## Wayseer entry points

Per memory rule \`reference_wayseer_entry_point.md\`: \`pnpm wayseer:search\` and \`pnpm wayseer:plan\` are the cross-platform context bridges for picking up prior agentic threads. Use them.

Search across at least these terms (add adjacent terms if early results lead to them):
- "product media", "hype video", "launch media", "product launch"
- "Cinema", "Remotion", "ElevenLabs" / "11 Labs"
- "treatment" + "beat" + "scene"
- "clip schema" / "ClipMeta"
- "screenshot" + "render" + "product"
- "bumper audio"
- "marshal" / "marshals" / "Berthier-army"

## Other places to look

- \`experiments/cinema/\` directory — full survey of what's there. (Gitignored at project root per .gitignore — read on disk; don't try to commit changes there. Library is accumulate-only per \`memory/feedback_never_delete_library.md\`.)
- \`scripts/data/*.md\` — browse for any field reports touching media/video/launch.
- Plan cards: \`pnpm plan:card list --json\` then filter for media/video/launch/Cinema/G1*.
- Memory files: \`/Users/smackbook/.claude/projects/-Users-smackbook-operator-studio/memory/\` — read \`feedback_clip_schema.md\`, \`feedback_story_chaining_first.md\`, \`feedback_meta_first.md\`, \`feedback_never_delete_library.md\`, plus anything else that surfaces.

## What to ship

A KB entry \`kb-2026-05-10-product-hype-media-lane\` written via \`pnpm wayseer:plan\` or the KB module's \`upsertEntry\` function (find it in \`lib/operator-studio/knowledge.ts\` or similar). Structure per the plan card body — TL;DR, existing artifacts, prior thread signals, David's stated deliverables, structuring questions, recommended next moves.

David explicitly named these deliverables for the lane (extract more from the threads if they surface):
1. Template library with swappable elements
2. Inspiration library (codify Twitter / scattered references)
3. ElevenLabs integration for bumper audio
4. Audience-positioning loop (validated-fact-grounded)
5. The integrating engine (screenshot → render → cut → audio pipeline driven by Berthier-army)

For each: what already exists, what's missing, smallest first ship.

## Don't

- Don't auto-create child cards. The KB is the deliverable; David decides what to card next after reading.
- Don't \`rm\` anything in \`experiments/cinema/\` per the never-delete invariant.
- Don't try to commit changes to \`experiments/cinema/\` (gitignored).
- Don't ship implementation. This is discovery + distillation only.

## Acceptance script

Create \`scripts/hype-media-lane-acceptance.ts\` per the spec in the card. Asserts the KB exists, body length > 2000 chars, body contains all of: "Cinema", "ClipMeta" (or "clip schema"), "ElevenLabs", "audience", "template", "inspiration". Run it green before claiming task_done.

## Doctrine

- \`pnpm typecheck\` green.
- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate. Acceptance script may fetch localhost:4200 if needed.
- \`memory/feedback_dogfood_first.md\` — KB entries + plan cards over stray markdown.
- \`memory/feedback_terse_plain_english.md\` + \`memory/feedback_markdown_summaries.md\` — final user-facing recap is plain English with markdown structure.

## Chip emission contract

When you finish a substantive turn, end with up to three \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` INSIDE the sentinel for a one-line "why pick this now" rationale: \`<<chip:LABEL|DESCRIPTION>>\` (canonical form — pipe goes INSIDE the closing >>; the parser tolerates outside-pipe but inside is canonical). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- KB entry exists with the right structure.
- \`pnpm tsx scripts/hype-media-lane-acceptance.ts\` runs green; paste output.
- Final summary as markdown bullets: # threads surveyed, top 3-5 prior decisions worth carrying forward, top 3-5 surprises (things that contradict memory-only assumptions), the recommended next move ranked highest.
- task_done + 2-3 chips.

## Provenance

Spawned by exec \`${EXEC_AGENT_ID}\` against \`${PLAN_STEP_ID}\`. Berthier marks done via \`pnpm os:worker-done\` after acceptance + David's read of the KB.`

async function main() {
  console.log("Spawning hype-media discovery worker…")
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
    rationale: "spawn-hype-media-discovery-worker.ts — wayseer crawl + KB distillation",
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
