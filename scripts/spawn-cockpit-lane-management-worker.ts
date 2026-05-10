/**
 * Cockpit spawn — lane management MVP. Three deliverables in one
 * worker: draggable exec/workers splitter, lane dropdown in the
 * header, role-conflict guard preventing exec ↔ worker double-binding.
 *
 * Single-phase mission with a programmatic acceptance gate. Bypass
 * lands automatically via the spawn pipeline (commit acdda10's settings
 * + the keystroke fallback).
 *
 * Usage:
 *   pnpm tsx scripts/spawn-cockpit-lane-management-worker.ts
 */

import { createNewAppSessionAndSend } from "@/lib/server/agent-bridge/app-new-session"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"
import { getPgPool } from "@/lib/server/db/client"

const EXEC_AGENT_ID =
  process.env.COCKPIT_EXEC_AGENT_ID ||
  "claude:2526ed14-5a7c-4f2c-ae8b-8444b13cb2c6"

const PLAN_STEP_ID = "step-cockpit-lane-management-mvp"

const KICKOFF_PROMPT = `You are a Claude worker spawned by Operator Studio cockpit's executive Berthier to ship the lane management MVP for the cockpit.

**Single-phase mission.** Read the card, ship the three deliverables, prove via the acceptance script, post task_done with the green output.

## Read first

1. The plan card with the full brief: \`pnpm plan:card show --id=${PLAN_STEP_ID} --plan-id=plan-valikharlia-agentic-studio-buildout\`. The three deliverables, the role-conflict rationale, the acceptance script spec, and the explicit out-of-scope items are all in there.
2. \`app/(operator-studio)/operator-studio/cockpit/cockpit-client.tsx\` — the cockpit shell. Header with "Lane Cockpit" lives here. Exec selection state (\`execId\`, \`setExecId\`) lives here too.
3. \`app/2/v2/components/bento-view.tsx\` (gitignored; \`app/2/\` is local-only). The split layout between exec pane and workers list lives here. The draggable handle goes between those.
4. \`lib/operator-studio/workspaces.ts\` — workspace primitives. May need extension for "create new workspace" + "list workspaces" if not already there.
5. \`lib/operator-studio/thread-card-bindings.ts\` — bindings table. The role-conflict guard checks against active rows here. \`getActiveBindingsSpawnedBy\` and \`listActiveThreadCardBindings\` already exist.
6. \`app/api/operator-studio/cockpit/spawned-by/route.ts\` — example route shape if you need a sibling for the workspace/thread listing endpoints.

## Three deliverables

### 1. Draggable splitter
- Render a thin, visible drag handle between the exec pane (top) and the workers section (bottom) in the cockpit layout. Probably in \`bento-view.tsx\` since that's where the layout primitives are.
- Drag adjusts the relative height. Use \`pointermove\` events for cross-mobile/desktop support. Min ~15%, max ~85% per side.
- Persist the ratio to \`localStorage\` (key like \`operator-studio:cockpit:split-ratio\`).
- Double-tap or double-click on the handle resets to 50/50.
- Touch target ~12-16px for mobile.

### 2. Lane dropdown in the header
- Replace the static "Lane Cockpit" header with a tappable dropdown. Reuse Radix or whatever popover primitive is already in use (search \`Popover\`, \`Sheet\`, or \`DropdownMenu\` imports in cockpit-client.tsx).
- Dropdown contents:
  - Section: workspaces. List existing, "Switch to" on tap, "+ Create new workspace" at the bottom.
  - Section: executive thread for the active workspace. List candidate threads (recent agents in this workspace). "Set as exec" on tap. "+ Create new exec thread" at the bottom — that one wraps the existing \`createNewAppSessionAndSend\` + binding pipeline and immediately sets the new agent as exec.
- "Create new workspace" and "Create new exec thread" actions need backend routes if not already present:
  - \`POST /api/operator-studio/workspaces\` (create) — return the new workspace id + name
  - \`POST /api/operator-studio/cockpit/exec\` (set/promote a thread to exec for a workspace) — accepts \`{ workspaceId, agentId }\`, applies the role guard (see #3), returns ok/error

### 3. Role-conflict guard

**Rule David spelled out:** any thread already set as exec OR worker cannot then be set as exec. Roles are mutually exclusive — exec OR worker OR neither, never two.

- Add a helper \`getThreadRoleStatus(workspaceId, agentId)\`: returns \`"exec" | "worker" | "available"\`. \`exec\` if currently set as the workspace's exec. \`worker\` if there's any active binding row in \`operator_thread_card_bindings\` where \`agent_id = X\` and \`detached_at IS NULL\`. \`available\` otherwise.
- Server-side: the \`POST /api/operator-studio/cockpit/exec\` route calls this helper. If the candidate is \`worker\`, reject with 409 + a clear error ("This thread is currently working on plan-card X; detach it first before setting as exec.").
- UI side: when listing candidate threads in the lane dropdown, call the helper for each (or batch-fetch via a new endpoint). Disable rows where \`roleStatus !== "available"\` for the exec-picker section. Show a small inline tooltip ("currently a worker for…").

## Doctrine

- \`memory/feedback_no_browser_or_curl_verification.md\` — \`pnpm typecheck\` is the gate. The acceptance script IS allowed to fetch localhost:4200 (programmatic-gate model).
- \`memory/feedback_dogfood_first.md\` — capture follow-on ideas as plan cards, not stray markdown.
- \`memory/feedback_terse_plain_english.md\` — final user-facing recap is plain English. Code/comments unaffected.

## Acceptance script

Create \`scripts/cockpit-lane-management-acceptance.ts\` per the spec in the card body. Run it green BEFORE claiming task_done. Paste the output in your final message.

## Chip emission contract

When you finish a substantive turn, end with **up to three** \`<<chip:LABEL>>\` lines (each on its own line). Optionally append \`|DESCRIPTION\` for a one-line "why pick this now" rationale (under ~80 chars). Skip chips entirely if no clear next-action stands out.

## Acceptance — what task_done means

- All three deliverables ship + visible in the cockpit (the layout splitter and the lane dropdown will be in gitignored \`app/2/\` for now; that's expected. The role-guard helper, server routes, and acceptance script all land in committable code).
- \`pnpm typecheck\` green.
- \`pnpm tsx scripts/cockpit-lane-management-acceptance.ts\` runs green.
- Final summary: files touched + 1-line description of what David should look for on refresh.

## Provenance

You were spawned by exec \`${EXEC_AGENT_ID}\` against plan card \`${PLAN_STEP_ID}\`. The cockpit watches for \`task_done\` to surface your completion. Berthier will mark you done via \`pnpm os:worker-done\` once verified.`

async function main() {
  console.log("Spawning cockpit lane-management MVP worker…")
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
    rationale: "spawn-cockpit-lane-management-worker.ts — splitter + lane dropdown + role-conflict guard",
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
