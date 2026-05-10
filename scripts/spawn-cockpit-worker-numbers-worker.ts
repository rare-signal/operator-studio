/**
 * Cockpit smoke-test spawn #8 — Berthier-as-exec spawns a Claude worker
 * to add stable "Worker N" labels to each row in the cockpit's
 * spawned-by drawer.
 *
 * Why: when Berthier says in chat "I'm sending a follow-up to Worker 7",
 * David should be able to glance at the drawer and immediately see
 * which row that is. Right now the rows show kind + agent id but no
 * human-friendly number, breaking the chat ↔ UI bridge.
 *
 * Single-phase mission with a programmatic acceptance gate (no visual
 * verification dependency).
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-worker-numbers-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-show-worker-numbers-on-rows"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to add "Worker N" labels to each row in the cockpit's spawned-by drawer.

**Single-phase mission.** Implementation; ship task_done with green acceptance script output. No "should work" hand-waves — the gate is programmatic.

## Read first

1. The plan card: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\` — design rationale, acceptance, and the recommended path-2 (server-side sequence) approach.
2. \`app/api/operator-studio/cockpit/spawned-by/route.ts\` — current endpoint. Returns \`{ agentIds: string[] }\` from \`getActiveBindingsSpawnedBy\`. You'll extend the response shape to include per-binding sequence numbers, AND surface BOTH active + recently-detached bindings so numbering stays stable across mark-done cycles.
3. \`lib/operator-studio/thread-card-bindings.ts\` — the bindings lib. \`getActiveBindingsSpawnedBy\` and \`getRecentlyDetachedBindingsSpawnedBy\` are the existing primitives; you may need a new combined function or you may compose them in the route handler.
4. \`app/2/v2/components/bento-view.tsx\` (gitignored; \`app/2/\` is local-only). The drawer that renders rows from the spawned-by response. Find where the response is consumed and update the row label.

## What to ship

### 1. Extend the spawned-by endpoint contract

Change the response shape from:
\`\`\`
{ agentIds: string[] }
\`\`\`

to:
\`\`\`
{
  agentIds: string[],   // keep for back-compat with any other caller
  workers: Array<{
    agentId: string,
    sequence: number,   // 1-indexed; stable across detach (see below)
    active: boolean,    // true if currently active, false if detached
    spawnedAt: string,  // ISO; same as binding.createdAt
  }>
}
\`\`\`

Numbering rule: across ALL bindings (active + detached) under this exec, sort by \`createdAt\` ascending, assign \`sequence = 1..N\` in that order. Worker 7 stays Worker 7 even after being marked done. The next NEW spawn becomes Worker 8 (or wherever the count is at).

The \`agentIds\` array stays exactly as it is today (active only), so any existing caller doesn't break. New consumers prefer \`workers\`.

### 2. Update the bento drawer

In \`bento-view.tsx\`, find where the \`/cockpit/spawned-by\` response is consumed. Update the row label to read \`"Claude · Worker N"\` or \`"Codex · Worker N"\` based on \`agentKind\` + \`sequence\`. Keep agent id visible somewhere (smaller text, hover title, etc.) for power-user disambiguation, but the primary label is the worker number.

### 3. Write the acceptance script — this is the gate

Create \`scripts/cockpit-worker-numbers-acceptance.ts\` that:
  - Takes an exec id arg (default to Berthier exec: \`claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6\`)
  - Fetches \`GET /api/operator-studio/cockpit/spawned-by?exec=<execId>\` against \`http://localhost:4200\`
  - Asserts the response has a \`workers\` array
  - Asserts each entry has \`agentId\`, \`sequence\`, \`active\`, \`spawnedAt\`
  - Asserts sequences are 1..N with NO gaps and NO duplicates
  - Asserts ordering: \`workers[i].spawnedAt <= workers[i+1].spawnedAt\` for all i
  - Asserts \`workers[i].sequence === i + 1\` (numbering is the sort position)
  - At least one worker has \`active: false\` (we have completed workers from this session)
  - At least one worker has \`active: true\` (you're one of them)
  - Exits 0 on green; prints which assertion failed and exits 1 on red

The script is what you run before claiming task_done. Paste its green output in your final message.

## Don't change

- The existing \`agentIds: string[]\` field in the response (back-compat).
- The semantics of \`getActiveBindingsSpawnedBy\` or \`getRecentlyDetachedBindingsSpawnedBy\` — those primitives are already used by \`pnpm os:workers\`. If you compose them, do it in the route handler.
- Any other endpoint contracts.

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate (always). The acceptance script IS allowed to fetch \`localhost:4200\` because it's the new programmatic-gate model David approved this session — that's its purpose. Just don't hang the dev server with extra side-fetches; one fetch, one assert chain, exit.
- \`memory/feedback_dogfood_first.md\` — capture work in OS plan cards, not stray markdown.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line) representing the most likely next user messages. Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale (under ~80 chars; only when it materially helps decision-making). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- \`pnpm typecheck\` green.
- \`pnpm tsx scripts/cockpit-worker-numbers-acceptance.ts\` green; paste the output.
- Then end with \`task_done\` and chips.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. You are Worker 8 in this session's spawn timeline (Worker 7 is currently active on the history-anchor iteration 2 fix; you may both touch \`bento-view.tsx\` — read current state before editing to avoid stomping each other).`

async function main() {
  console.log("Spawning cockpit worker #8 — worker numbers on drawer rows…")
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
    rationale: "spawn-cockpit-worker-numbers-worker.ts (worker #8) — Worker N labels in drawer",
  })

  console.log(`Binding written: ${binding.id}`)
  console.log(
    `\n✅ Worker #8 should now appear in the cockpit's bottom rail under exec ${EXEC_AGENT_ID}.`
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
