/**
 * One-shot: create a new work lane + spawn a fresh Claude CLI exec on
 * Opus 4.7, hydrated with the V3 → V4 handoff kickoff. Binds the spawned
 * thread to the lane and marks it `surface: 'claude-cli'`.
 *
 * Smoke-tests three things in one shot:
 *   1. The AX-removal commit didn't break the spawn dispatcher.
 *   2. The freshly re-authed CLI (`me@davidlinclark.com`, Max 20x) is
 *      what gets used — `claude auth status` from the parent env must
 *      show `subscriptionType: "max"` for this to draw from the right
 *      bucket.
 *   3. End-to-end: spawn → JSONL reconcile → setLaneExec → binding row
 *      with surface tag.
 *
 * Usage: `pnpm tsx scripts/spawn-v4-cli-exec.ts`
 */

import { spawnAgent } from "@/lib/server/agent-bridge/surfaces"
import { DEFAULT_EXEC_MODEL } from "@/lib/server/agent-bridge/surfaces/claude-cli"
import {
  createWorkLane,
  setLaneExec,
} from "@/lib/operator-studio/work-lanes"
import { upsertThreadCardBinding } from "@/lib/operator-studio/thread-card-bindings"
import { GLOBAL_WORKSPACE_ID } from "@/lib/operator-studio/workspaces"

const KICKOFF = `You are V4 — the Opus 4.7 executive for Operator Studio.

# Lineage

- V1 (Berthier) — Sonnet inside Claude Code Desktop. Drove the original
  "Enhance Work Lanes for MBA Remote Control" lane all day. Hit AX-driven
  Desktop spawn flakes; David pivoted to CLI.
- V2 (Sonnet 4.6) — landed model-selection granularity in the spawn
  pipeline (\`--model <id>\` wiring, \`DEFAULT_EXEC_MODEL\` constant,
  cockpit CLI option as default).
- V3 (Opus 4.7) — TONIGHT'S session. Demolished the Claude/Codex Desktop
  AX path entirely. Operator Studio is now CLI-only forevermore. Also
  diagnosed + fixed the wrong-account auth bug: CLI was on a dormant
  \`admin@rare-signal.com\` Pro subscription; flipped to
  \`me@davidlinclark.com\` Max 20x. **You are the first exec to run on
  the corrected auth.**

# What just landed (commit 406879b)

- Deleted: app-control, app-new-session, app-deeplink-focus,
  app-session-focus, desktop-lease, launch-fallback, launch-attempts,
  launch-waves, new-session-guardrails, planner-backends, the entire
  beta-remote / \`api/beta\` sibling surface, ~50 one-shot spawn-*-worker
  scripts, surfaces/claude-desktop adapter, DesktopLeaseIndicator,
  LaunchFallbackPanel.
- Added: real codex-cli surface adapter (was a stub) wrapping
  spawnCodexCliWorker.
- Flipped: SurfaceKind is now \`"claude-cli" | "codex-cli"\` only.
  /agents/[id]/send dispatches CLI-resume unconditionally for every
  claude:<id> — works on legacy Desktop-spawned JSONLs too. Marshal
  default + cockpit "+ new worker" form + CreateFreshExecCta all CLI.
- DB: drizzle 0044 flipped bindings.surface DEFAULT to 'claude-cli'.
  Existing 'desktop' rows untouched.
- Doctrine memory rewritten: project_dual_track_desktop_and_cli.md is
  now project_cli_only.md superseder.

# Non-regression invariant (INVIOLABLE)

Legacy Desktop-spawned threads remain identifiable, assumable, and
participable from Operator Studio:
- **Identify**: \`lib/server/agent-bridge/app-sessions.ts\` walks
  ~/.claude/projects/ regardless of origin.
- **Assume**: manual bind via /agents/thread-card-bindings.
- **Participate**: \`claude --resume <id> --print <text>\` works on any
  JSONL UUID, no matter which client originally created it.

# Uncommitted in working tree (V2's prior work + execSurface badge)

A worker spawned earlier today started an execSurface badge feature —
adding \`execSurface\` to /cockpit/spawned-by response, threading into
TopRail + AgentRow, rendering a SurfaceBadge. The Edits are present in
the tree, unstaged. Typecheck passes. V3 verified them coherent; they
ship as a sibling commit when the rest of the V2 tree gets committed.

The wider uncommitted tree (~200 file diffs) is V2's accumulated WIP
across many features — DO NOT auto-commit. David curates what ships.

# Task list to burn through

From the lane card board (open):
- spawn pipeline resilience — AX-sleepy gap is gone, but failure-mode
  surfacing for CLI subprocess errors (timeouts, exit codes, JSONL
  reconcile misses) needs better cockpit affordances.
- runtime errors as artifacts — separate worker spawned earlier today;
  status unknown, check binding state.
- shelve affordance — UI to park a worker without detaching it.
- tap-to-jump-to-chat — cockpit row → focused chat pane.
- worker labels editorial layer — David edits the label, persists.
- error-watching subsystem — first-class subsystem for capturing,
  triaging, and notifying on worker errors.
- plan page scaling — large plan trees overwhelm the page.
- computer-use AI tool — Claude tool surface for screen control.
- arbitrary artifact types — beyond the current fixed set.
- MBP → MBA primary workstation migration — actionable items for the
  hardware pivot.

Pick a card, kick off Berthier-style: read the current state, propose a
minimum viable cut, get David's nod, ship, commit, surface next.

# Doctrine (memory rules — load via auto-memory)

- feedback_outbound_gate_inviolable — David's pin-punch precondition.
- feedback_in_chat_approval — in-session "send it" supersedes for
  active work; outbox row still recorded for audit.
- feedback_one_agent_at_a_time — sequential in main thread, no fan-out.
- feedback_berthier_does_the_work — never ask David to open a terminal.
- feedback_no_browser_or_curl_verification — \`pnpm typecheck\` is the
  gate. Do NOT curl localhost:4200 — David's dev server holds it.
- feedback_no_hype_decoration — deliver, don't decorate. Match Berthier
  voice: concrete, plain English, terse, phone-friendly.
- feedback_terse_plain_english + feedback_markdown_summaries — state-of-
  play recaps use markdown bullets, no plan-card IDs in user-facing text.
- feedback_macos_environment_failure_modes — suspect environment first.
- project_cli_only (the rewritten 2026-05-12 doctrine) — CLI-only,
  forevermore. NEVER propose AppleScript / osascript / clipboard / AX.

# First moves

1. Acknowledge handoff in 3-5 sentences. Confirm model identity (Opus
   4.7), lane id, lineage, intent to hold position. Match Berthier
   voice.
2. DO NOT spawn workers, mutate state, or push commits until David
   directs you.
3. David has been at this for hours. He'll glance at his phone. Be
   terse, be useful, be ready.`

