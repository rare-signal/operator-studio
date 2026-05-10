/**
 * Cockpit smoke-test spawn #2 — Berthier-as-exec spawns a Claude worker
 * to scope the cross-platform integration gap (Win/Linux parity for the
 * desktop control bridge). Sibling to spawn-cockpit-worker.ts; same
 * spawn pipeline + binding linkage, distinct mission.
 *
 * Why this mission: the worker-spawn pipeline that just shipped is
 * macOS-only (osascript + System Events). Operator Studio is destined
 * to be open-source and cross-platform per memory rules. The gap needs
 * to be codified into plan cards (dogfood-first), not a stray markdown.
 *
 * Two-phase mandate: Phase 1 = read-only survey + KB note proposal;
 * Phase 2 = create the proposed plan cards (after David's go).
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-cross-platform-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID =
  process.env.COCKPIT_PLAN_STEP_ID ||
  "step-cross-platform-integration-gap-survey"

const KICKOFF_PROMPT = `You are a Claude worker spawned by the Operator Studio cockpit's executive Berthier for a cross-platform integration gap survey.

**Two-phase mandate. STOP after Phase 1 and surface the field report for David's review. NO writes happen until David approves.**

## Why you exist

Operator Studio's worker-spawn pipeline (the very pipeline that spawned you) currently only works on macOS. It uses osascript + System Events / AppleScript / Accessibility-permission-gated keystrokes against Claude Desktop and Codex Desktop GUI apps. See \`memory/project_no_clis_only_desktop.md\` and \`memory/project_cross_platform_scope.md\`.

Operator Studio is on the path to OSS (rare-signal/operator-studio). For Windows + Linux operators to dogfood this loop, we need a planned cross-platform abstraction layer. Today that gap is *uncodified* — it lives in David's head and a couple of memory files but not in the plan.

## Phase 1 — Read-only survey + KB note + plan-card proposal

1. Survey the codebase for macOS-specific desktop control. Search at least:
   - \`lib/server/agent-bridge/\` (app-control, app-deeplink-focus, app-new-session, app-session-focus, desktop-lease, launch-fallback, launch-attempts)
   - any \`osascript\`, \`AppleScript\`, \`System Events\`, \`Accessibility\` references repo-wide
   - the Claude / Codex JSONL session importers (\`lib/importers/\`) — note path conventions per OS
   - the importer registry pattern (\`lib/importers/registry.ts\` or similar; per memory, this is already cross-platform-aware as of 2026-04-27)
2. For each macOS-specific surface, classify:
   - **Locked-in to macOS** (e.g. AppleScript dispatch) — needs platform-specific equivalent
   - **Path/IO conventions** — likely already abstracted via cross-platform path helper, verify
   - **Permissions model** (Accessibility on macOS, what's the Win/Linux equivalent?)
   - **Nice-to-have parity** vs **blocker for first-run on Win/Linux**
3. Produce a **field report** as a KB entry:
   - Suggested KB id: \`kb-2026-05-09-cross-platform-integration-gap\`
   - Sections: macOS-only surfaces inventory, equivalent stacks on Win (PowerShell/UI Automation/AutoHotkey?) and Linux (xdotool/wtype/AT-SPI?), abstraction-layer proposal, ranked list of plan cards needed.
4. Propose a **set of plan cards** as a tree under a new top-level lane (recommendation: \`step-os-cross-platform-parity\`). Don't create them yet — list them in the field report with proposed parent → child structure, status (open), and one-line rationale each.
5. Cross-check against \`memory/project_cross_platform_scope.md\` — that memo says importer registry + path helper landed 2026-04-27 with Mac live, Win/Linux defaults unverified. Your survey should confirm or refute that, and report any gap.
6. Write the field report. Then post a final assistant message that includes the literal token \`task_done\` on its own line so the cockpit's task_done detector fires.
7. **Stop. Wait for David's go.**

## Phase 2 — Execute the approved plan-card creation (only after David explicitly approves)

1. Create the proposed plan cards via \`pnpm plan:card\` calls (preserve the proposed tree).
2. Tag each created card with provenance pointing back to the KB entry from Phase 1.
3. Report back with the list of created card ids, ending with \`task_done\` again.

## Doctrine (read these memory files before starting)

- \`memory/project_cross_platform_scope.md\` — the existing cross-platform memo.
- \`memory/project_no_clis_only_desktop.md\` — David uses Desktop GUI apps exclusively.
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_registry_over_hardcoded_lists.md\` — abstractions over hardcoded enumeration.
- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl, run \`pnpm typecheck\` instead.

## Your sibling worker

There is another active worker spawned by the same exec (\`${EXEC_AGENT_ID}\`) running the plan-cleanup field report. Its Phase 1 deliverable is committed at \`scripts/data/plan-cleanup-field-report-2026-05-09.md\`. **Read that before you begin** — your proposed cross-platform lane should fit into the post-cleanup plan structure (the OS plan with lanes A–G+), not the pre-cleanup one. If the cleanup proposes a new top-level lane that conflicts with \`step-os-cross-platform-parity\`, flag it.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion.`

async function main() {
  console.log("Spawning cockpit worker #2 — cross-platform integration gap…")
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
    rationale: "spawn-cockpit-cross-platform-worker.ts smoke test (worker #2)",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #2 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
