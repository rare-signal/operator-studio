/**
 * Seed kb-2026-05-10-multi-tier-review-state-machine.
 *
 *   pnpm tsx scripts/seed-multi-tier-review-kb.ts
 *
 * Idempotent — re-running upserts the entry. Doctrine output for
 * `step-multi-tier-review-state-machine`.
 */

import { createRequire } from "node:module"
const requireFromHere = createRequire(import.meta.url)
const serverOnlyId = requireFromHere.resolve("server-only")
requireFromHere.cache[serverOnlyId] = {
  id: serverOnlyId,
  filename: serverOnlyId,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local" })

const { upsertEntry } = await import("../lib/operator-studio/knowledge")
const { GLOBAL_WORKSPACE_ID } = await import(
  "../lib/operator-studio/workspaces"
)
const { getPgPool } = await import("../lib/server/db/client")

const ENTRY_ID = "kb-2026-05-10-multi-tier-review-state-machine"

const BODY = `# Multi-Tier Review State Machine

## TL;DR

A worker that posts \`task_done\` is **not** approved. It is *self-believed*. Only David can move it to **human-approved**. Berthier may add an intermediate **berthier-reviewed** tier ("I looked, looks plausible — your call"). The point is to make the **interstitial gap** — work Berthier acknowledged but David never validated — visible in the cockpit so it cannot rot silently.

## Why three tiers (the interstitial risk)

The pre-0034 model collapsed everything into \`ready-for-review\`: a worker self-declared \`task_done\` and the cockpit treated it as ready for human eyes regardless of whether anyone had actually scrutinised it. That conflated:

1. *Self-belief* — the worker's own claim ("I'm done"). High noise; some \`task_done\` tokens are premature.
2. *Berthier scrutiny* — an executive's plausibility check ("the diff isn't insane, the plan card looks done"). Berthier can run autonomously and so can produce false positives — recursive automations don't recognise the kinds of subtle mistakes only David catches.
3. *Human approval* — David's explicit "I read this; it's actually correct."

Three tiers because **each gate produces a different class of error**, and each error class is only visible *between* the gates. If we only show "ready-for-review", we cannot tell apart "the worker thinks it's done" from "Berthier reviewed and is waiting on you" from "you signed off". The third state (berthier-reviewed) is where work most easily silently miscarriages — Berthier moved on, David is busy elsewhere, and the work decays without anyone noticing it never crossed the human gate.

## State diagram

\`\`\`
                            ┌──────┐
   (task_done removed,      │ live │ ◄─────────┐
    re-engagement)          └──┬───┘           │
                               │ task_done     │ user follow-up
                               ▼               │
            ┌──────────────────────────────┐   │
            │ candidate-self-believed       │ ──┘
            │ (≡ awaiting-berthier-check)   │
            └──────────────┬────────────────┘
                           │ pnpm os:berthier-ack
                           ▼
                  ┌─────────────────┐
                  │ berthier-reviewed │ ◄── (interstitial risk lives here)
                  └────────┬──────────┘
                           │ pnpm os:worker-done
                           │   (or cockpit modal "Approve")
                           ▼
                  ┌────────────────┐
                  │ human-approved  │  (terminal)
                  └────────────────┘
\`\`\`

\`idle\` is reachable from \`live\` only (no recent activity past the idle threshold). \`human-approved\` is terminal; subsequent activity does not reset it.

The "send back for revision" affordance clears \`berthier_reviewed_at\`, dropping the binding back to \`candidate-self-believed\` so it re-surfaces in the "needs Berthier's eyes" tier.

## Operator playbook

| Verb / affordance | Sets | Use when |
|---|---|---|
| (worker auto-emits \`task_done\`) | nothing on the binding | The worker self-believes its job is finished. |
| \`pnpm os:berthier-ack --agent=… --reason="…"\` | \`berthier_reviewed_at\` | You (Berthier) have looked and the work seems plausible. Surface it to David. |
| \`pnpm os:worker-done --agent=… --reason="…"\` | \`human_approved_at\` + \`detached_at\` | David explicitly signs off. Worker retires. |
| Cockpit modal — "Approve & retire" | same as \`os:worker-done\` | David signs off via the phone instead of the CLI. |
| Cockpit modal — "Approve, keep active" | \`human_approved_at\` only | David signs off but wants the worker to keep running (rare). |
| Cockpit modal — "Send back for revision" | clears \`berthier_reviewed_at\` | David disagrees with Berthier's plausibility read; bounce it back. |

## Auto-detach behaviour (safety net)

\`autoDetachStaleReadyWorkers\` (driven by the \`spawned-by\` route) auto-detaches **only** \`berthier-reviewed\` bindings older than the threshold (default 24h). It **never** auto-detaches:

- \`candidate-self-believed\` / \`awaiting-berthier-check\` — silently retiring work Berthier hasn't even glanced at would defeat the entire point.
- \`live\` / \`idle\` — nothing actionable.
- \`human-approved\` — already terminal; mark-done already handled it.

Override the threshold via \`OPERATOR_STUDIO_AUTO_DETACH_MINUTES\` (set to \`0\` to disable entirely).

## Anti-patterns (do not do)

- **Auto-promoting \`candidate-self-believed\` straight to \`human-approved\`.** This collapses the gap the entire system exists to surface. If you find yourself wanting a "Berthier always trusts the worker" shortcut, you've slipped back into the single-tier model.
- **Letting \`berthier-reviewed\` be the de-facto "done" state.** Berthier scrutiny is a coordination signal, not a sign-off. The amber pill exists precisely to nag David until he taps.
- **Using \`detach_reason\` as the canonical Berthier comment.** It's stored there as a sentinel today; a dedicated comment column should land if comment-bearing reviews matter (out of scope per the plan card).
- **Skipping \`os:berthier-ack\` and going straight to \`os:worker-done\`.** Mechanically fine — \`os:worker-done\` stamps both timestamps. But it loses the audit trail of "Berthier looked at T, David approved at T+N." Prefer the two-step for any work that wasn't trivially obvious to David at glance.

## Provenance

David surfaced 2026-05-10. Implemented under \`step-multi-tier-review-state-machine\` on plan \`plan-1777793035871-dkq1b8\`. Schema migration \`drizzle/0034_review_tier_timestamps.sql\`.
`

async function main() {
  const entry = await upsertEntry(GLOBAL_WORKSPACE_ID, {
    id: ENTRY_ID,
    entryType: "concept",
    stability: "draft",
    title: "Multi-Tier Review State Machine",
    summary:
      "Three review tiers — candidate-self-believed, berthier-reviewed, human-approved — surface the interstitial risk of work Berthier acknowledged but David never validated. Auto-detach refuses to fire below the human-approval gate.",
    bodyMarkdown: BODY,
    tags: [
      "multi-tier-review",
      "interstitial-risk",
      "cockpit",
      "review-status",
      "doctrine",
    ],
    relatedEntryIds: ["kb-2026-05-10-meta-berthier-design"],
  })
  console.log(`Upserted KB entry: ${entry.id} (body=${entry.bodyMarkdown?.length ?? 0} chars)`)
}

await main()
await getPgPool().end()