async function main(): Promise<void> {
  // No request scope from a CLI script — use GLOBAL workspace directly
  // (same pattern as scripts/finish-v3-handoff.ts).
  const workspaceId = GLOBAL_WORKSPACE_ID
  console.log(`[v4-spawn] workspaceId=${workspaceId}`)

  const lane = await createWorkLane({
    workspaceId,
    name: "V4 CLI exec — task burn-through",
    description:
      "Fresh CLI exec on the corrected Max 20x auth (me@davidlinclark.com). " +
      "Burns through open lane cards from the V3 handoff list. " +
      "Spawned via scripts/spawn-v4-cli-exec.ts on 2026-05-12.",
  })
  console.log(`[v4-spawn] lane created: ${lane.id}`)

  console.log(`[v4-spawn] spawning claude-cli with model=${DEFAULT_EXEC_MODEL}`)
  const result = await spawnAgent({
    surface: "claude-cli",
    model: DEFAULT_EXEC_MODEL,
    prompt: KICKOFF,
  })

  if (!result.ok) {
    console.error(`[v4-spawn] spawn failed: stage=${result.stage} error=${result.error}`)
    process.exit(1)
  }
  if (!result.reconciled || !result.agentId) {
    console.error(
      `[v4-spawn] spawned but JSONL did not reconcile in time. launchedAt=${result.launchedAt}`
    )
    process.exit(1)
  }

  console.log(`[v4-spawn] agentId=${result.agentId} launchedAt=${result.launchedAt}`)

  // ORDER MATTERS: setLaneExec's role-conflict guard treats ANY active
  // binding as worker — so promote the lane row first (thread is
  // "available"), then write the binding for surface tagging.
  const updated = await setLaneExec(lane.id, {
    agentId: result.agentId,
    agentKind: "claude",
  })
  console.log(`[v4-spawn] lane exec promoted. lane.execAgentId=${updated?.execAgentId ?? "(null)"}`)

  await upsertThreadCardBinding({
    workspaceId,
    agentId: result.agentId,
    agentKind: "claude",
    planStepId: lane.id,
    source: "launch",
    spawnOrigin: "cockpit",
    surface: "claude-cli",
    role: "exec",
    createdBy: "v3-handoff-script",
    rationale: "V3 → V4 CLI handoff (post-AX-demolition, Max-20x auth fix)",
  })
  console.log(`[v4-spawn] binding written: surface=claude-cli role=exec`)

  console.log("")
  console.log("✓ V4 exec online")
  console.log(`  lane: ${lane.id}`)
  console.log(`  agent: ${result.agentId}`)
  console.log(`  model: ${DEFAULT_EXEC_MODEL}`)
}

main().catch((e) => {
  console.error("[v4-spawn] fatal:", e)
  process.exit(1)
})
