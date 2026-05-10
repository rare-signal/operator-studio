/**
 * Acceptance: canonical Berthier kickoff template.
 *
 * Synthetic data only — never touches the production GLOBAL workspace
 * or any real lane. Calls `buildBerthierKickoff` with throwaway ids
 * and asserts the resulting prompt is well-formed:
 *
 *   - Names "Berthier" and the synthetic lane.
 *   - References the load-bearing memory files by name.
 *   - States the chip emission contract.
 *   - Mentions `os:worker-done` and `pnpm plan:card`.
 *   - Sane length window (>2000, <20000 chars).
 *   - The optional `initialPlanStepId` block surfaces the card id.
 *
 * Usage:
 *   pnpm tsx scripts/berthier-self-hydration-acceptance.ts
 */

import { buildBerthierKickoff } from "@/lib/operator-studio/berthier-kickoff"

const SYNTH_LANE_ID = "lane_synthetic_acceptance_xyz"
const SYNTH_LANE_NAME = "Synthetic Acceptance Lane"
const SYNTH_WORKSPACE_ID = "ws-synthetic-acceptance"
const SYNTH_PLAN_STEP_ID = "step-synthetic-acceptance-card"
const SYNTH_CHAT_ID = "claude:00000000-0000-0000-0000-000000000000"

type Failure = { name: string; detail: string }
const failures: Failure[] = []

function check(name: string, pass: boolean, detail = ""): void {
  if (!pass) failures.push({ name, detail })
}

function run(): void {
  const baseline = buildBerthierKickoff({
    laneId: SYNTH_LANE_ID,
    laneName: SYNTH_LANE_NAME,
    workspaceId: SYNTH_WORKSPACE_ID,
  })

  check("contains 'Berthier'", baseline.includes("Berthier"))
  check("contains lane name", baseline.includes(SYNTH_LANE_NAME))
  check("contains lane id", baseline.includes(SYNTH_LANE_ID))
  check("contains workspace id", baseline.includes(SYNTH_WORKSPACE_ID))

  const memoryRefs = [
    "memory/feedback_dogfood_first.md",
    "memory/feedback_terse_plain_english.md",
    "memory/feedback_markdown_summaries.md",
    "memory/feedback_no_break_chips.md",
  ]
  for (const ref of memoryRefs) {
    check(`references ${ref}`, baseline.includes(ref))
  }

  check(
    "references pnpm plan:card",
    baseline.includes("pnpm plan:card"),
    "expected the plan:card CLI reference for card reads/writes"
  )
  check(
    "references os:worker-done",
    baseline.includes("os:worker-done"),
    "expected the worker completion command"
  )

  check(
    "states chip emission contract",
    /<<chip:LABEL>>/.test(baseline) &&
      baseline.includes("<<chip:LABEL|DESCRIPTION>>"),
    "expected both the LABEL and the LABEL|DESCRIPTION sentinel forms"
  )
  check(
    "chip contract is forward-leaning only",
    baseline.toLowerCase().includes("forward-leaning"),
    "expected the no-break-chips guardrail to be inline"
  )

  const len = baseline.length
  check(
    "prompt length in sane range",
    len > 2000 && len < 20000,
    `actual=${len} (expected >2000, <20000)`
  )

  // Optional-block variant: when a first card is named, the kickoff
  // surfaces a "Your first move" block that includes the card id.
  const withCard = buildBerthierKickoff({
    laneId: SYNTH_LANE_ID,
    laneName: SYNTH_LANE_NAME,
    workspaceId: SYNTH_WORKSPACE_ID,
    initialPlanStepId: SYNTH_PLAN_STEP_ID,
    initialChatId: SYNTH_CHAT_ID,
  })
  check(
    "first-move block surfaces card id",
    withCard.includes(SYNTH_PLAN_STEP_ID) &&
      withCard.includes("Your first move"),
    "expected card id + 'Your first move' header when initialPlanStepId is set"
  )
  check(
    "resume-context surfaces prior chat id",
    withCard.includes(SYNTH_CHAT_ID),
    "expected the prior chat id to appear when initialChatId is set"
  )
  check(
    "with-card variant is longer than baseline",
    withCard.length > baseline.length,
    `baseline=${baseline.length} withCard=${withCard.length}`
  )

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} acceptance failure(s):\n`)
    for (const f of failures) {
      console.error(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ""}`)
    }
    process.exit(1)
  }
  console.log(
    `✓ Berthier kickoff acceptance — all checks green (baseline=${baseline.length} chars, with-card=${withCard.length} chars).`
  )
}

run()
