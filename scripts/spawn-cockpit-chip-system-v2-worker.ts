/**
 * Cockpit smoke-test spawn #6 — Berthier-as-exec spawns a Claude worker
 * to ship chip system v2: bigger pills, optional description, sparkle-
 * modal expanded view.
 *
 * Single-phase mission. Implementation; no Phase-1-then-pause.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-chip-system-v2-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-exec-chip-system-v2"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship chip system v2.

**Single-phase mission.** Ship the implementation, then post \`task_done\`. The previous Worker 4 shipped chip system v1 (parser + inline pills + tap-to-fill); David ran it on mobile and gave concrete feedback that this v2 addresses.

## Read first

1. The plan card: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\` — has the full brief including syntax extension, acceptance, dual-surface render model.
2. The original design brief: \`scripts/data/exec-chip-system-design-2026-05-09.md\` — context for v1 decisions you're now extending.
3. \`lib/operator-studio/chip-actions.ts\` — current parser (line-anchored, returns \`{ label, index }\`). You extend the return shape to \`{ label, description?, index }\`.
4. \`lib/operator-studio/chip-actions.test.ts\` — current 13 tests. You add cases for description handling.
5. \`app/2/v2/components/bento-view.tsx\` — current chip render around lines 2880–3025 (parse, strip, pill render, tap handler). The cockpit UI you'll extend. (Gitignored — \`app/2/\` is local-only by design.)
6. The three spawn scripts (\`scripts/spawn-cockpit-worker.ts\`, \`scripts/spawn-cockpit-cross-platform-worker.ts\`, \`scripts/spawn-cockpit-pending-affordance-worker.ts\`) all have a "Chip emission contract" section near the bottom of their kickoff prompt — update those to mention the optional \`|description\`.

## What to build

### 1. Sentinel syntax extension (backwards-compatible)

Today: \`<<chip:LABEL>>\`
Add: \`<<chip:LABEL|DESCRIPTION>>\` — pipe-separated, description optional.

Parser splits on the **first** \`|\`. Subsequent pipes inside the description are preserved literally. Chips without \`|\` continue to work unchanged (everything currently shipped stays valid).

### 2. Bigger inline pills, no truncation

- Bump touch target: \`py-1\` → \`py-2\`, \`text-[11.5px]\` → \`text-[13px]\`. Aim for ~40px min-height (Apple HIG accessibility minimum is 44pt; 40px is a reasonable compromise on dense mobile UI).
- Allow label wrap: replace \`truncate\` with \`whitespace-normal line-clamp-2\` so long labels wrap to two lines instead of ellipsis-truncating.
- Keep the flex-wrap row layout — don't switch to horizontal scroll.

### 3. Sparkle-icon expanded view

Next to the inline pill row, render a small ✨ icon button (or similar — pick something visually unobtrusive). On tap, open a bottom-sheet (mobile) or popover (desktop) containing the chip set as cards:
- Card title = chip.label
- Card body = chip.description (if present); if no description, show "_no extra context_" or omit body entirely
- Tap a card = same fill-composer behavior as inline pill (fills with chip.label, NOT with the description)
- Sheet/popover dismisses on tap-outside or close button

Bento-view already imports modal/sheet primitives — reuse the same pattern as other popover surfaces in the file (search for "Popover" or "Sheet" in the imports).

### 4. Tap behavior unchanged

Both surfaces (inline pill OR card in sparkle modal) → fill chat input with chip.label, focus textarea, NO auto-send. Same handleChipTap function.

### 5. Update chip-emission contract in spawn scripts

Add one sentence to the existing addendum in all three spawn scripts:

> Optionally append \`|DESCRIPTION\` to a chip to give the user a one-line "why pick this now" rationale. Inline pills show only the label; the sparkle (✨) modal shows label + description. Keep descriptions short — under ~80 chars. Only add a description if it materially helps decision-making.

### 6. Tests

Add to \`chip-actions.test.ts\`:
- Chip with description: \`<<chip:Approve|Worker 1's report is committed>>\` → \`{ label: "Approve", description: "Worker 1's report is committed", index: 0 }\`.
- Chip without description: still works (description is undefined or omitted).
- Chip with multiple pipes: only the first splits; rest live in the description (\`<<chip:A|B|C>>\` → \`{ label: "A", description: "B|C", index: 0 }\`).
- Chip with empty description after pipe: \`<<chip:A|>>\` → \`{ label: "A", description: undefined or "" — pick one and document\`).
- Update the \`stripChipSentinels\` test if needed (the strip is unchanged; same regex).

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl. **\`pnpm typecheck\` is the gate.** Also \`pnpm test lib/operator-studio/chip-actions.test.ts\`.
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English. Code/comments unaffected.
- David's user-attention concern: the sparkle modal must NOT be three walls of text. Card descriptions are one line each. If the description text itself runs long, truncate to ~120 chars in the card view with a tiny "…" indicator (no further expand-on-tap — the chip text is the action; the description is just orientation).

## Acceptance

- Existing chips (no description) still render as inline pills, larger and 2-line-wrappable.
- Chips with description render the same inline pill (label only) AND show up in the sparkle modal with their description.
- Tap on either surface fills the composer with the chip's \`label\`.
- The sparkle button only renders if at least one chip in the set has a description (no point opening an empty modal).
- \`pnpm typecheck\` green.
- \`pnpm test lib/operator-studio/chip-actions.test.ts\` passes (current 13 + new description cases).

## Sibling

Worker 5 is being spawned in parallel to fix the message-thread truncation + scroll-anchor gap on a separate plan card. You don't need to coordinate — different files, different concerns. If you both touch \`bento-view.tsx\`, take care to not stomp each other's edits — read the current state of the file before editing.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion.`

async function main() {
  console.log("Spawning cockpit worker #6 — chip system v2…")
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
    rationale: "spawn-cockpit-chip-system-v2-worker.ts (worker #6) — chip system v2",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #6 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
