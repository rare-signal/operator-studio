/**
 * Cockpit spawn — fix the recency-window bug that hides aged
 * spawned-by-exec workers from the cockpit drawer. Single-phase
 * mission with a programmatic acceptance gate.
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-spawned-by-recency-fix-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-spawned-by-recency-independence"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to fix a bug where aged spawned-by-exec workers disappear from the cockpit drawer.

**Single-phase mission.** Ship the fix, then post \`task_done\` with the green output of the acceptance script. The bypass-permissions auto-toggle is now working in the spawn pipeline (commit 13fb890), so you should be able to do this without David babysitting permission prompts.

## Read first

1. The plan card: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\` — has the full design rationale + the recommended approach 1 (server-side merge).
2. \`app/api/operator-studio/cockpit/spawned-by/route.ts\` — current endpoint. Returns \`{ agentIds, workers }\` where \`workers[i]\` = \`{ agentId, sequence, active, spawnedAt, agentKind }\`. Need to add full agent metadata so the cockpit can render directly.
3. \`app/api/operator-studio/agents/route.ts\` — the recent-agents endpoint. Look at the \`AgentListItem\` shape it produces (label / source / lastActivityAt / status / project / title / isLive). The spawned-by route should produce the same shape per worker so the cockpit can render with no intersection.
4. \`app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx\` — the cockpit drawer. Currently:
   - Fetches /api/operator-studio/agents (recent-agents) into \`agents\` state
   - Fetches /cockpit/spawned-by into \`spawnedAgentIds\` Set
   - Renders \`agents.filter((a) => spawnedAgentIds.has(a.id))\` as the spawned-by drawer
   - The intersection is the bug — drop it.

## What to ship

### 1. Extend the spawned-by endpoint contract

Add full agent metadata per worker. New response shape:

\`\`\`
{
  agentIds: string[],            // active only — back-compat
  workers: Array<{
    agentId: string,
    sequence: number,
    active: boolean,
    spawnedAt: string,
    agentKind: string,
    // NEW fields (same shape as AgentListItem from /api/operator-studio/agents):
    label: string | null,
    source: "claude" | "codex" | "tmux",
    lastActivityAt: string | null,
    status: AgentListItem["status"],
    project: string | null,
    title: string | null,
    isLive: boolean,
  }>,
}
\`\`\`

For each active worker binding, fetch the latest JSONL metadata for that agent id (use \`listAppSessions(kind, limit)\` with a high enough limit to find aged sessions, OR use a more direct lookup if one exists in lib/server/agent-bridge/app-sessions.ts). For DETACHED workers (not active), you don't need full metadata — they shouldn't render in the active drawer anyway.

If a worker's JSONL has been deleted (rare edge case), set the metadata fields to null and isLive to false. The cockpit will render a placeholder.

### 2. Update the cockpit drawer to consume spawned-by directly

In \`cockpit-client.tsx\`:
- Drop the intersection. \`spawnedWorkers\` should derive from the \`workers\` array of the spawned-by response, not from \`agents.filter(...)\`.
- Filter to \`active === true\` only (recently-completed go in their own collapsible section if/when we add it; for now just hide).
- Map each worker entry to the AgentListItem shape the WorkersList component expects.
- Keep the \`/api/operator-studio/agents\` fetch — it's still used for the global recent-agents view (top "agents" pane), just not for the spawned-by drawer.

### 3. Acceptance script

Create \`scripts/cockpit-spawned-by-acceptance.ts\` that:
- Takes an exec id arg (default Berthier: \`claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6\`)
- Fetches GET /api/operator-studio/cockpit/spawned-by?exec=<execId> against http://localhost:4200
- Asserts response.workers exists and is an array
- Asserts each active worker entry has: agentId, sequence, active=true, spawnedAt, agentKind, label, source, lastActivityAt, status, project, title, isLive (presence; null is acceptable for the optional fields)
- Asserts that for at least one active worker that's >12h old (Workers 7 or 9 in David's session), the response includes them — this is the acceptance: aged workers must still appear.
- Exits 0 on green, prints which assertion failed and exits 1 on red

The script is the new acceptance gate. You ship task_done ONLY when it runs green.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate. The acceptance script IS allowed to fetch localhost:4200 (it's the agreed programmatic-gate model).
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale. Skip chips entirely if no clear next-action stands out.

## Acceptance

- The cockpit drawer renders Workers 7 + 9 (the two aged active bindings under Berthier exec) on next refresh, despite both being 12-13+ hours old.
- \`pnpm typecheck\` green.
- \`pnpm tsx scripts/cockpit-spawned-by-acceptance.ts\` green; paste the output.
- task_done + chips.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion. Berthier will mark you done via \`pnpm os:worker-done\` once verified.`

async function main() {
  console.log("Spawning cockpit worker — spawned-by recency-independence fix…")
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
    rationale: "spawn-cockpit-spawned-by-recency-fix-worker.ts — drop the intersection, render spawned-by directly with full metadata",
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
