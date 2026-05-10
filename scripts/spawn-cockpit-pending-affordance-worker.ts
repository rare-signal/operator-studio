/**
 * Cockpit smoke-test spawn #3 — Berthier-as-exec spawns a Claude worker
 * to scope (and propose implementation for) the cockpit's in-the-wings
 * + cancel affordance for spawning workers. Sibling to
 * spawn-cockpit-worker.ts and spawn-cockpit-cross-platform-worker.ts.
 *
 * Why this mission: David reported during the 2026-05-09 battle test
 * that Worker 2's spawn took ~30s and the cockpit showed nothing in
 * the meantime — no "in the wings" pending state, no cancel. The
 * launch-attempts journal already has the data; the cockpit just
 * doesn't surface it.
 *
 * Two-phase mandate. Phase 1 = read-only field report + UX proposal.
 * Phase 2 = implementation, only after David approves.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-pending-affordance-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-pending-spawn-affordance"

const KICKOFF_PROMPT = `You are a Claude worker spawned by the Operator Studio cockpit's executive Berthier to close the in-the-wings + cancel UX gap on the cockpit's spawned-by rail.

**Two-phase mandate. STOP after Phase 1 and surface the field report for David's review. NO writes happen until David approves.**

## Why you exist

David reported during the 2026-05-09 cockpit battle test:
> "the queue worked great but appeared after a long time. Didn't show that it was in the wings or let me cancel or anything…worth a Claude launch."

Spawning Worker 2 took ~30s (focus + clipboard + paste + JSONL reconcile + binding write). The cockpit showed nothing during that window — the worker just popped into the spawned-by rail when it was already done. No queued / launching / paste-staged / reconciling indicator. No cancel button.

The plan card for this work is \`${PLAN_STEP_ID}\` (active plan). Read it first.

## Phase 1 — Read-only field report + UX proposal

1. Read the plan card: \`pnpm plan:card show --id=${PLAN_STEP_ID}\`
2. Survey the existing pieces:
   - \`.operator-studio/launch-attempts/\` — runtime journal (gitignored). Each spawn writes a json file with \`stage\`, \`status\`, \`evidence.stagesReached\`, \`message\`, \`errorRaw\`. **You will not see the directory in a git checkout** — it's runtime-only on David's machine. Trust the schema in \`lib/operator-studio/launch-attempts.ts\`.
   - \`lib/operator-studio/launch-attempts.ts\` — the lib that writes / reads the journal.
   - \`app/api/operator-studio/agents/launch-attempts/\` — existing routes that probably read it.
   - \`app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx\` — the cockpit UI client. The spawned-by rail is rendered here.
   - \`app/(operator-studio)/operator-studio/components/launch-fallback-panel.tsx\` — adjacent panel for fallback handoff. Worth a look for UX language consistency.
   - \`scripts/spawn-cockpit-worker.ts\` and siblings — the spawn entry points. Note where the launch-attempt is written.
3. Identify the minimal API contract additions needed:
   - "List pending launch-attempts for a given exec" (probably new GET endpoint, or extend the existing spawned-by route to include pending rows alongside resolved bindings).
   - "Cancel a pending launch-attempt" (mark status=dismissed; if a binding was already written, detach it via \`detachThreadCardBinding\`).
   - Optional poll cadence (1–2s) on the cockpit while any pending row exists.
4. Produce a **field report** as a KB entry (\`kb-2026-05-09-cockpit-in-the-wings-affordance\`) with:
   - The current spawn pipeline timeline annotated (which stages are slow + observable, which are not).
   - The proposed UI: pending row design (stage + age + cancel button), how it auto-promotes to a real worker row on reconcile, error/retry UX.
   - The proposed API surface (new routes, new lib functions).
   - The smallest implementation slice that delivers visible value (Phase 2 first commit).
5. Post a final assistant message that includes the literal token \`task_done\` on its own line.
6. **Stop. Wait for David's go.**

## Phase 2 — Implementation (only after David explicitly approves)

1. Implement the proposed slice. Run \`pnpm typecheck\` before declaring done.
2. Add a \`pnpm os:workers\` extension if it makes sense to surface pending workers there too (parity with the cockpit UI).
3. Report back, ending with \`task_done\` again.

## Doctrine (read these memory files before starting)

- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.
- \`memory/feedback_no_browser_or_curl_verification.md\` — no preview, no curl. \`pnpm typecheck\` is the gate.
- \`memory/project_no_clis_only_desktop.md\` — David uses Desktop GUI apps exclusively.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English. Code/comments unaffected.

## Your sibling workers

There are two other active workers spawned by the same exec (\`${EXEC_AGENT_ID}\`):
- Worker 1 = plan-cleanup field report. Phase 1 deliverable committed at \`scripts/data/plan-cleanup-field-report-2026-05-09.md\`. Currently paused, awaiting Berthier's catch-up response.
- Worker 2 = cross-platform integration gap survey (\`step-cross-platform-integration-gap-survey\`). In Phase 1.

You don't need to coordinate with them directly — Berthier is the convergence point. But if your proposed UX touches \`step-os-cross-platform-parity\` (e.g. cancel UI must work on Win/Linux too), flag it in the field report.

## Chip emission contract

When you finish a substantive turn (a deliverable, a status, a decision point), end with **up to three** \`<<chip:...>>\` lines representing the most likely next user messages — concrete, self-contained, ready-to-send. Each \`<<chip:...>>\` should be its own line. The LABEL inside the sentinel is the literal text that will become the user's next message when they tap the chip, so write it as a complete request the receiving agent can act on without further context. Skip chips entirely if no clear next-action stands out.

Optionally append \`|DESCRIPTION\` to a chip to give the user a one-line "why pick this now" rationale: \`<<chip:LABEL|DESCRIPTION>>\`. Inline pills show only the label; the sparkle (✨) modal next to the pill row shows label + description. Keep descriptions short — under ~80 chars. Only add a description if it materially helps the decision; short, self-explanatory chips don't need one.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion.`

async function main() {
  console.log("Spawning cockpit worker #3 — in-the-wings + cancel UX…")
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
    rationale: "spawn-cockpit-pending-affordance-worker.ts smoke test (worker #3)",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #3 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
